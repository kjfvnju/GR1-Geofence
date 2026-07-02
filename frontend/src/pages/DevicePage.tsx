import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL;

export default function DevicePage() {
  const [status, setStatus] = useState('Chưa bắt đầu');
  const [watching, setWatching] = useState(false);
  const [token] = useState(() => {
  const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      localStorage.setItem('device_token', urlToken);
      return urlToken;
    }
    return localStorage.getItem('device_token') ?? '';
  });

  useEffect(() => {
    if (!watching || !token) return;

    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude: lat, longitude: lng, accuracy } = p.coords;
        fetch(`${API}/api/positions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-device-token': token,
          },
          body: JSON.stringify({ lat, lng, accuracy }),
        })
          .then(() => setStatus(`Gửi OK — ${new Date().toLocaleTimeString()}`))
          .catch(() => setStatus('Lỗi gửi vị trí'));
      },
      (err) => setStatus(`Lỗi GPS: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [watching, token]);

  if (!token) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p>Token không hợp lệ. Hãy quét lại QR từ dashboard.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 400, margin: '0 auto', textAlign: 'center' }}>
      <h2>Thiết bị tracker</h2>
      <p style={{ color: '#666', fontSize: 14 }}>Token đã được nạp sẵn ✓</p>
      <button
        onClick={() => setWatching((w) => !w)}
        style={{
          width: '100%', padding: 16, marginTop: 16,
          background: watching ? '#ef4444' : '#22c55e',
          color: 'white', border: 'none', borderRadius: 8,
          fontSize: 18, cursor: 'pointer',
        }}
      >
        {watching ? '⏹ Dừng theo dõi' : '▶ Bắt đầu theo dõi'}
      </button>
      <p style={{ marginTop: 16, color: '#666' }}>Trạng thái: {status}</p>
    </div>
  );
}