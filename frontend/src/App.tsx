import { useCallback, useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, FeatureGroup, Polyline } from 'react-leaflet';
import 'leaflet-draw';
import { EditControl } from 'react-leaflet-draw';
import { io } from 'socket.io-client';
import L from 'leaflet';
import Login from './Login';
import { api, isLoggedIn, logout } from './api';
import DevicePage from './pages/DevicePage';
import { QRCodeSVG } from 'qrcode.react';

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

const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000; // 10 phút không nhận vị trí mới = coi là mất tín hiệu

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
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [geofenceId, setGeofenceId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pos = subjectId ? posMap[subjectId] ?? null : null;
  const trail = subjectId ? trailMap[subjectId] ?? [] : [];

  // now cập nhật mỗi 30s để badge/banner "mất tín hiệu" tự chuyển trạng thái đúng lúc,
  // không phải chờ một sự kiện khác (đổi subject, vị trí mới...) mới kích re-render
  function isDeviceOffline(lastSeenAt: string | null): boolean {
    if (!lastSeenAt) return true; // chưa từng gửi vị trí = coi như offline
    return now - new Date(lastSeenAt).getTime() > OFFLINE_THRESHOLD_MS;
  }

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

  // EFFECT tick — cập nhật "now" mỗi 30s để phát hiện offline theo thời gian thực.
  // Trình duyệt throttle mạnh setInterval khi tab ở nền (có thể vài phút mới chạy 1 lần) — nên
  // phải tính lại NGAY khi tab quay lại foreground, không đợi tick định kỳ tiếp theo.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    function handleVisibility() {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // EFFECT 2 — tải vùng mỗi khi đổi đối tượng
  useEffect(() => {
    if (!subjectId) {
      // Không còn đối tượng nào đang chọn (vd: vừa xóa đối tượng cuối cùng)
      // → xóa vùng đang vẽ trên bản đồ, tránh còn sót lại
      setGeofences([]);
      setGeofenceId(null);
      return;
    }

    let active = true;

    // Xóa dữ liệu cũ ngay khi đổi subject — tránh hiện nhầm
    setGeofences([]);
    setGeofenceId(null);

    // Tải vùng
    api.get(`/api/geofences/${subjectId}`)
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        setGeofences(list);
        setGeofenceId(list.length > 0 ? list[0].id : null);
      })
      .catch((e) => { console.error('Lỗi tải vùng:', e); if (active) { setGeofences([]); setGeofenceId(null); } });

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

  // EFFECT 3 — tải danh sách thiết bị mỗi khi đổi đối tượng
  useEffect(() => {
    if (!subjectId) { setDevices([]); setDeviceId(null); return; }
    let active = true;
    api.get(`/api/devices/${subjectId}`)
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        setDevices(list);
        setDeviceId(list.length > 0 ? list[0].id : null);
      })
      .catch((e) => {
        console.error('Lỗi tải thiết bị:', e);
        if (active) { setDevices([]); setDeviceId(null); }
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
  
  async function handleCreateDevice() {
    if (!subjectId) return alert('Chọn đối tượng trước');
    const name = prompt('Tên thiết bị (vd: Điện thoại ông Nam):')?.trim();
    if (!name) return;
    try {
      const data = await api.post('/api/devices', { subjectId, name });
      setDevices((prev) => [...prev, data]);
      setDeviceId(data.id);
      setQrUrl(`${window.location.origin}/device?token=${data.device_token}`);
    } catch {
      alert('Lỗi tạo thiết bị');
    }
  }

  function handleViewQR() {
    const dev = devices.find((d) => d.id === deviceId);
    if (!dev) return alert('Chưa có thiết bị nào');
    setQrUrl(`${window.location.origin}/device?token=${dev.device_token}`);
  }

  async function handleDeleteDevice() {
    if (!deviceId) return;
    const dev = devices.find((d) => d.id === deviceId);
    if (!confirm(`Xóa thiết bị "${dev?.name}"? Token mất hiệu lực ngay lập tức.`)) return;
    try {
      await api.delete(`/api/devices/${deviceId}`);
      const remaining = devices.filter((d) => d.id !== deviceId);
      setDevices(remaining);
      setDeviceId(remaining.length > 0 ? remaining[0].id : null);
    } catch {
      alert('Lỗi xóa thiết bị');
    }
  }

  async function handleDeleteSubject() {
    if (!subjectId) return;
    const subj = subjects.find((s) => s.id === subjectId);
    if (!confirm(`Xóa đối tượng "${subj?.name}"? Toàn bộ vùng, vị trí, nhật ký, thiết bị sẽ mất theo.`)) return;
    try {
      await api.delete(`/api/subjects/${subjectId}`);
      const remaining = subjects.filter((s) => s.id !== subjectId);
      setSubjects(remaining);
      setSubjectId(remaining.length > 0 ? remaining[0].id : null);
    } catch {
      alert('Lỗi xóa đối tượng');
    }
  }

  async function handleDeleteGeofence() {
    if (!geofenceId) return;
    const g = geofences.find((x) => x.id === geofenceId);
    if (!confirm(`Xóa vùng "${g?.name}"?`)) return;
    try {
      await api.delete(`/api/geofences/${geofenceId}`);
      const remaining = geofences.filter((x) => x.id !== geofenceId);
      setGeofences(remaining);
      setGeofenceId(remaining.length > 0 ? remaining[0].id : null);
    } catch {
      alert('Lỗi xóa vùng');
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
      const created = await api.post('/api/geofences', { subjectId, name, points });
      e.target.removeLayer(layer);   // gỡ hình "nháp" của draw...
      await loadGeofences();          // ...rồi vẽ lại từ DB bằng <GeoJSON>, có id thật
      setGeofenceId(created.id);      // tự chọn vùng vừa vẽ trong dropdown
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

  const offlineDevice = deviceId ? devices.find((d) => d.id === deviceId) : null;
  const showOfflineBanner = !!offlineDevice && isDeviceOffline(offlineDevice.last_seen_at);
  const offlineMinsAgo = showOfflineBanner && offlineDevice.last_seen_at
    ? Math.floor((now - new Date(offlineDevice.last_seen_at).getTime()) / 60000)
    : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="topbar__title">GR1 Geofence</span>
        <button onClick={onLogout} className="btn btn--logout">Đăng xuất</button>
      </header>

      <div className="map-area">
        {/* Banner trạng thái — luôn ở góc trên-phải, xếp cột, không đụng control Leaflet (trên-trái) */}
        <div className="status-stack">
          {showOfflineBanner && (
            <div className="banner banner--offline">
              ⚠ Mất tín hiệu thiết bị "{offlineDevice.name}"
              {offlineMinsAgo !== null ? ` — ${offlineMinsAgo} phút trước` : ' — chưa từng gửi vị trí'}
            </div>
          )}

          {alerts.length > 0 && (
            <div className="banner banner--breach">
              <div className="banner__head">
                <strong className="banner__title--breach">🚨 Cảnh báo ({alerts.length})</strong>
                <button onClick={() => setAlerts([])} className="btn btn--danger" style={{ minHeight: 28, padding: '2px 10px' }}>
                  Xóa hết
                </button>
              </div>
              {alerts.map((a, i) => (
                <div key={i} className="event-row">
                  <span className={`pill ${a.type === 'EXIT' ? 'pill--exit' : 'pill--enter'}`}>{a.type}</span>
                  {' '}{a.geofenceName}
                  <br />
                  <time>{new Date(a.at).toLocaleTimeString('vi-VN')}</time>
                  {a.confidence !== null && a.confidence < 0.5 && (
                    <div className="low-confidence">⚠ Độ tin cậy thấp (GPS nhiễu)</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Panel điều khiển — gom theo nhóm, tự xuống dòng có kiểm soát, không tràn ra ngoài */}
        <div className="control-panel">
          <div className="control-group">
            <label className="control-group__label" htmlFor="subject-select">Đối tượng</label>
            <div className="control-group__row">
              <select id="subject-select" value={subjectId ?? ''} onChange={(e) => setSubjectId(Number(e.target.value))}>
                {subjects.length === 0 ? (
                  <option value="">Chưa có đối tượng</option>
                ) : (
                  subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)
                )}
              </select>
              <button onClick={handleAddSubject} className="btn">Thêm</button>
              <button onClick={handleDeleteSubject} disabled={!subjectId} className="btn btn--danger">Xóa</button>
            </div>
          </div>

          <div className="control-group">
            <label className="control-group__label" htmlFor="device-select">Thiết bị</label>
            <div className="control-group__row">
              <select id="device-select" value={deviceId ?? ''} onChange={(e) => setDeviceId(Number(e.target.value))}>
                {devices.length === 0 ? (
                  <option value="">Chưa có thiết bị</option>
                ) : (
                  devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}{isDeviceOffline(d.last_seen_at) ? ' · mất tín hiệu' : ' · còn hoạt động'}
                    </option>
                  ))
                )}
              </select>
              <button onClick={handleCreateDevice} className="btn">Thêm</button>
              <button onClick={handleViewQR} disabled={!deviceId} className="btn">Xem QR</button>
              <button onClick={handleDeleteDevice} disabled={!deviceId} className="btn btn--danger">Xóa</button>
            </div>
          </div>

          <div className="control-group">
            <label className="control-group__label" htmlFor="geofence-select">Vùng an toàn</label>
            <div className="control-group__row">
              <select id="geofence-select" value={geofenceId ?? ''} onChange={(e) => setGeofenceId(Number(e.target.value))}>
                {geofences.length === 0 ? (
                  <option value="">Chưa có vùng</option>
                ) : (
                  geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)
                )}
              </select>
              <button onClick={handleDeleteGeofence} disabled={!geofenceId} className="btn btn--danger">Xóa</button>
            </div>
          </div>

          <div className="control-group" style={{ minWidth: 100, flex: '0 1 auto' }}>
            <label className="control-group__label">Nhật ký</label>
            <div className="control-group__row">
              <button onClick={handleOpenLog} className="btn">Xem nhật ký</button>
            </div>
          </div>
        </div>

        {showLog && (
          <div className="modal-overlay" onClick={() => setShowLog(false)}>
            <div className="modal-card" style={{ maxWidth: 480, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-card__head">
                <strong>📋 Nhật ký cảnh báo</strong>
                <button onClick={() => setShowLog(false)} className="icon-btn" aria-label="Đóng">✕</button>
              </div>

              {eventLog.length === 0 ? (
                <p className="empty-state">Chưa có sự kiện nào — cảnh báo ENTER/EXIT sẽ hiện ở đây khi phát sinh.</p>
              ) : (
                <div style={{ overflowY: 'auto' }}>
                  {eventLog.map((e) => (
                    <div key={e.id} className="event-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span className={`pill ${e.type === 'EXIT' ? 'pill--exit' : 'pill--enter'}`} style={{ marginRight: 8 }}>
                          {e.type}
                        </span>
                        <span>{e.geofence_name ?? 'Vùng đã xóa'}</span>
                        {e.confidence !== null && e.confidence < 0.5 && (
                          <div className="low-confidence">⚠ Độ tin cậy thấp</div>
                        )}
                      </div>
                      <time style={{ whiteSpace: 'nowrap', marginLeft: 12 }}>
                        {new Date(e.occurred_at).toLocaleString('vi-VN')}
                      </time>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {qrUrl && (
          <div className="modal-overlay" onClick={() => setQrUrl(null)}>
            <div className="modal-card" style={{ maxWidth: 320, display: 'flex', flexDirection: 'column', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-card__head" style={{ width: '100%' }}>
                <strong>Quét để kích hoạt thiết bị</strong>
                <button onClick={() => setQrUrl(null)} className="icon-btn" aria-label="Đóng">✕</button>
              </div>

              <div style={{ background: '#fff', padding: 12, borderRadius: 8 }}>
                <QRCodeSVG value={qrUrl} size={200} />
              </div>

              <p className="mono" style={{ textAlign: 'center', marginTop: 16, wordBreak: 'break-all', fontSize: 11 }}>
                {qrUrl}
              </p>

              <button
                onClick={() => { navigator.clipboard.writeText(qrUrl); alert('Đã copy link'); }}
                className="btn"
                style={{ marginTop: 8 }}
              >
                Copy link
              </button>
            </div>
          </div>
        )}

        <MapContainer center={[21.0285, 105.8542]} zoom={15} attributionControl={false} style={{ height: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {/* Vẽ các vùng đã lưu. Vùng đang chọn trong dropdown "Xóa vùng" tô amber đậm để phân biệt */}
          {geofences.map((g) => (
            <GeoJSON
              key={g.id}
              data={g.geometry}
              style={{
                color: g.id === geofenceId ? 'var(--signal)' : 'var(--breach)',
                weight: g.id === geofenceId ? 4 : 2,
              }}
              onEachFeature={(_feature, layer) => {
                layer.bindTooltip(g.name, { permanent: true, direction: 'center', className: 'geofence-label' });
              }}
            />
          ))}
          {/* Vết hành trình */}
          {trail.length > 1 && (
            <Polyline positions={trail} color="var(--signal)" weight={2} opacity={0.7} />
          )}

          {/* Công cụ vẽ vùng — Leaflet tự quản lý góc trên-trái, KHÔNG đặt UI riêng vào góc này */}
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
              <Popup>Vị trí hiện tại<br />Sai số: {pos.accuracy != null ? Math.round(pos.accuracy) : '?'}m</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
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