import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { pool } from './db';

const app = express();        // tạo ứng dụng web
app.use(cors());              // cho phép frontend (cổng khác) gọi vào
app.use(express.json());      // tự đọc dữ liệu JSON gửi lên

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });  // bật WebSocket

// Khi một trình duyệt kết nối WebSocket
io.on('connection', (socket) => {
  console.log('Client kết nối:', socket.id);
});

// API nhận vị trí mới. async vì bên trong có await gọi database.
app.post('/api/positions', async (req, res) => {
  const { subjectId, lat, lng, accuracy } = req.body;  // tách dữ liệu gửi lên
  try {
    // Lưu điểm vào database. CHÚ Ý: ST_MakePoint(lng, lat) — kinh độ TRƯỚC!
    const result = await pool.query(
      `INSERT INTO positions (subject_id, geom, accuracy)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4)
       RETURNING id`,
      [subjectId, lng, lat, accuracy ?? null]
    );

    // Đẩy vị trí mới cho mọi trình duyệt đang xem (tuần 2 sẽ thêm kiểm tra geofence ở đây)
    io.emit('position:update', { subjectId, lat, lng, accuracy });

    res.json({ ok: true, id: result.rows[0].id });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`🚀 Server chạy ở cổng ${PORT}`));