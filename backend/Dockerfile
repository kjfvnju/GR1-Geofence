FROM node:20-slim
WORKDIR /app

# Copy package trước — Docker cache layer này, chỉ chạy npm ci lại khi package.json đổi
COPY package*.json ./
RUN npm ci

# Copy toàn bộ source rồi build
COPY . .
RUN npm run build

EXPOSE 4000
CMD ["node", "dist/index.js"]