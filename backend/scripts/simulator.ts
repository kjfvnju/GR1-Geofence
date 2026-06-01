const API = 'http://localhost:4000/api/positions';
const SUBJECT_ID = 2;

// Bắt đầu ở GIỮA vùng đã vẽ (tâm hình vuông quanh nhà)
const startLat = 21.0285;
const startLng = 105.8542;
let step = 0;

async function sendPosition() {
  // Đi dần về phía ĐÔNG (tăng lng). Vùng kết thúc ở lng ~105.8552.
  // Mỗi bước +0.0002 độ (~22m). Sau ~6 bước sẽ vượt ranh giới ra ngoài.
  const lat = startLat;
  const lng = startLng - step * 0.0002;
  const accuracy = 50 + step * 10;

  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectId: SUBJECT_ID, lat, lng, accuracy }),
  });

  console.log(`Gửi điểm #${step}: lat=${lat.toFixed(5)}, lng=${lng.toFixed(5)}`);
  step++;
}

setInterval(sendPosition, 2000);
sendPosition();