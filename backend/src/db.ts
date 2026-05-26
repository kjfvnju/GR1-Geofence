import { Pool } from 'pg';
import 'dotenv/config';   // tự nạp file .env

// Pool = nhóm kết nối tới database, dùng lại nhiều lần cho hiệu quả
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Thử kết nối ngay lúc khởi động để biết DB có chạy không
pool.query('SELECT NOW()')
  .then(() => console.log('✅ Kết nối PostgreSQL thành công'))
  .catch((e) => console.error('❌ Lỗi kết nối DB:', e.message));