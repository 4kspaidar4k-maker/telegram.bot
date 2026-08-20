const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 اقرأ التوكن من متغيرات البيئة (آمن)
const BOT_TOKEN = process.env.BOT_TOKEN || '8926452536:AAGMA0SDtBfYCbAVg_4EZCwkj1sw5-p-OfQ';

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN غير موجود!');
    process.exit(1);
}

// Middleware
app.use(cors()); // يسمح لأي موقع بالتواصل مع السيرفر
app.use(express.json());

// تخزين الطلبات (للتجربة، استخدم قاعدة بيانات في الإنتاج)
const requests = new Map();

// ==================== API ====================

// 📩 طلب وصول جديد
app.post('/api/request-access', async (req, res) => {
    try {
        const { chatId, phone } = req.body;
        
        // التحقق من البيانات
        if (!chatId || !phone) {
            return res.status(400).json({ 
                error: 'chatId و phone مطلوبان' 
            });
        }

        // تنظيف رقم الهاتف
        const cleanPhone = phone.replace(/\s/g, '');
        
        // إنشاء requestId فريد
        const requestId = crypto.randomBytes(16).toString('hex');
        
        // حفظ الطلب
        requests.set(requestId, {
            chatId,
            phone: cleanPhone,
            status: 'pending',
            timestamp: Date.now()
        });

        console.log(`📩 [${requestId}] طلب جديد من ${chatId}`);

        // إرسال رسالة للموظف عبر تيليجرام
        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const message = `📱 طلب وصول جديد\n\n📞 رقم الهاتف: ${cleanPhone}\n🆔 معرف الطلب: ${requestId.substring(0, 8)}\n\nهل تسمح لهذا المستخدم بالانتقال؟`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { 
                        text: '✅ السماح بالانتقال', 
                        callback_data: `approve_${requestId}` 
                    },
                    { 
                        text: '❌ رفض', 
                        callback_data: `reject_${requestId}` 
                    }
                ]
            ]
        };

        await axios.post(telegramUrl, {
            chat_id: chatId,
            text: message,
            reply_markup: keyboard
        });

        console.log(`✅ تم إرسال الإشعار إلى ${chatId}`);
        res.json({ requestId });

    } catch (error) {
        console.error('❌ خطأ في الإرسال:', error.message);
        res.status(500).json({ 
            error: 'فشل إرسال الطلب: ' + error.message 
        });
    }
});

// 🔍 فحص حالة الطلب
app.get('/api/check-request/:requestId', (req, res) => {
    const { requestId } = req.params;
    const request = requests.get(requestId);
    
    if (!request) {
        return res.status(404).json({ 
            error: 'الطلب غير موجود' 
        });
    }
    
    res.json({ 
        status: request.status,
        phone: request.phone,
        timestamp: request.timestamp
    });
});

// 📊 الحصول على جميع الطلبات (للمطورين)
app.get('/api/requests', (req, res) => {
    const allRequests = [];
    requests.forEach((value, key) => {
        allRequests.push({
            requestId: key,
            ...value
        });
    });
    res.json(allRequests);
});

// 🧹 تنظيف الطلبات القديمة (أكثر من ساعة)
app.delete('/api/cleanup', (req, res) => {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    let count = 0;
    
    for (const [key, value] of requests.entries()) {
        if (now - value.timestamp > ONE_HOUR) {
            requests.delete(key);
            count++;
        }
    }
    
    res.json({ 
        message: `تم حذف ${count} طلب قديم`,
        remaining: requests.size 
    });
});

// ==================== WEBHOOK ====================

// 🤖 استقبال أزرار تيليجرام
app.post('/webhook', async (req, res) => {
    try {
        const { callback_query } = req.body;
        
        if (!callback_query) {
            return res.sendStatus(200);
        }

        const { data, message, id: callbackId } = callback_query;
        const [action, requestId] = data.split('_');

        const request = requests.get(requestId);
        if (!request) {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callbackId,
                text: '❌ الطلب منتهي الصلاحية'
            });
            return res.sendStatus(200);
        }

        // تحديث الحالة
        if (action === 'approve') {
            request.status = 'approved';
            console.log(`✅ تمت الموافقة على ${requestId}`);
        } else if (action === 'reject') {
            request.status = 'rejected';
            console.log(`❌ تم رفض ${requestId}`);
        }

        // تعديل الرسالة في تيليجرام
        const statusText = request.status === 'approved' ? '✅ تمت الموافقة' : '❌ تم الرفض';
        const newText = `📱 ${statusText}\n\n📞 رقم الهاتف: ${request.phone}\n🆔 معرف الطلب: ${requestId.substring(0, 8)}`;
        
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            text: newText,
            reply_markup: null
        });

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackId,
            text: `✅ تم ${request.status === 'approved' ? 'الموافقة' : 'الرفض'}`
        });

        res.sendStatus(200);

    } catch (error) {
        console.error('❌ خطأ في webhook:', error.message);
        res.sendStatus(200);
    }
});

// ==================== تشغيل السيرفر ====================

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 السيرفر شغال بنجاح!');
    console.log('='.repeat(50));
    console.log(`📍 الرابط: http://localhost:${PORT}`);
    console.log(`🤖 BOT_TOKEN: ${BOT_TOKEN.substring(0, 15)}...`);
    console.log(`📅 الوقت: ${new Date().toLocaleString()}`);
    console.log('='.repeat(50));
    console.log('\n📌 API Endpoints:');
    console.log(`  POST /api/request-access`);
    console.log(`  GET  /api/check-request/:requestId`);
    console.log(`  GET  /api/requests`);
    console.log(`  POST /webhook`);
    console.log(`  DELETE /api/cleanup`);
    console.log('\n✅ جاهز لاستقبال الطلبات!\n');
});