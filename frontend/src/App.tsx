import { useCallback, useEffect, useState } from 'react';
import { AttributionControl, MapContainer, TileLayer, Marker, Popup, GeoJSON, FeatureGroup, Polyline } from 'react-leaflet';
import 'leaflet-draw';
import { EditControl } from 'react-leaflet-draw';
import { io } from 'socket.io-client';
import L from 'leaflet';
import Login from './Login';
import { api, isLoggedIn, logout } from './api';
import DevicePage from './pages/DevicePage';

// Sửa lỗi icon marker mặc định bị mất khi dùng Vite (đã làm từ Tuần 1)
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
L.Marker.prototype.options.icon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],       // kích thước thật của hình
  iconAnchor: [12, 41],     // điểm gắn = giữa đáy (đuôi nhọn)
  popupAnchor: [1, -34],    // popup nổi lên trên đầu marker
  shadowSize: [41, 41],
});

const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:4000');

type Pos = { lat: number; lng: number; accuracy?: number };
type Alert = { geofenceName: string; type: string; at: string; confidence: number | null };
// Geofence trả từ GET: { id, name, geometry: GeoJSON }
type Geofence = { id: number; name: string; geometry: any };

function MapView({ onLogout }: { onLogout: () => void }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);          // danh sách đối tượng của tài khoản
  const [subjectId, setSubjectId] = useState<number | null>(null);  // đối tượng đang xem; null = chưa chọn
  const [showLog, setShowLog] = useState(false);
  const [eventLog, setEventLog] = useState<any[]>([]);
  const [posMap, setPosMap] = useState<Record<number, Pos>>({});
  const [trailMap, setTrailMap] = useState<Record<number, [number, number][]>>({});

  const pos = subjectId ? posMap[subjectId] ?? null : null;
  const trail = subjectId ? trailMap[subjectId] ?? [] : [];

  const loadGeofences = useCallback(async () => {
    if (!subjectId) return;     // chưa chọn đối tượng thì chưa tải gì
    try {
      const data = await api.get(`/api/geofences/${subjectId}`);
      setGeofences(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Lỗi tải vùng:', e);
      setGeofences([]);
    }
  }, [subjectId]);   // chỉ tạo lại hàm khi subjectId đổi

  // EFFECT 1 — socket: gắn MỘT LẦN lúc mở trang, gỡ khi rời trang
  useEffect(() => {
    const userId = Number(sessionStorage.getItem('userId'));
    socket.emit('join', userId);

    socket.on('position:update', (data: any) => {
      setPosMap((prev) => ({ ...prev, [data.subjectId]: { lat: data.lat, lng: data.lng, accuracy: data.accuracy } }));
      setTrailMap((prev) => ({
        ...prev,
        [data.subjectId]: [[data.lat, data.lng] as [number, number], ...(prev[data.subjectId] ?? [])].slice(0, 200),
     }));
    });
    socket.on('geofence:alert', (a: any) => {
      setAlerts((prev) => [a, ...prev].slice(0, 20));
    });

    return () => {
      socket.off('position:update');
      socket.off('geofence:alert');
    };
  }, []);

  // EFFECT 2 — tải vùng mỗi khi đổi đối tượng
  useEffect(() => {
    if (!subjectId) return;

    let active = true;

    // Xóa dữ liệu cũ ngay khi đổi subject — tránh hiện nhầm
    setGeofences([]);

    // Tải vùng
    api.get(`/api/geofences/${subjectId}`)
      .then((data) => { if (active) setGeofences(Array.isArray(data) ? data : []); })
      .catch((e) => { console.error('Lỗi tải vùng:', e); if (active) setGeofences([]); });

    // Tải lịch sử hành trình
    api.get(`/api/positions/${subjectId}`)
      .then((data) => {
        if (active) {
          const points: [number, number][] = Array.isArray(data)
            ? data.map((p: any) => [p.lat, p.lng])
            : [];
          if (active) {
            setTrailMap((prev) => ({ ...prev, [subjectId]: points }));
            if (points.length > 0) {
              setPosMap((prev) => ({ ...prev, [subjectId]: { lat: points[0][0], lng: points[0][1] } }));
            }
          }
        }
      })
      .catch((e) => { 
        console.error('Lỗi tải hành trình:', e); 
        if (active) setTrailMap((prev) => ({ ...prev, [subjectId]: [] }));
      });
      
    return () => { active = false; };
  }, [subjectId]);

  useEffect(() => {
    async function loadSubjects() {
      try {
        const data = await api.get('/api/subjects');     // token tự đính, chỉ trả subject của mình
        const list = Array.isArray(data) ? data : [];
        setSubjects(list);
        if (list.length > 0) setSubjectId(list[0].id);   // tự chọn cái đầu tiên cho tiện
      } catch (e) {
        console.error('Lỗi tải đối tượng:', e);
      }
    }
    void loadSubjects();   // void: nói rõ "cố tình không chờ" — tránh cảnh báo ESLint Tuần 2 bạn gặp
  }, []);

  async function handleAddSubject() {
    const name = prompt('Tên đối tượng (vd: Ông Nam):')?.trim();
    if (!name) return;                       // bấm Cancel (null) hoặc bỏ trống → không làm gì
    try {
      const created = await api.post('/api/subjects', { name });
      setSubjects((prev) => [...prev, created]);   // thêm vào danh sách đang có
      setSubjectId(created.id);                     // tự chọn đối tượng vừa tạo
    } catch (e) {
      console.error('Lỗi thêm đối tượng:', e);
      alert('Không thêm được đối tượng. Thử lại.');
    }
  }

  // ---- Khi vẽ xong một vùng bằng chuột (Bước 2.2) ----
  async function handleCreated(e: any) {
    const layer = e.layer;

    // Chưa chọn đối tượng → báo, gỡ hình vừa vẽ, dừng
    if (!subjectId) {
      alert('Hãy chọn hoặc tạo đối tượng trước khi vẽ vùng');
      e.target.removeLayer(layer);   // gỡ bóng ma khỏi bản đồ
      return;
    }

    const latlngs = layer.getLatLngs()[0];
    const points = latlngs.map((p: any) => [p.lat, p.lng]);
    const name = prompt('Tên vùng an toàn:', 'Vùng mới') || 'Vùng mới';

    try {
      await api.post('/api/geofences', { subjectId, name, points });
      e.target.removeLayer(layer);   // gỡ hình "nháp" của draw...
      await loadGeofences();          // ...rồi vẽ lại từ DB bằng <GeoJSON>, có id thật
    } catch (err: any) {
      alert('Lỗi lưu vùng: ' + err.message);
      e.target.removeLayer(layer);   // lưu hỏng cũng gỡ, không để bóng ma
    }
  }

  async function handleOpenLog() {
    if (!subjectId) return;
    try {
      const data = await api.get(`/api/events/${subjectId}`);
      setEventLog(Array.isArray(data) ? data : []);
      setShowLog(true);
    } catch (e) {
      console.error('Lỗi tải nhật ký:', e);
    }
  }

  return (
    <div style={{ position: 'relative', height: '100vh' }}>
      <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 1000, display: 'flex', gap: 8 }}>
        <select
          value={subjectId ?? ''}
          onChange={(e) => setSubjectId(Number(e.target.value))}
          style={{ padding: '6px 12px', fontSize: 13, borderRadius: 4, border: '1px solid #999' }}
        >
          {subjects.length === 0 ? (
            <option value="">Chưa có đối tượng</option>
          ) : (
            subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))
          )}
        </select>
        <button
          onClick={handleAddSubject}
          style={{ padding: '6px 12px', fontSize: 13, borderRadius: 4, border: '1px solid #999', background: '#fff', cursor: 'pointer' }}
        >
          Thêm đối tượng
        </button>
        <button
          onClick={handleOpenLog}
          style={{ padding: '6px 12px', fontSize: 13, borderRadius: 4, border: '1px solid #999', background: '#fff', cursor: 'pointer' }}
        >
          📋 Nhật ký
        </button>
      </div>
      <button
        onClick={onLogout}
        style={{
          position: 'absolute', bottom: 22, right: 2, zIndex: 1000,
          padding: '6px 12px', background: '#fff',
          border: '1px solid #999', borderRadius: 4, cursor: 'pointer',
        }}
      >
        Đăng xuất
      </button>
      {/* Banner cảnh báo đỏ — chỉ hiện khi có cảnh báo */}
      {alerts.length > 0 && (
        <div style={{
          position: 'absolute', top: 10, right: 10, zIndex: 1000, 
          width: 300, maxHeight: '40vh', overflowY: 'auto',
          background: '#fff', border: '2px solid #d33', borderRadius: 8,
          padding: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <strong style={{ color: '#d33' }}>🚨 Cảnh báo ({alerts.length})</strong>
            <button
              onClick={() => setAlerts([])}
              style={{
                background: '#fff',
                color: '#d33',
                border: '1px solid #d33',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Xóa hết
            </button>
          </div>
          {alerts.map((a, i) => (
            <div key={i} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee' }}>
              <b>{a.type}</b> — {a.geofenceName}<br />
              <small>{new Date(a.at).toLocaleTimeString()}</small>
              {/* Thêm dòng này */}
              {a.confidence !== null && a.confidence < 0.5 && (
                <div style={{ color: '#e67e00', fontSize: 12, marginTop: 2 }}>
                  ⚠ Độ tin cậy thấp (GPS nhiễu)
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showLog && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2000,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#fff', borderRadius: 8, padding: 20,
            width: 480, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 16 }}>📋 Nhật ký cảnh báo</strong>
              <button
                onClick={() => setShowLog(false)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              >✕</button>
            </div>

            {eventLog.length === 0 ? (
              <p style={{ color: '#999', textAlign: 'center', marginTop: 20 }}>Chưa có sự kiện nào</p>
            ) : (
              <div style={{ overflowY: 'auto' }}>
                {eventLog.map((e) => (
                  <div key={e.id} style={{
                    padding: '10px 0', borderBottom: '1px solid #eee',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                  }}>
                    <div>
                      <span style={{
                        background: e.type === 'EXIT' ? '#d33' : '#2a9d2a',
                        color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 12, marginRight: 8,
                      }}>
                        {e.type}
                      </span>
                      <span>{e.geofence_name ?? 'Vùng đã xóa'}</span>
                      {e.confidence !== null && e.confidence < 0.5 && (
                        <span style={{ color: '#e67e00', fontSize: 12, marginLeft: 8 }}>⚠ Tin cậy thấp</span>
                      )}
                    </div>
                    <small style={{ color: '#999', whiteSpace: 'nowrap', marginLeft: 12 }}>
                      {new Date(e.occurred_at).toLocaleString('vi-VN')}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <MapContainer center={[21.0285, 105.8542]} zoom={15} attributionControl={false} style={{ height: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap"
        />
        <AttributionControl prefix={false} />
        {/* Vẽ các vùng đã lưu (Bước 2.5). key ép React vẽ lại khi danh sách đổi */}
        {geofences.map((g) => (
          <GeoJSON key={g.id} data={g.geometry} style={{ color: '#d33', weight: 2 }} />
        ))}
        {/* Vết hành trình — đường xanh nối các điểm đã đi */}
        {trail.length > 1 && (
          <Polyline positions={trail} color="blue" weight={2} opacity={0.6} />
        )}

        {/* Công cụ vẽ vùng bằng chuột (Bước 2.2) */}
        <FeatureGroup>
          {subjectId && (
            <EditControl
              position="topleft"
              onCreated={handleCreated}
              draw={{ polygon: true, rectangle: false, circle: false,
                      marker: false, polyline: false, circlemarker: false }}
              edit={{ edit: false, remove: false }}
            />
          )}
        </FeatureGroup>

        {/* Marker vị trí hiện tại */}
        {pos && (
          <Marker position={[pos.lat, pos.lng]}>
            <Popup>Vị trí hiện tại<br />Sai số: {pos.accuracy ?? '?'}m</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());

  // Nếu đang ở trang /device → render riêng, không cần đăng nhập
  if (window.location.pathname === '/device') {
    return <DevicePage />;
  }

  if (!loggedIn) {
    return <Login onDone={() => setLoggedIn(true)} />;
  }

  return (
    <MapView onLogout={() => { logout(); setLoggedIn(false); }} />
  );
}