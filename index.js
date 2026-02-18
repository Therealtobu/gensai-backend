const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');
const app = express();

app.use(cors());
app.use(express.json()); // Quan trọng: Để đọc được JSON từ Gachthe1s gửi về

// --- CẤU HÌNH ---
const PARTNER_ID = process.env.PARTNER_ID;
const PARTNER_KEY = process.env.PARTNER_KEY;
const MONGO_URI = process.env.MONGO_URI;

// Link API Gachthe1s (Kiểm tra kỹ trong tài liệu của họ, thường là link này)
const API_URL = 'https://gachthe1s.com/chargingws/v2'; 

// Kết nối Database
mongoose.connect(MONGO_URI)
    .then(() => console.log('DB Connected'))
    .catch(err => console.error('DB Error:', err));

// Khuôn mẫu lưu thẻ
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

// --- PHẦN 1: GỬI THẺ LÊN (Web của bạn gọi cái này) ---
app.post('/api/deposit', async (req, res) => {
    try {
        const { type, amount, serial, pin, username } = req.body;
        const request_id = Math.floor(Math.random() * 1000000000).toString();

        // 1. Lưu vào DB trạng thái đang chờ
        const newCard = new Card({ request_id, username, type, amount, serial, pin });
        await newCard.save();

        // 2. Tạo chữ ký (Signature) theo công thức Gachthe1s
        // Công thức: MD5(partner_key + code + serial)
        // Lưu ý: code là mã thẻ (pin)
        const rawSignature = PARTNER_KEY + pin + serial;
        const signature = crypto.createHash('md5').update(rawSignature).digest('hex');

        // 3. Đóng gói dữ liệu gửi đi
        const payload = {
            partner_id: PARTNER_ID,
            request_id: request_id,
            telco: type,
            amount: parseInt(amount),
            serial: serial,
            code: pin,
            sign: signature
        };

        console.log("Đang gửi sang Gachthe1s...", payload);

        // 4. Gửi yêu cầu POST
        const response = await axios.post(API_URL, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log("Gachthe1s trả lời:", response.data);

        // Gachthe1s trả về JSON, ta kiểm tra status ngay lập tức
        // Thường status 99 là chờ xử lý -> OK
        res.json({ status: 1, request_id: request_id, message: "Đã gửi thẻ thành công" });

    } catch (error) {
        console.error("Lỗi gửi thẻ:", error);
        res.status(500).json({ status: 0, message: 'Lỗi kết nối Server' });
    }
});

// --- PHẦN 2: NHẬN KẾT QUẢ TRẢ VỀ (Gachthe1s gọi cái này) ---
// Đây chính là cái "Post Json" mà bạn nói
app.post('/api/callback', async (req, res) => {
    try {
        console.log("Nhận Callback từ Gachthe1s:", req.body);

        // Lấy dữ liệu họ gửi về
        const { status, request_id, value, message } = req.body;
        
        // Tìm cái thẻ tương ứng trong DB
        const card = await Card.findOne({ request_id: request_id });
        
        if (card) {
            // Xử lý trạng thái (Theo tài liệu Gachthe1s)
            // 1: Thành công
            // 2: Thành công sai mệnh giá
            // 3, 4, 100: Thất bại
            
            if (status == 1) {
                card.status = 'success';
                card.real_amount = value; // Đúng mệnh giá
            } else if (status == 2) {
                card.status = 'success';
                card.real_amount = value; // Sai mệnh giá (nhận giá trị thực)
            } else if (status == 3 || status == 4 || status == 100) {
                card.status = 'wrong'; // Thẻ lỗi/sai
            } else {
                // Các trạng thái khác (99) thì vẫn để pending
            }
            
            await card.save();
        }
        
        // Bắt buộc phản hồi lại cho Gachthe1s là đã nhận
        res.status(200).json({ status: 1, message: "Đã nhận callback" });

    } catch (error) {
        console.error("Lỗi Callback:", error);
        res.status(500).send('Error');
    }
});

// --- PHẦN 3: WEB KHÁCH HỎI THĂM (Polling) ---
app.get('/api/check/:id', async (req, res) => {
    try {
        const card = await Card.findOne({ request_id: req.params.id });
        if (!card) return res.json({ status: 'not_found' });
        
        // Trả về cho Frontend biết
        res.json({ 
            status: card.status, 
            amount: card.real_amount > 0 ? card.real_amount : card.amount 
        });
    } catch (error) {
        res.json({ status: 'error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
