// Firebase 웹 앱 설정
//
// 이 값들은 비밀번호가 아니라 "어느 프로젝트에 붙을지"를 알려주는 공개 식별자라서
// 레포에 올라가도 괜찮습니다 (Firebase 공식 입장도 동일).
// 실제 보안은 아래 두 가지가 담당합니다.
//   1) Firebase Authentication — 로그인한 사용자만
//   2) database.rules.json     — access/<uid> 에 등록된 사용자만 읽기/쓰기
//
// 진짜 비밀(서비스 계정 키, ESP32 Wi-Fi/계정 비밀번호 등)은 절대 여기 넣지 마세요.

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAeakDQRVzfb5ormYsGp8-A18gF52B2zAI",
  authDomain: "areyouiot.firebaseapp.com",
  databaseURL: "https://areyouiot-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "areyouiot",
  storageBucket: "areyouiot.firebasestorage.app",
  messagingSenderId: "678627007312",
  appId: "1:678627007312:web:6c05ba96ac06f41ba42a55",
  measurementId: "G-MM2Z7BXYRX"
};
