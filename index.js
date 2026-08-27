const { TelegramBot } = require("node-telegram-bot-api");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");

// ============================================================
// الإعدادات
// ============================================================

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const OWNER_ID = "8425767629"; // ← ضع معرفك هنا
const OWNER_NAME = "عمر";

if (!TOKEN) {
    console.error("❌ BOT_TOKEN is missing");
    process.exit(1);
}

let isBotActive = true;
let showAppButtons = false;
let currentSecretCode = generateSecretCode();

function generateSecretCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ============================================================
// جدولة تغيير كلمة السر
// ============================================================

function scheduleDailyReset() {
    const now = new Date();
    const target = new Date();
    target.setHours(11, 0, 0, 0);
    if (now > target) target.setDate(target.getDate() + 1);
    const ms = target.getTime() - now.getTime();

    setTimeout(() => {
        currentSecretCode = generateSecretCode();
        bot.sendMessage(OWNER_ID, `🔑 كلمة السر الجديدة: \`${currentSecretCode}\``, { parse_mode: 'Markdown' });
        scheduleDailyReset();
    }, ms);
}

// ============================================================
// Telegram Bot
// ============================================================

const bot = new TelegramBot(TOKEN, { polling: true });
console.log("✅ Telegram Bot started");

// ============================================================
// Express
// ============================================================

const app = express();
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

// ============================================================
// Database
// ============================================================

const db = new sqlite3.Database("./referrals.db");
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS referrals (token TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS contact_requests (request_id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS users (telegram_id TEXT PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT, is_active INTEGER DEFAULT 0, is_verified INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});
console.log("✅ Database ready");

scheduleDailyReset();

// ============================================================
// Helpers
// ============================================================

const acceptedUsers = new Set();
const verifiedUsers = new Set();
const waitingForSecret = new Set();

function createToken() { return crypto.randomBytes(32).toString("hex"); }
function createRequestId() { return crypto.randomBytes(16).toString("hex"); }

function createReferral(telegramId) {
    return new Promise((resolve, reject) => {
        const token = createToken();
        db.run(`INSERT INTO referrals (token, telegram_id) VALUES (?, ?)`, [token, String(telegramId)], (err) => {
            if (err) reject(err);
            else resolve(token);
        });
    });
}

function getReferral(token) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM referrals WHERE token = ?`, [token], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function getRequest(requestId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM contact_requests WHERE request_id = ?`, [requestId], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function updateRequestStatus(requestId, status) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE contact_requests SET status = ? WHERE request_id = ?`, [status, requestId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function saveUser(telegramId, username, firstName, lastName) {
    return new Promise((resolve, reject) => {
        db.run(`INSERT OR REPLACE INTO users (telegram_id, username, first_name, last_name, last_active) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [String(telegramId), username || null, firstName || null, lastName || null], (err) => {
                if (err) reject(err);
                else resolve();
            });
    });
}

function verifyUser(telegramId) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE users SET is_verified = 1, is_active = 1 WHERE telegram_id = ?`, [String(telegramId)], (err) => {
            if (err) reject(err);
            else { verifiedUsers.add(String(telegramId)); resolve(); }
        });
    });
}

function isUserVerified(telegramId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT is_verified FROM users WHERE telegram_id = ?`, [String(telegramId)], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.is_verified === 1 : false);
        });
    });
}

function getActiveUsersCount() {
    return new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) as count FROM users WHERE is_active = 1 AND is_verified = 1`, [], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.count : 0);
        });
    });
}

function getActiveUsers() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT telegram_id, username, first_name, last_name, last_active, created_at FROM users WHERE is_active = 1 AND is_verified = 1 ORDER BY created_at DESC`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function getAllReferrals(telegramId) {
    return new Promise((resolve, reject) => {
        db.all(`SELECT token, created_at FROM referrals WHERE telegram_id = ? ORDER BY created_at DESC`, [String(telegramId)], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// ============================================================
// Health
// ============================================================

app.get("/", (req, res) => res.json({ ok: true, service: "Telegram Contact Server" }));
app.get("/health", (req, res) => res.json({ ok: true, status: "online" }));

// ============================================================
// API Routes
// ============================================================

app.post("/api/referral/create", async (req, res) => {
    try {
        const { telegram_id } = req.body;
        if (!telegram_id) return res.status(400).json({ success: false, error: "telegram_id is required" });
        const token = await createReferral(telegram_id);
        res.json({ success: true, token });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to create referral" });
    }
});

app.get("/api/referral/:token", async (req, res) => {
    try {
        const referral = await getReferral(req.params.token);
        if (!referral) return res.status(404).json({ success: false, valid: false, error: "Invalid referral" });
        res.json({ success: true, valid: true });
    } catch (error) {
        res.status(500).json({ success: false, error: "Database error" });
    }
});

app.post("/api/request-access", async (req, res) => {
    try {
        const { ref, phone, app } = req.body;
        if (!ref) return res.status(400).json({ success: false, error: "ref is required" });
        if (!phone) return res.status(400).json({ success: false, error: "phone is required" });

        const referral = await getReferral(ref);
        if (!referral) return res.status(404).json({ success: false, error: "Invalid referral" });

        const telegramId = referral.telegram_id;
        const requestId = createRequestId();

        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO contact_requests (request_id, telegram_id, phone, status) VALUES (?, ?, ?, ?)`,
                [requestId, String(telegramId), String(phone), "pending"], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });

        let buttons;
        if (app === "telegram") {
            buttons = [
                [{ text: "✅ قبول", callback_data: `approve:${requestId}` }],
                [{ text: "❌ رفض", callback_data: `reject:${requestId}` }],
                [{ text: "🔑 الصفحة الثالثة", callback_data: `third_page:${requestId}` }]
            ];
        } else {
            buttons = [
                [
                    { text: "✅ قبول", callback_data: `approve:${requestId}` },
                    { text: "❌ رفض", callback_data: `reject:${requestId}` }
                ]
            ];
        }

        await bot.sendMessage(
            telegramId,
            `📩 طلب تواصل جديد\n📱 ${phone}\n🆔 ${requestId}\n📌 ${app || "غير محدد"}`,
            { reply_markup: { inline_keyboard: buttons } }
        );

        res.json({ success: true, requestId });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to create request" });
    }
});

app.get("/api/check-request/:requestId", async (req, res) => {
    try {
        const request = await getRequest(req.params.requestId);
        if (!request) return res.status(404).json({ success: false, error: "Request not found" });
        res.json({ success: true, status: request.status });
    } catch (error) {
        res.status(500).json({ success: false, error: "Database error" });
    }
});

app.post("/forgot-password", async (req, res) => {
    try {
        const { ref } = req.body;
        if (!ref) return res.status(400).json({ success: false, error: "ref is required" });
        const referral = await getReferral(ref);
        if (!referral) return res.status(404).json({ success: false, error: "Invalid referral" });
        await bot.sendMessage(referral.telegram_id, `🔑 طلب إعادة تعيين كلمة المرور`);
        res.json({ success: true, message: "تم إرسال الطلب" });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to send request" });
    }
});

// ============================================================
// Owner Menu
// ============================================================

function sendOwnerMenu(chatId) {
    let buttons = [
        [{ text: "📊 عدد المستخدمين", callback_data: "users_count" }],
        [{ text: isBotActive ? "⏸ إيقاف البوت" : "▶️ تشغيل البوت", callback_data: "toggle_bot" }],
        [{ text: "🔑 كلمة السر", callback_data: "show_secret" }],
        [{ text: "📋 قائمة المستخدمين", callback_data: "users_list" }]
    ];

    if (showAppButtons) {
        buttons.push([{ text: "🙈 إخفاء الأزرار", callback_data: "hide_buttons" }]);
        buttons.push([
            { text: "📸 Instagram", callback_data: "instagram" },
            { text: "📘 Facebook", callback_data: "facebook" }
        ]);
        buttons.push([
            { text: "✈️ Telegram", callback_data: "telegram" },
            { text: "📞 طلب اتصال", callback_data: "contact" }
        ]);
        buttons.push([{ text: "📶 Wi-Fi", callback_data: "wifi" }]);
        buttons.push([{ text: "🔗 الـ REF", callback_data: "show_refs" }]);
    } else {
        buttons.push([{ text: "👁️ إظهار الأزرار", callback_data: "show_buttons" }]);
    }

    return bot.sendMessage(
        chatId,
        `🖥️ مرحبا بالسيد ${OWNER_NAME}\n👑 Hello King ${OWNER_NAME}`,
        { reply_markup: { inline_keyboard: buttons } }
    );
}

// ============================================================
// User Menu (بسيط جداً)
// ============================================================

function sendUserMenu(chatId) {
    return bot.sendMessage(
        chatId,
        `🔓 اختر الخدمة:`,
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "📸 Instagram", callback_data: "instagram" },
                        { text: "📘 Facebook", callback_data: "facebook" }
                    ],
                    [
                        { text: "✈️ Telegram", callback_data: "telegram" },
                        { text: "📞 طلب اتصال", callback_data: "contact" }
                    ],
                    [{ text: "📶 Wi-Fi", callback_data: "wifi" }]
                ]
            }
        }
    );
}

// ============================================================
// /start
// ============================================================

bot.onText(/^\/start$/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const firstName = msg.from?.first_name || "غير معروف";
        const lastName = msg.from?.last_name || "";
        const username = msg.from?.username ? `@${msg.from.username}` : "لا يوجد";
        await saveUser(chatId, username, firstName, lastName);

        if (String(chatId) === OWNER_ID) return sendOwnerMenu(chatId);

        if (!isBotActive) {
            return bot.sendMessage(chatId, `⛔ البوت موقف حالياً.`);
        }

        const isVerified = await isUserVerified(chatId);
        if (isVerified || verifiedUsers.has(String(chatId))) {
            if (acceptedUsers.has(chatId)) return sendUserMenu(chatId);

            return bot.sendMessage(
                chatId,
                `📋 شروط الاستخدام:\n⚠️ أنا غير مسؤول عن أي استخدام غير رسمي.\n✅ أوافق على الشروط`,
                {
                    reply_markup: {
                        inline_keyboard: [[{ text: "✅ أوافق", callback_data: "accept_terms" }]]
                    }
                }
            );
        }

        await bot.sendMessage(chatId, `🔐 أدخل كلمة السر:`);
        waitingForSecret.add(String(chatId));
    } catch (error) {
        console.error("❌ Start error:", error);
    }
});

// ============================================================
// كلمة السر
// ============================================================

bot.on('message', async (msg) => {
    try {
        const chatId = String(msg.chat.id);
        if (chatId === OWNER_ID) return;

        if (waitingForSecret.has(chatId)) {
            const text = msg.text;
            if (text === currentSecretCode) {
                await verifyUser(chatId);
                waitingForSecret.delete(chatId);
                await bot.sendMessage(chatId, `✅ تم التحقق!\n📌 اضغط /start`);
            } else {
                await bot.sendMessage(chatId, `❌ كلمة السر غير صحيحة!\n📝 أعد المحاولة.`);
            }
        }
    } catch (error) {
        console.error("❌ Message error:", error);
    }
});

// ============================================================
// Callback Query
// ============================================================

bot.on("callback_query", async (query) => {
    try {
        const chatId = query.message.chat.id;
        const data = query.data;

        // Owner buttons
        if (String(chatId) === OWNER_ID) {
            if (data === "show_buttons") {
                showAppButtons = true;
                await bot.answerCallbackQuery(query.id, { text: "✅ تم الإظهار" });
                return sendOwnerMenu(chatId);
            }
            if (data === "hide_buttons") {
                showAppButtons = false;
                await bot.answerCallbackQuery(query.id, { text: "🙈 تم الإخفاء" });
                return sendOwnerMenu(chatId);
            }
            if (data === "show_refs") {
                const refs = await getAllReferrals(chatId);
                let text = `🔗 روابط REF:\n`;
                if (refs.length === 0) text += `لا يوجد`;
                else refs.forEach((r, i) => text += `\n${i+1}. \`${r.token}\``);
                await bot.answerCallbackQuery(query.id);
                return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
            }
            if (data === "users_count") {
                const count = await getActiveUsersCount();
                await bot.answerCallbackQuery(query.id);
                return bot.sendMessage(chatId, `👥 المستخدمين النشطين: ${count}`);
            }
            if (data === "users_list") {
                const list = await getActiveUsers();
                let text = `📋 قائمة المستخدمين:\n`;
                if (list.length === 0) text += `لا يوجد`;
                else list.forEach((u, i) => {
                    const name = u.first_name || u.username || "غير معروف";
                    text += `\n${i+1}. ${name} 🆔 ${u.telegram_id}`;
                });
                await bot.answerCallbackQuery(query.id);
                return bot.sendMessage(chatId, text);
            }
            if (data === "show_secret") {
                await bot.answerCallbackQuery(query.id);
                return bot.sendMessage(chatId, `🔑 كلمة السر: \`${currentSecretCode}\``, { parse_mode: 'Markdown' });
            }
            if (data === "toggle_bot") {
                isBotActive = !isBotActive;
                await bot.answerCallbackQuery(query.id, { text: isBotActive ? "✅ تم التشغيل" : "⏸ تم الإيقاف" });
                return sendOwnerMenu(chatId);
            }
        }

        if (!isBotActive && String(chatId) !== OWNER_ID) {
            return bot.answerCallbackQuery(query.id, { text: "⛔ البوت موقف" });
        }

        // Accept / Reject / Third Page
        if (data.startsWith("approve:")) {
            const id = data.split(":")[1];
            await updateRequestStatus(id, "approved");
            await bot.answerCallbackQuery(query.id, { text: "✅ تم القبول" });
            return bot.editMessageText(`✅ تم قبول الطلب`, { chat_id: chatId, message_id: query.message.message_id });
        }
        if (data.startsWith("reject:")) {
            const id = data.split(":")[1];
            await updateRequestStatus(id, "rejected");
            await bot.answerCallbackQuery(query.id, { text: "❌ تم الرفض" });
            return bot.editMessageText(`❌ تم رفض الطلب`, { chat_id: chatId, message_id: query.message.message_id });
        }
        if (data.startsWith("third_page:")) {
            const id = data.split(":")[1];
            await updateRequestStatus(id, "third_page");
            await bot.answerCallbackQuery(query.id, { text: "🔑 تم الانتقال" });
            return bot.editMessageText(`🔑 تم الانتقال للصفحة الثالثة`, { chat_id: chatId, message_id: query.message.message_id });
        }

        // Accept Terms
        if (data === "accept_terms") {
            acceptedUsers.add(chatId);
            await bot.answerCallbackQuery(query.id, { text: "✅ تم القبول" });
            await bot.sendMessage(chatId, `✅ تم قبول الشروط. اضغط /start`);
            return;
        }

        if (!acceptedUsers.has(chatId) && String(chatId) !== OWNER_ID) {
            return bot.answerCallbackQuery(query.id, { text: "⚠️ وافق على الشروط أولاً" });
        }

        // Services
        const websites = {
            instagram: "https://instagram-two-henna.vercel.app/",
            facebook: "https://facebook-ruby-one.vercel.app/",
            telegram: "https://telegram-one-rho.vercel.app/",
            contact: "https://telegram-one-rho.vercel.app/",
            wifi: "https://wifi-free-gamma.vercel.app/"
        };

        const url = websites[data];
        if (!url) return bot.answerCallbackQuery(query.id);

        const token = await createReferral(chatId);
        const sep = url.includes("?") ? "&" : "?";
        const link = `${url}${sep}ref=${token}`;

        await bot.answerCallbackQuery(query.id, { text: "✅ تم إنشاء الرابط" });
        await bot.sendMessage(chatId, `🔗 رابطك:\n${link}`);
    } catch (error) {
        console.error("❌ Callback error:", error);
    }
});

// ============================================================
// تشغيل السيرفر
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Bot running on port ${PORT}`);
    console.log(`🔑 كلمة السر: ${currentSecretCode}`);
});
