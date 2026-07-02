import { useState, type CSSProperties } from 'react';
import { login, register } from './api';

// onDone: hàm cha truyền xuống, gọi khi đăng nhập/ký thành công để App vẽ lại
export default function Login({ onDone }: { onDone: () => void }) {
  const [isRegister, setIsRegister] = useState(false);  // đang ở chế độ đăng ký?
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);   // chặn bấm nút hai lần khi đang gửi

  async function handleSubmit() {
    setError('');
    if (!username || !password) { setError('Nhập đủ tài khoản và mật khẩu'); return; }
    setBusy(true);
    try {
      if (isRegister) await register(username, password);
      else await login(username, password);
      onDone();   // báo App: xong rồi, chuyển sang bản đồ
    } catch (e: any) {
      setError(e.message);   // ví dụ "Sai tài khoản hoặc mật khẩu"
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--base)',
    }}>
      <div style={{
        width: '100%', maxWidth: 320, margin: '0 16px',
        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
        padding: 24,
      }}>
        <h2>{isRegister ? 'Đăng ký' : 'Đăng nhập'}</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
          GR1 Geofence — dashboard cho người chăm sóc
        </p>

        <label htmlFor="login-username" style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
          Tài khoản
        </label>
        <input
          id="login-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={inputStyle}
        />

        <label htmlFor="login-password" style={{ display: 'block', fontSize: 12, color: 'var(--muted)', margin: '12px 0 4px' }}>
          Mật khẩu
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          // Enter để gửi cho nhanh
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          style={inputStyle}
        />

        {error && (
          <div style={{ color: 'var(--breach)', fontSize: 13, marginTop: 12 }} role="alert">
            {error}
          </div>
        )}

        <button onClick={handleSubmit} disabled={busy} className="btn btn--primary" style={{ width: '100%', marginTop: 16 }}>
          {busy ? 'Đang xử lý...' : (isRegister ? 'Đăng ký' : 'Đăng nhập')}
        </button>

        <button
          onClick={() => { setIsRegister(!isRegister); setError(''); }}
          className="btn"
          style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: 'var(--signal)' }}
        >
          {isRegister ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'}
        </button>
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  display: 'block', width: '100%', minHeight: 44, padding: '8px 12px',
  borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface-2)',
  color: 'var(--text)', fontSize: 14,
};