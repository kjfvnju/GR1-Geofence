const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Hàm lõi: mọi request đi qua đây. Tự gắn token nếu có.
async function request(path: string, options: RequestInit = {}) {
  const token = sessionStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;  // đính vé nếu đã đăng nhập

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    // Server trả lỗi (4xx/5xx). Ném ra để nơi gọi bắt bằng try/catch.
    throw new Error(data.error || 'Có lỗi xảy ra');
  }
  return data;
}

// Các hàm tiện dụng, gọi tên cho dễ đọc:
export const api = {
  get: (path: string) => request(path),
  post: (path: string, body: unknown) =>
    request(path, { method: 'POST', body: JSON.stringify(body) }),
  delete: (path: string) => request(path, { method: 'DELETE' }),
};

// Auth riêng cho gọn
export async function login(username: string, password: string) {
  const data = await api.post('/api/auth/login', { username, password });
  sessionStorage.setItem('token', data.token);   // lưu vé ngay khi đăng nhập xong
  sessionStorage.setItem('userId', String(data.user.id));
  return data.user;
}

export async function register(username: string, password: string) {
  const data = await api.post('/api/auth/register', { username, password });
  sessionStorage.setItem('token', data.token);
  sessionStorage.setItem('userId', String(data.user.id));
  return data.user;
}

export function logout() {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('userId');
}

export function isLoggedIn(): boolean {
  return !!sessionStorage.getItem('token');   // !! đổi chuỗi/null thành true/false
}