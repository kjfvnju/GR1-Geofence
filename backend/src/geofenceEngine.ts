import { pool } from './db';

// Bộ nhớ trạng thái: với mỗi cặp (subject, fence), điểm gần nhất đang IN hay OUT.
// Map sống trong RAM khi server chạy. Tuần 4 ta sẽ bàn hạn chế của cách này.
const lastState = new Map<string, 'IN' | 'OUT'>();

export async function checkGeofences(subjectId: number, lat: number, lng: number, accuracy: number | null) {
  // Hỏi PostGIS: với mỗi vùng ĐANG BẬT của subject này, điểm có nằm trong không?
  // ST_Contains(vùng, điểm) = true nếu điểm nằm trong đa giác.
  const { rows } = await pool.query(
    `SELECT id, name,
            ST_Contains(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)) AS inside
     FROM geofences
     WHERE subject_id = $1 AND active = TRUE`,
    [subjectId, lng, lat]   // CẠM BẪY: lng trước lat (ST_MakePoint)
  );

  const events = [];
  for (const fence of rows) {
    const key = `${subjectId}:${fence.id}`;               // khóa định danh cặp
    const now: 'IN' | 'OUT' = fence.inside ? 'IN' : 'OUT'; // trạng thái hiện tại
    const prev = lastState.get(key);                       // trạng thái lần trước

    // Chỉ phát sự kiện khi trạng thái THAY ĐỔI.
    // prev phải tồn tại (đã có lần đo trước) thì so sánh mới có nghĩa.
    if (prev && prev !== now) {
      const type = now === 'OUT' ? 'EXIT' : 'ENTER';
      // Tính confidence từ accuracy
      const confidence = accuracy !== null ? Math.max(0, 1 - accuracy / 100) : null;
      await pool.query(
        `INSERT INTO events (subject_id, geofence_id, type, confidence) VALUES ($1, $2, $3, $4)`,
        [subjectId, fence.id, type, confidence]
      );
      events.push({ geofenceId: fence.id, geofenceName: fence.name, type, confidence });
    }

    lastState.set(key, now);  // luôn cập nhật trạng thái cho lần đo sau
  }

  return events;  // mảng sự kiện vừa phát (thường rỗng; chỉ có khi vừa đổi trạng thái)
}