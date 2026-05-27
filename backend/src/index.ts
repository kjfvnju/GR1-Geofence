import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { pool } from './db';
import { checkGeofences } from './geofenceEngine';

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

    // (sau khi đã INSERT điểm vào positions thành công, TRƯỚC khi res.json)
    const events = await checkGeofences(subjectId, lat, lng);

    // Đẩy vị trí mới cho mọi trình duyệt đang xem (tuần 2 sẽ thêm kiểm tra geofence ở đây)
    io.emit('position:update', { subjectId, lat, lng, accuracy });
    
    for (const ev of events) {
      io.emit('geofence:alert', {
        subjectId,
        ...ev,
        at: new Date().toISOString(),
      });
    }

    res.json({ ok: true, id: result.rows[0].id });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Lưu một vùng an toàn (polygon) cho một đối tượng
app.post('/api/geofences', async (req, res) => {
  const { subjectId, name, points } = req.body;  // points: mảng [[lat,lng],...]
  try {
    const ring = [...points];
    const first = ring[0];
    const last = ring[ring.length - 1];
    // PostGIS yêu cầu đa giác ĐÓNG: đỉnh cuối phải trùng đỉnh đầu
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);

    // Tạo chuỗi WKT mô tả đa giác. Lại nhớ: "lng lat" — kinh độ TRƯỚC
    const wkt = `POLYGON((${ring.map(([lat, lng]) => `${lng} ${lat}`).join(', ')}))`;

    const result = await pool.query(
      `INSERT INTO geofences (subject_id, name, geom, type)
       VALUES ($1, $2, ST_GeomFromText($3, 4326), 'polygon')
       RETURNING id`,
      [subjectId, name, wkt]
    );
    res.json({ ok: true, id: result.rows[0].id });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Lấy danh sách vùng của một đối tượng (để frontend vẽ lên bản đồ)
app.get('/api/geofences/:subjectId', async (req, res) => {
  const { subjectId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, name, type, active,
              ST_AsGeoJSON(geom) AS geojson
       FROM geofences
       WHERE subject_id = $1
       ORDER BY id`,
      [subjectId]
    );

    const geofences = rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      active: r.active,
      geometry: JSON.parse(r.geojson),   // chuỗi → object, đổi tên thành geometry
    }));

    res.json(geofences);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`🚀 Server chạy ở cổng ${PORT}`));