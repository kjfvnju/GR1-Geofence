import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, FeatureGroup } from 'react-leaflet';
import 'leaflet-draw';
import { EditControl } from 'react-leaflet-draw';
import { io } from 'socket.io-client';
import L from 'leaflet';

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

const socket = io('http://localhost:4000');
const SUBJECT_ID = 1;   // tuần 2 cố định; tuần 3 sẽ chọn theo tài khoản

type Pos = { lat: number; lng: number; accuracy?: number };
type Alert = { geofenceName: string; type: string; at: string };
// Geofence trả từ GET: { id, name, geometry: GeoJSON }
type Geofence = { id: number; name: string; geometry: any };

export default function App() {
  const [pos, setPos] = useState<Pos | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);

  // ---- Lấy danh sách vùng đã lưu để vẽ lên bản đồ (Bước 2.5) ----
  async function loadGeofences() {
    const res = await fetch(`http://localhost:4000/api/geofences/${SUBJECT_ID}`);
    const data = await res.json();
    setGeofences(data);
  }

  useEffect(() => {
    loadGeofences();   // gọi 1 lần khi mở trang

    // Nghe vị trí real-time
    socket.on('position:update', (data: Pos) => setPos(data));

    // Nghe cảnh báo geofence → thêm vào đầu danh sách
    socket.on('geofence:alert', (a: Alert) => {
      setAlerts((prev) => [a, ...prev].slice(0, 8));
    });

    return () => {
      socket.off('position:update');
      socket.off('geofence:alert');
    };
  }, []);

  // ---- Khi vẽ xong một vùng bằng chuột (Bước 2.2) ----
  async function handleCreated(e: any) {
    const layer = e.layer;
    // getLatLngs trả mảng lồng: [[ {lat,lng}, {lat,lng}, ... ]]
    const latlngs = layer.getLatLngs()[0];
    const points = latlngs.map((p: any) => [p.lat, p.lng]);  // [[lat,lng],...]

    const name = prompt('Tên vùng an toàn:', 'Vùng mới') || 'Vùng mới';

    const res = await fetch('http://localhost:4000/api/geofences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId: SUBJECT_ID, name, points }),
    });
    const data = await res.json();
    if (data.ok) {
      await loadGeofences();  // tải lại để vùng mới hiện ra
    } else {
      alert('Lỗi lưu vùng: ' + data.error);
    }
  }

  return (
    <div style={{ position: 'relative', height: '100vh' }}>
      {/* Banner cảnh báo đỏ — chỉ hiện khi có cảnh báo */}
      {alerts.length > 0 && (
        <div style={{
          position: 'absolute', top: 10, right: 10, zIndex: 1000,   // top tăng từ 10 → 80, né toolbar vẽ
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
            </div>
          ))}
        </div>
      )}

      <MapContainer center={[21.0285, 105.8542]} zoom={16} style={{ height: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap"
        />

        {/* Vẽ các vùng đã lưu (Bước 2.5). key ép React vẽ lại khi danh sách đổi */}
        {geofences.map((g) => (
          <GeoJSON key={g.id} data={g.geometry} style={{ color: '#d33', weight: 2 }} />
        ))}

        {/* Công cụ vẽ vùng bằng chuột (Bước 2.2) */}
        <FeatureGroup>
          <EditControl
            position="bottomleft"
            onCreated={handleCreated}
            draw={{
              polygon: true,    // bật vẽ đa giác
              rectangle: false, circle: false, marker: false,
              polyline: false, circlemarker: false,
            }}
            edit={{ edit: false, remove: false }}  // tuần 2 chưa cần sửa/xóa
          />
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