const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");

// ============================================================
// الإعدادات
// ============================================================

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
    console.error("❌ BOT_TOKEN غير موجود في Railway Variables");
    process.exit(1);
}


// ============================================================
// Telegram Bot
// ============================================================

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log("✅ Telegram Bot is running...");


// ============================================================
// Express Server
// ============================================================

const app = express();

app.use(express.json());


// ============================================================
// CORS بدون مكتبة cors
// ============================================================

app.use((req, res, next) => {

    res.header(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.header(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );

    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});


// ============================================================
// SQLite Database
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
        CREATE TABLE IF NOT EXISTS requests (
            request_id TEXT PRIMARY KEY,
            telegram_id TEXT NOT NULL,
            phone TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

});

console.log("✅ Database is ready");


// ============================================================
// المستخدمون الذين وافقوا على الشروط
// ============================================================

const acceptedUsers = new Set();


// ============================================================
// إنشاء Token
// ============================================================

function createToken() {

    return crypto
        .randomBytes(32)
        .toString("hex");

}


// ============================================================
// إنشاء Request ID
// ============================================================

function createRequestId() {

    return crypto
        .randomBytes(16)
        .toString("hex");

}


// ============================================================
// إنشاء Referral
// ============================================================

function createReferral(chatId) {

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
                String(chatId)
            ],
            function (error) {

                if (error) {
                    reject(error);
                    return;
                }

                resolve(token);

            }
        );

    });

}


// ============================================================
// جلب Referral
// ============================================================

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

                resolve(row);

            }
        );

    });

}


// ============================================================
// جلب Request
// ============================================================

function getRequest(requestId) {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT *
            FROM requests
            WHERE request_id = ?
            `,
            [requestId],
            (error, row) => {

                if (error) {
                    reject(error);
                    return;
                }

                resolve(row);

            }
        );

    });

}


// ============================================================
// تحديث حالة الطلب
// ============================================================

function updateRequestStatus(
    requestId,
    status
) {

    return new Promise((resolve, reject) => {

        db.run(
            `
            UPDATE requests
            SET status = ?
            WHERE request_id = ?
            `,
            [
                status,
                requestId
            ],
            function (error) {

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
// الصفحة الرئيسية
// ============================================================

app.get("/", (req, res) => {

    res.json({

        ok: true,

        service:
            "Telegram Bot + API",

        message:
            "Server is running"

    });

});


// ============================================================
// Health Check
// ============================================================

app.get("/health", (req, res) => {

    res.json({

        ok: true,

        status:
            "online",

        timestamp:
            new Date().toISOString()

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

                    error:
                        "telegram_id is required"

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

            console.error(
                "❌ Referral error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    "Failed to create referral"

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

                    error:
                        "Invalid referral"

                });

            }


            res.json({

                success: true,

                valid: true

            });


        } catch (error) {

            console.error(
                "❌ Referral lookup error:",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    "Database error"

            });

        }

    }
);


// ============================================================
// استقبال طلب العميل
// ============================================================

app.post(
    "/api/request-access",
    async (req, res) => {

        try {

            const {
                chatId,
                phone
            } = req.body;


            // --------------------------------------------
            // التحقق من البيانات
            // --------------------------------------------

            if (!chatId) {

                return res.status(400).json({

                    error:
                        "Chat ID مفقود"

                });

            }


            if (!phone) {

                return res.status(400).json({

                    error:
                        "رقم الهاتف مفقود"

                });

            }


            // --------------------------------------------
            // إنشاء Request ID
            // --------------------------------------------

            const requestId =
                createRequestId();


            // --------------------------------------------
            // حفظ الطلب
            // --------------------------------------------

            await new Promise(
                (resolve, reject) => {

                    db.run(
                        `
                        INSERT INTO requests
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
                            String(chatId),
                            String(phone),
                            "pending"
                        ],
                        function (error) {

                            if (error) {
                                reject(error);
                                return;
                            }

                            resolve();

                        }
                    );

                }
            );


            // --------------------------------------------
            // إرسال إشعار لصاحب الرابط
            // --------------------------------------------

            await bot.sendMessage(

                chatId,

`🔔 طلب تواصل جديد

📱 رقم التواصل:
${phone}

🆔 رقم الطلب:
${requestId}

⏳ الحالة:
بانتظار الموافقة`,

                {

                    reply_markup: {

                        inline_keyboard: [

                            [

                                {
                                    text:
                                        "✅ موافقة",

                                    callback_data:
                                        `approve:${requestId}`
                                },

                                {
                                    text:
                                        "❌ رفض",

                                    callback_data:
                                        `reject:${requestId}`
                                }

                            ]

                        ]

                    }

                }

            );


            // --------------------------------------------
            // الرد للموقع
            // --------------------------------------------

            res.json({

                ok: true,

                requestId:

                    requestId,

                message:
                    "تم إرسال الطلب بنجاح"

            });


        } catch (error) {

            console.error(
                "❌ request-access error:",
                error
            );


            res.status(500).json({

                error:
                    error.message ||
                    "حدث خطأ في السيرفر"

            });

        }

    }
);


// ============================================================
// فحص حالة الطلب
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

                    error:
                        "الطلب غير موجود"

                });

            }


            res.json({

                status:
                    request.status

            });


        } catch (error) {

            console.error(
                "❌ Check request error:",
                error
            );


            res.status(500).json({

                error:
                    "Database error"

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

        "👋 أهلاً بك\n\nاختر المنصة:",

        {

            reply_markup: {

                inline_keyboard: [

                    [

                        {
                            text:
                                "📸 Instagram",

                            callback_data:
                                "instagram"
                        },

                        {
                            text:
                                "📘 Facebook",

                            callback_data:
                                "facebook"
                        }

                    ],

                    [

                        {
                            text:
                                "✈️ Telegram",

                            callback_data:
                                "telegram"
                        },

                        {
                            text:
                                "📞 اتصال وهمي",

                            callback_data:
                                "twitter"
                        }

                    ],

                    [

                        {
                            text:
                                "💬 تفجير هواتف",

                            callback_data:
                                "تفجير هواتف"
                        },

                        {
                            text:
                                "📶 تطبيق فك جميع شبكات Wi-Fi",

                            callback_data:
                                "whatsapp"
                        }

                    ]

                ]

            }

        }

    );

}


// ============================================================
// أمر /start
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
// أزرار البوت
// ============================================================

bot.on(
    "callback_query",
    async (query) => {

        const chatId =
            query.message.chat.id;


        try {

            // =================================================
            // قبول الشروط
            // =================================================

            if (
                query.data ===
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
    query.from.first_name || ""
}.

🆔 ID الخاص بك:
${chatId}

اضغط /start للمتابعة.`

                );


                return;

            }


            // =================================================
            // موافقة على طلب
            // =================================================

            if (
                query.data.startsWith(
                    "approve:"
                )
            ) {

                const requestId =
                    query.data.substring(
                        "approve:".length
                    );


                const request =
                    await getRequest(
                        requestId
                    );


                if (!request) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text:
                                "الطلب غير موجود"
                        }

                    );

                    return;

                }


                // صاحب الرابط فقط يستطيع الموافقة
                if (
                    String(
                        request.telegram_id
                    ) !==
                    String(chatId)
                ) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text:
                                "غير مصرح بهذا الطلب"
                        }

                    );

                    return;

                }


                await updateRequestStatus(

                    requestId,

                    "approved"

                );


                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text:
                            "تمت الموافقة ✅"
                    }

                );


                await bot.sendMessage(

                    chatId,

`✅ تمت الموافقة على طلب التواصل.

📱 الرقم:
${request.phone}

🆔 رقم الطلب:
${requestId}`

                );


                return;

            }


            // =================================================
            // رفض طلب
            // =================================================

            if (
                query.data.startsWith(
                    "reject:"
                )
            ) {

                const requestId =
                    query.data.substring(
                        "reject:".length
                    );


                const request =
                    await getRequest(
                        requestId
                    );


                if (!request) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text:
                                "الطلب غير موجود"
                        }

                    );

                    return;

                }


                if (
                    String(
                        request.telegram_id
                    ) !==
                    String(chatId)
                ) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text:
                                "غير مصرح بهذا الطلب"
                        }

                    );

                    return;

                }


                await updateRequestStatus(

                    requestId,

                    "rejected"

                );


                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text:
                            "تم الرفض ❌"
                    }

                );


                await bot.sendMessage(

                    chatId,

`❌ تم رفض طلب التواصل.

🆔 رقم الطلب:
${requestId}`

                );


                return;

            }


            // =================================================
            // التحقق من الموافقة
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
            // إنشاء Referral
            // =================================================

            const token =
                await createReferral(
                    chatId
                );


            // =================================================
            // روابط المواقع
            // =================================================

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


            // =================================================
            // إضافة Token للرابط
            // =================================================

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


            await bot.answerCallbackQuery(
                query.id
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
// أخطاء Telegram
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
            "========================================"
        );

        console.log(
            "🚀 Telegram Bot + API Server Started"
        );

        console.log(
            `🌐 Port: ${PORT}`
        );

        console.log(
            "❤️ Health: /health"
        );

        console.log(
            "========================================"
        );

    }

);
