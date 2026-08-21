// ============================================================
// المستخدمون الذين وافقوا على الشروط
// ============================================================

const acceptedUsers = new Set();


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
                            text: "📞 اتصال",
                            callback_data: "call"
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
// أمر /start
// ============================================================

bot.onText(/^\/start$/, async (msg) => {

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


        // إذا وافق سابقًا → القائمة
        if (
            acceptedUsers.has(chatId)
        ) {

            return sendMainMenu(
                chatId
            );

        }


        // أول مرة → الشروط

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


            // =================================================
            // قبول الشروط
            // =================================================

            if (
                data === "accept_terms"
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
            // منع استخدام القائمة قبل الموافقة
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

                call:
                    "https://callmyphone.org/",

                wifi:
                    "https://wifi-free-gamma.vercel.app/"

            };


            const website =
                websites[data];


            // زر غير معروف
            if (!website) {

                await bot.answerCallbackQuery(
                    query.id
                );

                return;

            }


            // =================================================
            // إنشاء Referral خاص بالمستخدم
            // =================================================

            const token =
                await createReferral(
                    chatId
                );


            // =================================================
            // إنشاء الرابط
            // =================================================

            const separator =
                website.includes("?")
                    ? "&"
                    : "?";


            const referralUrl =
                `${website}${separator}ref=${token}`;


            // =================================================
            // إرسال الرابط
            // =================================================

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

يمكنك مشاركة الرابط.`

            );


        } catch (error) {

            console.error(
                "❌ Callback error:",
                error
            );

        }

    }
);
