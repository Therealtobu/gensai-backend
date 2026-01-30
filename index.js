const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');
const app = express();

app.use(cors());
app.use(express.json());

// Lấy thông tin bảo mật từ Render
const PARTNER_ID = process.env.PARTNER_ID;
const PARTNER_KEY = process.env.PARTNER_KEY;
const MONGO_URI = process.env.MONGO_URI;

// Kết nối Database
mongoose.connect(MONGO_URI)
    .then(() => console.log('DB Connected'))
    .catch(err => console.error('DB Error:', err));

// Định nghĩa đơn nạp
const CardSchema = new mongoose.Schema({
    request_id: String,
    username: String,
    type: String,
    amount: Number,
    serial: String,
    pin: String,
    status: { type: String, default: 'pending' }, // pending: đang chờ, success: thành công, wrong: sai
    real_amount: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
});
const Card = mongoose.model('Card', CardSchema);

// API 1: Web khách gửi thẻ lên
app.post('/api/deposit', async (req, res) => {
    try {
        const { type, amount, serial, pin, username } = req.body;
        const request_id = Math.floor(Math.random() * 1000000000).toString();

        // Lưu vào DB
        const newCard = new Card({ request_id, username, type, amount, serial, pin });
        await newCard.save();

        // Tạo chữ ký gửi Thesieure
        const rawSignature = PARTNER_KEY + pin + serial;
        const signature = crypto.createHash('md5').update(rawSignature).digest('hex');

        // Gửi sang Thesieure
        const payload = {
            partner_id: PARTNER_ID,
            request_id: request_id,
            telco: type,
            amount: amount,
            serial: serial,
            code: pin,
            sign: signature
        };

        await axios.post('https://thesieure.com/chargingws/v2', payload);
        res.json({ status: 1, request_id: request_id, message: "Đã gửi thẻ" });

    } catch (error) {
        res.status(500).json({ status: 0, message: 'Lỗi Server hoặc API TSR' });
    }
});

// API 2: Thesieure báo kết quả về (Callback)
app.post('/api/callback', async (req, res) => {
    try {
        const { status, request_id, value } = req.body;
        const card = await Card.findOne({ request_id: request_id });
        
        if (card) {
            if (status == 1) {
                card.status = 'success';
                card.real_amount = value;
            } else {
                card.status = 'wrong';
            }
            await card.save();
        }
        res.status(200).send('OK');
    } catch (error) {
        res.status(500).send('Error');
    }
});

// API 3: Web khách hỏi xem thẻ đúng chưa
app.get('/api/check/:id', async (req, res) => {
    try {
        const card = await Card.findOne({ request_id: req.params.id });
        if (!card) return res.json({ status: 'pending' });
        res.json({ status: card.status, amount: card.real_amount > 0 ? card.real_amount : card.amount });
    } catch (error) {
        res.json({ status: 'error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
