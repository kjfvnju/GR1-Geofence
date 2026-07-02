import { pool } from './db.js';

type State = 'IN' | 'OUT';

interface FenceState {
  state: State;           // trạng thái hiện tại
  candidate: State | null; // ứng viên chờ xác nhận
  candidateSince: number | null; // thời điểm bắt đầu ứng viên (ms)
}

const DWELL_MS = 5_000; // 5 giây

const fenceStates = new Map<string, FenceState>();

export async function checkGeofences(
  subjectId: number, lat: number, lng: number, accuracy: number | null
) {
  const { rows } = await pool.query(
    `SELECT id, name,
            ST_Contains(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)) AS inside
     FROM geofences
     WHERE subject_id = $1 AND active = TRUE`,
    [subjectId, lng, lat]
  );

  const events = [];
  const now = Date.now();

  for (const fence of rows) {
    const key = `${subjectId}:${fence.id}`;
    const current: State = fence.inside ? 'IN' : 'OUT';

    // Lấy trạng thái cũ, hoặc khởi tạo nếu lần đầu gặp
    if (!fenceStates.has(key)) {
      fenceStates.set(key, { state: current, candidate: null, candidateSince: null });
      continue; // lần đầu tiên, chưa có gì để so sánh
    }

    const fs = fenceStates.get(key)!;

    if (current === fs.state) {
      // Vẫn giữ trạng thái cũ → hủy ứng viên nếu có
      fs.candidate = null;
      fs.candidateSince = null;
    } else {
      // Khác trạng thái cũ → xử lý ứng viên
      if (fs.candidate === current) {
        // Ứng viên này đang chờ — kiểm tra đã đủ thời gian chưa
        if (now - fs.candidateSince! >= DWELL_MS) {
          // ĐỦ thời gian → công nhận, bắn sự kiện thật
          const type = current === 'OUT' ? 'EXIT' : 'ENTER';
          const confidence = accuracy !== null
            ? Math.max(0, 1 - accuracy / 100)
            : null;

          await pool.query(
            `INSERT INTO events (subject_id, geofence_id, type, confidence)
             VALUES ($1, $2, $3, $4)`,
            [subjectId, fence.id, type, confidence]
          );
          events.push({ geofenceId: fence.id, geofenceName: fence.name, type, confidence });

          // Cập nhật trạng thái chính thức, xóa ứng viên
          fs.state = current;
          fs.candidate = null;
          fs.candidateSince = null;
        }
        // Chưa đủ thời gian → giữ nguyên ứng viên, chờ tiếp
      } else {
        // Ứng viên mới (lần đầu thấy trạng thái khác) → bắt đầu đếm thời gian
        fs.candidate = current;
        fs.candidateSince = now;
      }
    }
  }

  return events;
}

// Khoảng cách (mét) từ điểm hiện tại tới viền của geofence active GẦN NHẤT của subject.
// Trả về null nếu subject chưa có geofence active nào (không có gì để tính "gần" so với).
// Đo tới ST_Boundary (viền), không phải toàn bộ polygon: ST_Distance tới polygon trả về 0
// khi điểm nằm bên trong, không phân biệt được "sát viền từ bên trong" với "ở giữa vùng".
export async function distanceToNearestBoundary(
  subjectId: number, lat: number, lng: number
): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT MIN(
       ST_Distance(
         ST_Boundary(geom)::geography,
         ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
       )
     ) AS min_dist
     FROM geofences
     WHERE subject_id = $1 AND active = TRUE`,
    [subjectId, lng, lat]
  );
  const val = rows[0]?.min_dist;
  return val === null || val === undefined ? null : Number(val);
}