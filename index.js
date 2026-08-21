const { TelegramBot } = require("node-telegram-bot-api");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");

// ============================================================
// SETTINGS
// ============================================================

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
    console.error("❌ BOT_TOKEN is missing");
    process.exit(1);
}


// ============================================================
// TELEGRAM BOT
// ============================================================

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log("✅ Telegram Bot started");


// ============================================================
// EXPRESS
// ============================================================

const app = express();

app.use(express.json());


// ============================================================
// CORS بدون مكتبة خارجية
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
// DATABASE
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
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

});

console.log("✅ Database ready");


// ============================================================
// HELPERS
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


function findReferral(token) {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT token, telegram_id
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


function findRequest(requestId) {

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

                resolve(row || null);

            }
        );

    });

}


function updateRequest(requestId, status) {

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
// HEALTH
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
// CREATE REFERRAL
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

            console.error(
                "Referral error:",
                error
            );

            res.status(500).json({
                success: false,
                error: "Failed to create referral"
            });

        }

    }
);


// ============================================================
// VERIFY REFERRAL
// ============================================================

app.get(
    "/api/referral/:token",
    async (req, res) => {

        try {

            const referral =
                await findReferral(
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

            console.error(
                "Referral verification error:",
                error
            );

            res.status(500).json({
                success: false,
                error: "Database error"
            });

        }

    }
);


// ============================================================
// CONTACT REQUEST
// ============================================================
//
// الموقع يرسل:
//
// {
//     "ref": "TOKEN",
//     "phone": "07XXXXXXXX"
// }
//
// ============================================================

app.post(
    "/api/request-access",
    async (req, res) => {

        try {

            const {
                ref,
                phone
            } = req.body;


            // ------------------------------------------------
            // التحقق
            // ------------------------------------------------

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


            // ------------------------------------------------
            // إيجاد صاحب الرابط
            // ------------------------------------------------

            const referral =
                await findReferral(ref);


            if (!referral) {

                return res.status(404).json({
                    success: false,
                    error: "Invalid referral"
                });

            }


            const telegramId =
                referral.telegram_id;


            // ------------------------------------------------
            // إنشاء Request
            // ------------------------------------------------

            const requestId =
                createRequestId();


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


            // ------------------------------------------------
            // إرسال الطلب إلى صاحب الرابط
            // ------------------------------------------------

            await bot.sendMessage(

                telegramId,

`📩 طلب تواصل جديد

📱 رقم الهاتف:
${phone}

🆔 رقم الطلب:
${requestId}

الشخص وافق على إرسال الرقم للتواصل معه.

اختر الإجراء:`,

                {
                    reply_markup: {

                        inline_keyboard: [

                            [
                                {
                                    text: "✅ قبول",
                                    callback_data:
                                        `approve:${requestId}`
                                },

                                {
                                    text: "❌ رفض",
                                    callback_data:
                                        `reject:${requestId}`
                                }
                            ]

                        ]

                    }

                }

            );


            // ------------------------------------------------
            // الرد للموقع
            // ------------------------------------------------

            res.json({

                success: true,

                requestId

            });

        } catch (error) {

            console.error(
                "Request error:",
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
// CHECK REQUEST
// ============================================================

app.get(
    "/api/check-request/:requestId",
    async (req, res) => {

        try {

            const request =
                await findRequest(
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

            console.error(
                "Check request error:",
                error
            );

            res.status(500).json({
                success: false,
                error: "Database error"
            });

        }

    }
);


// ============================================================
// TELEGRAM /start
// ============================================================

bot.onText(
    /^\/start$/,
    async (msg) => {

        try {

            const chatId =
                msg.chat.id;

            const name =
                msg.from?.first_name ||
                "صديقي";


            const token =
                await createReferral(
                    chatId
                );


            const website =
                "https://telegram-one-rho.vercel.app/";


            const referralUrl =
                `${website}?ref=${token}`;


            await bot.sendMessage(

                chatId,

`👋 أهلاً ${name}

هذا رابط التواصل الخاص بك:

${referralUrl}

يمكنك مشاركته مع الشخص الذي يريد التواصل معك.

عند إرسال الشخص رقمه بموافقته، سيصل إليك طلب عبر Telegram.`

            );

        } catch (error) {

            console.error(
                "Start error:",
                error
            );

        }

    }
);


// ============================================================
// TELEGRAM CALLBACKS
// ============================================================

bot.on(
    "callback_query",
    async (query) => {

        try {

            const data =
                query.data || "";

            const chatId =
                query.message.chat.id;


            // =================================================
            // APPROVE
            // =================================================

            if (
                data.startsWith("approve:")
            ) {

                const requestId =
                    data.substring(
                        "approve:".length
                    );


                const request =
                    await findRequest(
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
                                "غير مصرح"
                        }
                    );

                    return;

                }


                await updateRequest(
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
${request.phone}`

                );


                return;

            }


            // =================================================
            // REJECT
            // =================================================

            if (
                data.startsWith("reject:")
            ) {

                const requestId =
                    data.substring(
                        "reject:".length
                    );


                const request =
                    await findRequest(
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
                                "غير مصرح"
                        }
                    );

                    return;

                }


                await updateRequest(
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


        } catch (error) {

            console.error(
                "Callback error:",
                error
            );

        }

    }
);


// ============================================================
// TELEGRAM ERRORS
// ============================================================

bot.on(
    "polling_error",
    (error) => {

        console.error(
            "Telegram polling error:",
            error.message
        );

    }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "===================================="
        );

        console.log(
            "🚀 Server started"
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
