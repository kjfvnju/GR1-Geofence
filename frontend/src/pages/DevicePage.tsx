import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL;

export default function DevicePage() {
  const [token, setToken] = useState(localStorage.getItem('device_token') ?? '');
  const [status, setStatus] = useState('Chưa bắt đầu');
  const [watching, setWatching] = useState(false);

  function saveToken() {
    localStorage.setItem('device_token', token);
    setStatus('Đã lưu token');
  }

  useEffect(() => {
    if (!watching) return;

    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude: lat, longitude: lng, accuracy } = p.coords;
        fetch(`${API}/api/positions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-device-token': localStorage.getItem('device_token') ?? '',
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
  }, [watching]);

  return (
    <div style={{ padding: 24, maxWidth: 400, margin: '0 auto' }}>
      <h2>Thiết bị tracker</h2>

      <div style={{ marginBottom: 16 }}>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Dán device token vào đây"
          style={{ width: '100%', padding: 8, marginBottom: 8 }}
        />
        <button onClick={saveToken} style={{ width: '100%', padding: 8 }}>
          Lưu token
        </button>
      </div>

      <button
        onClick={() => setWatching((w) => !w)}
        style={{
          width: '100%', padding: 12,
          background: watching ? '#ef4444' : '#22c55e',
          color: 'white', border: 'none', borderRadius: 8, fontSize: 16,
        }}
      >
        {watching ? 'Dừng theo dõi' : 'Bắt đầu theo dõi'}
      </button>

      <p style={{ marginTop: 16, color: '#666' }}>Trạng thái: {status}</p>
    </div>
  );
}