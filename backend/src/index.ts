import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt'; 
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { pool } from './db';
import { checkGeofences } from './geofenceEngine';
import { auth, type AuthRequest } from './authMiddleware';

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

// API nhận vị trí mới. async vì bên trong có await gọi database.
app.post('/api/positions', async (req, res) => {
  const { subjectId, lat, lng, accuracy } = req.body;
  try {
    // 1. Lưu điểm vào DB
    const result = await pool.query(
      `INSERT INTO positions (subject_id, geom, accuracy)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4)
       RETURNING id`,
      [subjectId, lng, lat, accuracy ?? null]
    );

    // 2. Kiểm tra geofence
    const events = await checkGeofences(subjectId, lat, lng, accuracy ?? null);

    // 3. Tra user_id của chủ subject — để emit đúng phòng
    //    Nếu subjectId không tồn tại thì ownerRow.rows rỗng → dùng optional chaining
    const ownerRow = await pool.query(
      'SELECT user_id FROM subjects WHERE id = $1',
      [subjectId]
    );
    const ownerUserId: number | undefined = ownerRow.rows[0]?.user_id;

    // 4. Emit vị trí — chỉ vào phòng của chủ subject
    if (ownerUserId !== undefined) {
      io.to(`user:${ownerUserId}`).emit('position:update', {
        subjectId, lat, lng, accuracy,
      });

      for (const ev of events) {
        io.to(`user:${ownerUserId}`).emit('geofence:alert', {
          subjectId,
          ...ev,
          at: new Date().toISOString(),
        });
      }
    }

    res.json({ ok: true, id: result.rows[0].id });
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