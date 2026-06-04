import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

// Mở rộng kiểu Request của Express để thêm trường userId do ta gắn vào.
export interface AuthRequest extends Request {
  userId?: number;
}

export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  // Header chuẩn có dạng:  Authorization: Bearer <token>
  const token = req.headers.authorization?.split(' ')[1];   // lấy phần sau chữ "Bearer "
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    // verify vừa kiểm chữ ký, vừa kiểm hạn dùng. Sai/hết hạn → ném lỗi → vào catch.
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: number };
    req.userId = payload.userId;   // gắn id người gọi vào request để route sau dùng
    next();                         // mở cổng
  } catch {
    res.status(401).json({ error: 'Vé không hợp lệ hoặc đã hết hạn' });
  }
}