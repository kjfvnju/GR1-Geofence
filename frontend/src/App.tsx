import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { io } from 'socket.io-client';
import L from 'leaflet';

// Sửa lỗi icon marker mặc định bị mất khi dùng Vite
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
L.Marker.prototype.options.icon = L.icon({ iconUrl: icon, shadowUrl: iconShadow });

const socket = io('http://localhost:4000');   // nối tới backend

type Pos = { lat: number; lng: number; accuracy?: number };

export default function App() {
  // state lưu vị trí hiện tại; null = chưa có
  const [pos, setPos] = useState<Pos | null>(null);

  // Khi trang mở: lắng nghe sự kiện 'position:update' từ server
  useEffect(() => {
    socket.on('position:update', (data: Pos) => setPos(data));
    return () => { socket.off('position:update'); };  // dọn khi rời trang
  }, []);

  return (
    <MapContainer center={[21.0285, 105.8542]} zoom={15} style={{ height: '100vh' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap"
      />
      {/* Chỉ hiện marker khi đã có vị trí */}
      {pos && (
        <Marker position={[pos.lat, pos.lng]}>
          <Popup>Vị trí hiện tại<br />Sai số: {pos.accuracy ?? '?'}m</Popup>
        </Marker>
      )}
    </MapContainer>
  );
}