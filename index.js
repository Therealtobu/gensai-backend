const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');
const app = express();

app.use(cors());
app.use(express.json());

// =============================================================
// 👇 ĐIỀN THÔNG TIN API CỦA BẠN VÀO ĐÂY (NẾU RENDER KHÔNG NHẬN BIẾN)
// =============================================================
// Nếu bạn dùng Environment Variables trên Render thì giữ nguyên process.env...
// Nếu lỗi, hãy xóa process.env... và điền thẳng số ID/Key vào trong dấu nháy ''
const PARTNER_ID = process.env.PARTNER_ID || 'NHAP_ID_CUA_BAN_VAO_DAY'; 
const PARTNER_KEY = process.env.PARTNER_KEY || 'NHAP_KEY_CUA_BAN_VAO_DAY';

const MONGO_URI = process.env.MONGO_URI;
// Link API Gachthe1s.com
const API_URL = 'https://gachthe1s.com/chargingws/v2'; 

mongoose.connect(MONGO_URI)
    .then(() => console.log('DB Connected'))
    .catch(err => console.error('DB Error:', err));

const CardSchema = new mongoose.Schema({
    request_id: String,
    username: String,
    type: String,
    amount: Number,
    serial: String,
    pin: String,
    status: { type: String, default: 'pending' },
    real_amount: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
});
const Card = mongoose.model('Card', CardSchema);

// --- API GỬI THẺ (SỬA LẠI THEO ĐÚNG MẪU CURL) ---
app.post('/api/deposit', async (req, res) => {
    try {
        const { type, amount, serial, pin, username } = req.body;
        const request_id = Math.floor(Math.random() * 1000000000).toString();

        // 1. Lưu vào DB trước
        const newCard = new Card({ request_id, username, type, amount, serial, pin });
        await newCard.save();

        // 2. Tạo chữ ký (Signature)
        // Công thức chuẩn: MD5(partner_key + code + serial)
        const rawSignature = PARTNER_KEY + pin + serial;
        const signature = crypto.createHash('md5').update(rawSignature).digest('hex');

        // 3. Đóng gói dữ liệu (GIỐNG HỆT MẪU CURL)
        const payload = {
            telco: type,
            code: pin,
            serial: serial,
            amount: String(amount),           // Chuyển thành chuỗi
            request_id: String(request_id),   // Chuyển thành chuỗi
            partner_id: String(PARTNER_ID),   // Chuyển thành chuỗi
            sign: signature,
            command: 'charging'               // <--- QUAN TRỌNG: Lệnh nạp thẻ
        };

        console.log("Đang gửi sang Gachthe1s...", payload);

        // 4. Gửi yêu cầu POST JSON
        const response = await axios.post(API_URL, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log("Gachthe1s trả lời:", response.data);

        // Kiểm tra phản hồi ngay lập tức
        res.json({ status: 1, request_id: request_id, message: "Đã gửi thẻ thành công" });

    } catch (error) {
        console.error("Lỗi gửi thẻ:", error);
        res.status(500).json({ status: 0, message: 'Lỗi kết nối Server' });
    }
});

// --- API NHẬN KẾT QUẢ (CALLBACK) ---
app.post('/api/callback', async (req, res) => {
    try {
        console.log("Nhận Callback:", req.body);
        const { status, request_id, value } = req.body;
        
        const card = await Card.findOne({ request_id: request_id });
        if (card) {
            // Quy ước status của Gachthe1s:
            // 1: Thành công
            // 2: Thành công sai mệnh giá
            // 3, 4, 100: Lỗi/Thẻ sai
            if (status == 1) {
                card.status = 'success';
                card.real_amount = value;
            } else if (status == 2) {
                card.status = 'success';
                card.real_amount = value;
            } else if (status == 3 || status == 4 || status == 100) {
                card.status = 'wrong';
            }
            await card.save();
        }
        res.status(200).json({ status: 1, message: "Đã nhận" });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error');
    }
});

// --- API CHECK TRẠNG THÁI CHO WEB ---
app.get('/api/check/:id', async (req, res) => {
    try {
        const card = await Card.findOne({ request_id: req.params.id });
        if (!card) return res.json({ status: 'not_found' });
        res.json({ status: card.status, amount: card.real_amount > 0 ? card.real_amount : card.amount });
    } catch (error) {
        res.json({ status: 'error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
