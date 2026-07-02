import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt'; 
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { pool } from './db.js';
import { checkGeofences, distanceToNearestBoundary } from './geofenceEngine.js';
import { auth, type AuthRequest } from './authMiddleware.js';
import crypto from 'crypto';

const app = express();        // tạo ứng dụng web
app.use(cors());              // cho phép frontend (cổng khác) gọi vào
app.use(express.json());      // tự đọc dữ liệu JSON gửi lên

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });  // bật WebSocket

// Khi một trình duyệt kết nối WebSocket
io.on('connection', (socket) => {
  console.log('Client kết nối:', socket.id);

  // Client gửi userId lên → server cho socket này vào phòng riêng
  socket.on('join', (userId: number) => {
    socket.join(`user:${userId}`);
    console.log(`Socket ${socket.id} đã vào phòng user:${userId}`);
  });
});

app.get('/api/subjects', auth, async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM subjects WHERE user_id = $1 ORDER BY id',
    [req.userId]                     // ← chỉ lấy đối tượng CỦA người đang đăng nhập
  );
  res.json(rows);
});

// Trả về true nếu subjectId thực sự thuộc về userId này
async function ownsSubject(subjectId: number, userId: number): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT 1 FROM subjects WHERE id = $1 AND user_id = $2',
    [subjectId, userId]
  );
  return rows.length > 0;
}

app.post('/api/subjects', auth, async (req: AuthRequest, res) => {
  const { name, note } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu tên đối tượng' });
  const { rows } = await pool.query(
    'INSERT INTO subjects (user_id, name, note) VALUES ($1, $2, $3) RETURNING *',
    [req.userId, name, note ?? null] // ← gán chủ sở hữu = người đang đăng nhập
  );
  res.json(rows[0]);
});

app.post('/api/positions', async (req: any, res: any) => {
  const { lat, lng, accuracy } = req.body;
  const token = req.headers['x-device-token'] as string;

  if (!token) return res.status(401).json({ error: 'Thiếu device token' });

  try {
    // Tra token → lấy device_id và subject_id
    const dev = await pool.query(
      'SELECT id, subject_id FROM devices WHERE device_token = $1',
      [token]
    );
    if (dev.rowCount === 0)
      return res.status(401).json({ error: 'Token không hợp lệ' });

    const { id: deviceId, subject_id: subjectId } = dev.rows[0];

    // Cập nhật last_seen_at
    await pool.query(
      'UPDATE devices SET last_seen_at = now() WHERE id = $1',
      [deviceId]
    );

    // Lưu vị trí (thêm device_id)
    await pool.query(
      `INSERT INTO positions (device_id, subject_id, geom, accuracy)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5)`,
      [deviceId, subjectId, lng, lat, accuracy ?? null]
    );

    // Lấy userId của owner để emit đúng room
    const owner = await pool.query(
      'SELECT user_id FROM subjects WHERE id = $1',
      [subjectId]
    );
    const ownerUserId = owner.rows[0].user_id;

    // Kiểm tra geofence
    const events = await checkGeofences(subjectId, lat, lng, accuracy ?? null);

    // Khoảng cách tới ranh giới gần nhất — tracker dùng để quyết định nhịp lấy mẫu (Bước 6.6)
    const distanceToEdge = await distanceToNearestBoundary(subjectId, lat, lng);

    // Emit chỉ vào room của owner
    io.to(`user:${ownerUserId}`).emit('position:update', { subjectId, lat, lng, accuracy });
    for (const ev of events) {
      io.to(`user:${ownerUserId}`).emit('geofence:alert', { subjectId, ...ev });
    }

    res.json({ ok: true, distanceToEdge });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Xác nhận thiết bị còn sống, KHÔNG cần tọa độ — rẻ hơn nhiều so với /api/positions.
// Dùng khi tracker đang gated (đứng yên), không có gì mới để gửi nhưng vẫn cần báo "còn hoạt động".
app.post('/api/devices/heartbeat', async (req: any, res: any) => {
  const token = req.headers['x-device-token'] as string;
  if (!token) return res.status(401).json({ error: 'Thiếu device token' });

  try {
    const result = await pool.query(
      'UPDATE devices SET last_seen_at = now() WHERE device_token = $1 RETURNING id',
      [token]
    );
    if (result.rowCount === 0) return res.status(401).json({ error: 'Thiết bị không hợp lệ' });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/positions/:subjectId', auth, async (req: AuthRequest, res) => {
  const { subjectId } = req.params;

  // Kiểm tra subject thuộc về user này
  if (!(await ownsSubject(Number(subjectId), req.userId!))) {
    return res.status(403).json({ error: 'Không có quyền' });
  }

  const { rows } = await pool.query(
    `SELECT ST_X(geom) AS lng, ST_Y(geom) AS lat, accuracy, recorded_at
     FROM positions
     WHERE subject_id = $1
     ORDER BY recorded_at DESC
     LIMIT 200`,
    [subjectId]
  );
  res.json(rows);
});

app.get('/api/events/:subjectId', auth, async (req: AuthRequest, res) => {
  const { subjectId } = req.params;

  if (!(await ownsSubject(Number(subjectId), req.userId!))) {
    return res.status(403).json({ error: 'Không có quyền' });
  }

  const { rows } = await pool.query(
    `SELECT e.id, e.type, e.confidence, e.occurred_at,
            g.name AS geofence_name
     FROM events e
     LEFT JOIN geofences g ON g.id = e.geofence_id
     WHERE e.subject_id = $1
     ORDER BY e.occurred_at DESC
     LIMIT 50`,
    [subjectId]
  );
  res.json(rows);
});

// ĐĂNG KÝ: nhận username + password → hash → lưu users → cấp vé luôn
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Thiếu username hoặc password' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);   // 10 = số vòng "salt", càng cao càng chậm & an toàn
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2)
       RETURNING id, username`,
      [username, hash]
    );
    const user = rows[0];
    // Cấp vé ngay sau khi đăng ký, để FE không phải gọi login lần nữa
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (e: any) {
    if (e.code === '23505') {   // mã lỗi PostgreSQL khi vi phạm UNIQUE (username trùng)
      return res.status(409).json({ error: 'Username đã tồn tại' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ĐĂNG NHẬP: tìm user → so mật khẩu bằng bcrypt → đúng thì ký vé
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query(
      `SELECT id, username, password_hash FROM users WHERE username = $1`,
      [username]
    );
    // Cố tình trả CÙNG một thông báo cho cả "sai user" lẫn "sai mật khẩu"
    // → không cho kẻ tấn công biết username nào có tồn tại.
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    }
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '1d' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Lưu một vùng an toàn (polygon) cho một đối tượng
app.post('/api/geofences', auth, async (req: AuthRequest, res) => {
  const { subjectId, name, points } = req.body;

  // CHẶN truy cập chéo trước khi làm bất cứ gì
  if (!(await ownsSubject(subjectId, req.userId!))) {
    return res.status(403).json({ error: 'Không có quyền với đối tượng này' });
  }

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

// Caregiver tạo thiết bị cho subject của mình
app.post('/api/devices', auth, async (req: any, res: any) => {
  const { subjectId, name } = req.body;

  // Kiểm tra subject thuộc về người đang gọi
  const own = await pool.query(
    'SELECT 1 FROM subjects WHERE id = $1 AND user_id = $2',
    [subjectId, req.userId]
  );
  if (own.rowCount === 0)
    return res.status(403).json({ error: 'Không sở hữu subject này' });

  const token = crypto.randomBytes(24).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO devices (subject_id, device_token, name)
     VALUES ($1, $2, $3) RETURNING id, device_token, name`,
    [subjectId, token, name]
  );
  res.json(rows[0]);
});

// Lấy danh sách thiết bị của một subject
app.get('/api/devices/:subjectId', auth, async (req: any, res: any) => {
  const { subjectId } = req.params;
  const own = await pool.query(
    'SELECT 1 FROM subjects WHERE id = $1 AND user_id = $2',
    [subjectId, req.userId]
  );
  if (own.rowCount === 0)
    return res.status(403).json({ error: 'Không sở hữu subject này' });

  const { rows } = await pool.query(
    'SELECT id, name, device_token, last_seen_at FROM devices WHERE subject_id = $1 ORDER BY id',
    [subjectId]
  );
  res.json(rows);
});

// Xóa một thiết bị (thu hồi token ngay lập tức)
app.delete('/api/devices/:id', auth, async (req: any, res: any) => {
  const { id } = req.params;
  const own = await pool.query(
    `SELECT d.id FROM devices d JOIN subjects s ON s.id = d.subject_id
     WHERE d.id = $1 AND s.user_id = $2`,
    [id, req.userId]
  );
  if (own.rowCount === 0)
    return res.status(403).json({ error: 'Không sở hữu thiết bị' });
  await pool.query('DELETE FROM devices WHERE id = $1', [id]);
  res.json({ ok: true });
});

// Xóa một subject (cascade devices/geofences/positions/events theo schema)
app.delete('/api/subjects/:id', auth, async (req: any, res: any) => {
  const { id } = req.params;
  const own = await pool.query(
    'SELECT 1 FROM subjects WHERE id = $1 AND user_id = $2',
    [id, req.userId]
  );
  if (own.rowCount === 0)
    return res.status(403).json({ error: 'Không sở hữu subject' });
  await pool.query('DELETE FROM subjects WHERE id = $1', [id]);
  res.json({ ok: true });
});

// Xóa một vùng an toàn
app.delete('/api/geofences/:id', auth, async (req: any, res: any) => {
  const { id } = req.params;
  const own = await pool.query(
    `SELECT g.id FROM geofences g JOIN subjects s ON s.id = g.subject_id
     WHERE g.id = $1 AND s.user_id = $2`,
    [id, req.userId]
  );
  if (own.rowCount === 0)
    return res.status(403).json({ error: 'Không sở hữu vùng này' });
  await pool.query('DELETE FROM geofences WHERE id = $1', [id]);
  res.json({ ok: true });
});

// Lấy danh sách vùng của một đối tượng (để frontend vẽ lên bản đồ)
app.get('/api/geofences/:subjectId', auth, async (req: AuthRequest, res) => {
  const { subjectId } = req.params;
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.type, g.active, ST_AsGeoJSON(g.geom) AS geojson
     FROM geofences g
     JOIN subjects s ON s.id = g.subject_id
     WHERE g.subject_id = $1 AND s.user_id = $2`,   // ← chỉ ra vùng nếu subject thuộc về mình
    [subjectId, req.userId]
  );
  res.json(rows.map((r) => ({
    id: r.id, name: r.name, type: r.type, active: r.active,
    geometry: JSON.parse(r.geojson),   // parse chuỗi → object, đổi tên thành geometry
  })));
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => console.log(`🚀 Server chạy ở cổng ${PORT}`));