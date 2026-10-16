// ▶ 이 파일을 복사해서 같은 폴더에 secrets.h 로 저장한 뒤 값을 채우세요.
// ▶ secrets.h 는 .gitignore 에 들어 있어서 커밋되지 않습니다.
#pragma once

// Wi-Fi (ESP32는 2.4GHz만 지원)
#define WIFI_SSID      "your-wifi-ssid"
#define WIFI_PASSWORD  "your-wifi-password"

// js/firebase-config.js 의 apiKey / databaseURL 과 동일 (databaseURL 끝에 / 붙이지 말 것)
#define API_KEY        "AIzaSy..."
#define DATABASE_URL   "https://areyouiot-default-rtdb.asia-southeast1.firebasedatabase.app"

// Firebase Authentication 에 만든 ESP32 전용 계정
// (이 계정의 UID 를 DB의 access/<uid> = true 로 등록해야 쓰기가 됩니다)
#define USER_EMAIL     "esp32-switch@areyouiot.local"
#define USER_PASSWORD  "change-me"
