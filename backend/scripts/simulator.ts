const API = 'http://localhost:4000/api/positions';
const SUBJECT_ID = 1;

const baseLat = 21.0285;   // điểm xuất phát (Hà Nội, đổi tùy ý)
const baseLng = 105.8542;
let step = 0;

async function sendPosition() {
  const lat = baseLat + step * 0.0002;   // dịch dần để giả lập di chuyển
  const lng = baseLng + step * 0.0002;

  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectId: SUBJECT_ID, lat, lng, accuracy: 10 }),
  });
  console.log(`Gửi điểm #${step}: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  step++;
}

setInterval(sendPosition, 2000);   // bắn mỗi 2 giây
sendPosition();