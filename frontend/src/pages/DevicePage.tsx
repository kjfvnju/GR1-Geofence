import { useEffect, useRef, useState } from 'react';

const API = import.meta.env.VITE_API_URL;

// ====== Cấu hình gating/duty-cycle/adaptive sampling (Bước 6.6, dễ chỉnh khi đo đạc Bước 6.8) ======
const V_MAX_MPS = 1.5;             // tốc độ tối đa hợp lý (đi bộ nhanh), m/s
const INTERVAL_SPARSE_MS = 30000;  // chu kỳ lấy mẫu THƯA
const INTERVAL_DENSE_MS = 5000;    // chu kỳ lấy mẫu DÀY
const K_ACCURACY = 2;              // hệ số an toàn theo nhiễu GPS
const HYSTERESIS_FACTOR = 1.6;     // ngưỡng thoát dày = ngưỡng vào dày × hệ số này
const MOTION_THRESHOLD = 0.5;      // độ lệch gia tốc (m/s^2) coi là "đang di chuyển"

// Heartbeat khi đứng yên (gated) — PHẢI nhỏ hơn đáng kể ngưỡng offline (10 phút, xem MapView) để
// có biên an toàn chống trễ mạng: lỡ 1 lần heartbeat rớt vẫn còn cơ hội cứu ở lần kế tiếp (phút 8)
// trước khi chạm ngưỡng 10 phút.
const HEARTBEAT_STATIONARY_MS = 4 * 60 * 1000; // 4 phút

// threshold_near = max(v_max × interval_thưa, k_accuracy × accuracy_hiện_tại)
function computeEnterThreshold(accuracy: number): number {
  return Math.max(V_MAX_MPS * (INTERVAL_SPARSE_MS / 1000), K_ACCURACY * accuracy);
}

export default function DevicePage() {
  const [status, setStatus] = useState('Chưa bắt đầu');
  const [watching, setWatching] = useState(false);
  const [dense, setDense] = useState(false);
  const [stationary, setStationary] = useState(false);
  const [distanceToEdge, setDistanceToEdge] = useState<number | null>(null);
  const [token] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      localStorage.setItem('device_token', urlToken);
      return urlToken;
    }
    return localStorage.getItem('device_token') ?? '';
  });

  // Gating: lắng nghe cảm biến gia tốc để biết đang đứng yên hay di chuyển.
  // Mặc định true (coi là đang di chuyển) — an toàn nếu trình duyệt/thiết bị không hỗ trợ cảm biến,
  // hoặc chưa xin được quyền: khi đó hệ thống chỉ đơn giản không tối ưu pin, không mất dữ liệu vị trí.
  const movingRef = useRef(true);

  useEffect(() => {
    if (!watching) return;

    function handleMotion(e: DeviceMotionEvent) {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const magnitude = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2);
      movingRef.current = Math.abs(magnitude - 9.8) > MOTION_THRESHOLD;
    }
    window.addEventListener('devicemotion', handleMotion);
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [watching]);

  // Duty cycling + adaptive sampling — thay cho watchPosition liên tục.
  useEffect(() => {
    if (!watching || !token) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let dense_ = false;

    async function sendPosition(lat: number, lng: number, accuracy: number) {
      const res = await fetch(`${API}/api/positions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-token': token,
        },
        body: JSON.stringify({ lat, lng, accuracy }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }

    // Ping "còn sống" nhẹ, KHÔNG xin GPS mới — rẻ hơn nhiều so với getCurrentPosition + sendPosition.
    // Chỉ cập nhật last_seen_at, không lưu tọa độ mới (liveness khác location freshness).
    async function sendHeartbeat() {
      const res = await fetch(`${API}/api/devices/heartbeat`, {
        method: 'POST',
        headers: { 'x-device-token': token },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }

    function scheduleNext(delayMs: number) {
      if (cancelled) return;
      timeoutId = setTimeout(tick, delayMs);
    }

    function tick() {
      if (cancelled) return;

      // Gating: đứng yên → không xin GPS mới (tốn pin), nhưng vẫn heartbeat để last_seen_at
      // không bị coi là mất tín hiệu (xem TASK_phase6_heartbeat_fix.md).
      if (!movingRef.current) {
        sendHeartbeat()
          .then(() => { if (!cancelled) setStatus(`Heartbeat OK — ${new Date().toLocaleTimeString()}`); })
          .catch((err) => console.error('Heartbeat lỗi:', err));
        // Không await — heartbeat là best-effort, không được trì hoãn nhịp lấy mẫu tiếp theo
        // nếu mạng chập chờn khiến request bị treo lâu.
        dense_ = false; // đứng yên → không leo lên chế độ dày
        setDense(false);
        setStationary(true);
        scheduleNext(HEARTBEAT_STATIONARY_MS);
        return;
      }

      setStationary(false);

      navigator.geolocation.getCurrentPosition(
        async (p) => {
          const { latitude: lat, longitude: lng, accuracy } = p.coords;

          try {
            const result = await sendPosition(lat, lng, accuracy);
            const edge: number | null = result?.distanceToEdge ?? null;
            if (!cancelled) setDistanceToEdge(edge);

            if (edge !== null) {
              const enterThresh = computeEnterThreshold(accuracy);
              const exitThresh = enterThresh * HYSTERESIS_FACTOR;
              if (edge < enterThresh) dense_ = true;
              else if (edge > exitThresh) dense_ = false;
              // giữa 2 ngưỡng: giữ nguyên chế độ hiện tại (vùng hysteresis)
            } else {
              dense_ = false; // không có geofence nào để so → mặc định thưa
            }

            if (!cancelled) {
              setDense(dense_);
              setStatus(`Gửi OK — ${new Date().toLocaleTimeString()}`);
            }
          } catch (err) {
            console.error('Gửi vị trí lỗi:', err);
            if (!cancelled) setStatus('Lỗi gửi vị trí');
          }

          scheduleNext(dense_ ? INTERVAL_DENSE_MS : INTERVAL_SPARSE_MS);
        },
        (err) => {
          if (!cancelled) setStatus(`Lỗi GPS: ${err.message}`);
          scheduleNext(INTERVAL_SPARSE_MS); // lỗi thì lùi về nhịp thưa, tránh vòng lặp lỗi liên tục
        },
        { enableHighAccuracy: true, maximumAge: 0 }
      );
    }

    tick(); // bắt đầu ngay
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [watching, token]);

  // iOS Safari (13+) yêu cầu xin quyền tường minh cho devicemotion — phải gọi từ thao tác người
  // dùng trực tiếp (không được gọi trong useEffect lúc mount, trình duyệt sẽ chặn im lặng).
  async function requestMotionPermission() {
    const DME = DeviceMotionEvent as any;
    if (typeof DME.requestPermission === 'function') {
      try {
        const result = await DME.requestPermission();
        if (result !== 'granted') {
          alert('Cần cấp quyền cảm biến chuyển động để tối ưu pin. Sẽ dùng chế độ mặc định (luôn coi là đang di chuyển).');
        }
      } catch {
        // Không được gọi trực tiếp từ thao tác người dùng, hoặc trình duyệt từ chối — bỏ qua, dùng mặc định.
      }
    }
    // Android / trình duyệt khác: không cần xin, sự kiện devicemotion tự bắn ra.
  }

  async function handleToggleWatching() {
    if (!watching) await requestMotionPermission();
    setWatching((w) => !w);
  }

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
        onClick={handleToggleWatching}
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
      {watching && (
        <p style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
          Nhịp gửi: {stationary ? 'heartbeat, đứng yên (4 phút)' : dense ? 'dày (5s)' : 'thưa (30s)'}
          {distanceToEdge !== null ? ` — cách viền ~${Math.round(distanceToEdge)}m` : ''}
        </p>
      )}
    </div>
  );
}
