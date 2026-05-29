import { useState } from 'react';
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
    <div style={{ maxWidth: 320, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h2>{isRegister ? 'Đăng ký' : 'Đăng nhập'}</h2>

      <input
        placeholder="Tài khoản"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        style={{ display: 'block', width: '100%', padding: 8, marginBottom: 8 }}
      />
      <input
        type="password"
        placeholder="Mật khẩu"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        // Enter để gửi cho nhanh
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        style={{ display: 'block', width: '100%', padding: 8, marginBottom: 8 }}
      />

      {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}

      <button onClick={handleSubmit} disabled={busy}
        style={{ width: '100%', padding: 10, marginBottom: 8 }}>
        {busy ? 'Đang xử lý...' : (isRegister ? 'Đăng ký' : 'Đăng nhập')}
      </button>

      <button onClick={() => { setIsRegister(!isRegister); setError(''); }}
        style={{ width: '100%', padding: 8, background: 'none', border: 'none', color: '#06c', cursor: 'pointer' }}>
        {isRegister ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'}
      </button>
    </div>
  );
}