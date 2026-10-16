/*
 * AreYouIoT — ESP32 스위치로 AUTO/MANUAL 모드 전환 테스트
 *
 * 하는 일
 *   1) Wi-Fi 연결 → Firebase Auth 이메일 로그인 (ID 토큰 발급)
 *   2) 스위치 입력 → farm/modules/<MODULE_ID>/auto_mode 에 true/false 쓰기
 *   3) 3초마다 auto_mode 를 읽어서 LED 에 표시 (웹에서 바꿔도 LED 가 따라감)
 *
 * 배선
 *   스위치: 한쪽 → GPIO 4, 다른 쪽 → GND   (내부 풀업 사용, 저항 불필요)
 *   LED   : 보드 내장 LED(GPIO 2) 사용. 외장 LED면 GPIO → 220Ω → LED → GND
 *
 * 필요 라이브러리
 *   - ESP32 보드 패키지 (Espressif, 2.x 또는 3.x)
 *   - ArduinoJson v7  (라이브러리 매니저에서 "ArduinoJson" by Benoit Blanchon)
 *
 * 준비
 *   - secrets.example.h 를 secrets.h 로 복사 후 값 입력
 *   - Firebase 콘솔 → Authentication 에 ESP32용 계정 생성
 *   - 그 계정 UID 를 Realtime Database 의 access/<UID> = true 로 등록
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "secrets.h"

// ── 설정 ─────────────────────────────────────────────────────────
static const char* MODULE_ID = "module_01";   // 제어할 모듈

static const int SWITCH_PIN = 4;              // 스위치 입력 (다른 쪽은 GND)
static const int LED_PIN    = 2;              // 상태 LED (켜짐 = AUTO)

// 스위치 종류
//   0 = 푸시 버튼(택트 스위치): 누를 때마다 AUTO ↔ MANUAL 토글
//   1 = 토글/슬라이드 스위치  : ON(GND 연결) = AUTO, OFF = MANUAL
#define SWITCH_IS_LATCHING 0

static const uint32_t DEBOUNCE_MS  = 50;
static const uint32_t POLL_MS      = 3000;
static const uint32_t WIFI_RETRY_MS = 5000;

// ── 상태 ─────────────────────────────────────────────────────────
String   idToken;
uint32_t tokenIssuedAt = 0;
uint32_t tokenLifeMs   = 0;

bool autoMode  = false;
bool autoKnown = false;      // DB 값을 한 번이라도 읽었는지

int      lastRawLevel   = HIGH;
int      stableLevel    = HIGH;
uint32_t lastChangeAt   = 0;
uint32_t lastPollAt     = 0;
uint32_t lastWifiTryAt  = 0;

// ── Wi-Fi ────────────────────────────────────────────────────────
void connectWifi() {
  Serial.printf("[WiFi] connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(300);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] connected, IP=%s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WiFi] failed (will retry in loop)");
  }
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiTryAt < WIFI_RETRY_MS) return;
  lastWifiTryAt = millis();
  Serial.println("[WiFi] reconnecting...");
  WiFi.reconnect();
}

// ── Firebase Auth (REST) ─────────────────────────────────────────
// 테스트용으로 인증서 검증을 생략(setInsecure)합니다.
// 실제 운영 시에는 client.setCACert(<Google 루트 인증서>) 로 바꾸는 것을 권장.
bool signIn() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  String url = String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") + API_KEY;
  if (!http.begin(client, url)) {
    Serial.println("[Auth] http.begin failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");

  JsonDocument req;
  req["email"] = USER_EMAIL;
  req["password"] = USER_PASSWORD;
  req["returnSecureToken"] = true;
  String body;
  serializeJson(req, body);

  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  if (code != 200) {
    Serial.printf("[Auth] sign-in failed (%d): %s\n", code, resp.c_str());
    return false;
  }

  JsonDocument res;
  if (deserializeJson(res, resp)) {
    Serial.println("[Auth] JSON parse error");
    return false;
  }

  idToken = res["idToken"].as<String>();
  long expiresSec = atol(res["expiresIn"] | "3600");   // 보통 "3600" (문자열)
  // 만료 5분 전에 다시 로그인
  tokenLifeMs   = (uint32_t)max(60L, expiresSec - 300) * 1000UL;
  tokenIssuedAt = millis();

  Serial.printf("[Auth] signed in as %s (uid=%s)\n",
                USER_EMAIL, res["localId"].as<const char*>());
  return idToken.length() > 0;
}

bool ensureToken() {
  if (idToken.length() > 0 && millis() - tokenIssuedAt < tokenLifeMs) return true;
  return signIn();
}

// ── Realtime Database (REST) ─────────────────────────────────────
// method: "GET" / "PUT",  path 예: "/auto_mode"
// 반환: HTTP 코드 (음수 = 연결 오류)
int dbRequest(const char* method, const String& path, const String& body, String* out) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  if (!ensureToken()) return -2;

  for (int attempt = 0; attempt < 2; attempt++) {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;

    String url = String(DATABASE_URL) + "/farm/modules/" + MODULE_ID + path + ".json?auth=" + idToken;
    if (!http.begin(client, url)) return -3;
    http.addHeader("Content-Type", "application/json");

    int code = http.sendRequest(method, body);
    String resp = http.getString();
    http.end();

    if (code == 401 && attempt == 0) {
      // 토큰 만료/무효 → 재로그인 후 한 번만 재시도
      Serial.println("[DB] 401, re-authenticating");
      idToken = "";
      if (!signIn()) return code;
      continue;
    }
    if (code != 200) {
      Serial.printf("[DB] %s %s -> %d %s\n", method, path.c_str(), code, resp.c_str());
    }
    if (out) *out = resp;
    return code;
  }
  return -4;
}

bool readAutoMode(bool& value) {
  String resp;
  int code = dbRequest("GET", "/auto_mode", "", &resp);
  if (code != 200) return false;
  resp.trim();
  if (resp == "true")  { value = true;  return true; }
  if (resp == "false") { value = false; return true; }
  Serial.printf("[DB] auto_mode not set (got %s)\n", resp.c_str());
  return false;
}

bool writeAutoMode(bool value) {
  int code = dbRequest("PUT", "/auto_mode", value ? "true" : "false", nullptr);
  if (code == 200) {
    Serial.printf("[DB] auto_mode <- %s\n", value ? "true (AUTO)" : "false (MANUAL)");
    return true;
  }
  if (code == 401 || code == 403) {
    Serial.println("[DB] permission denied: access/<uid> = true 등록 여부와 Rules 확인");
  }
  return false;
}

// ── 표시 ─────────────────────────────────────────────────────────
void showMode() {
  digitalWrite(LED_PIN, (autoKnown && autoMode) ? HIGH : LOW);
}

void setModeFromDb(bool value) {
  if (!autoKnown || value != autoMode) {
    Serial.printf("[MODE] %s\n", value ? "AUTO" : "MANUAL");
  }
  autoMode = value;
  autoKnown = true;
  showMode();
}

// ── 스위치 처리 ──────────────────────────────────────────────────
void onSwitchStable(int level) {
#if SWITCH_IS_LATCHING
  bool desired = (level == LOW);                 // ON(GND 연결) = AUTO
  if (autoKnown && desired == autoMode) return;
  if (writeAutoMode(desired)) setModeFromDb(desired);
#else
  if (level != LOW) return;                      // 누르는 순간에만 반응
  bool current = autoMode;
  if (!autoKnown && !readAutoMode(current)) {
    Serial.println("[SW] current mode unknown, skip");
    return;
  }
  bool desired = !current;
  if (writeAutoMode(desired)) setModeFromDb(desired);
#endif
}

void pollSwitch() {
  int raw = digitalRead(SWITCH_PIN);
  if (raw != lastRawLevel) {
    lastRawLevel = raw;
    lastChangeAt = millis();
  }
  if (millis() - lastChangeAt >= DEBOUNCE_MS && raw != stableLevel) {
    stableLevel = raw;
    Serial.printf("[SW] %s\n", raw == LOW ? "pressed/ON" : "released/OFF");
    onSwitchStable(raw);
  }
}

// ── setup / loop ─────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== AreYouIoT switch -> auto_mode test ===");

  pinMode(SWITCH_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  lastRawLevel = stableLevel = digitalRead(SWITCH_PIN);
  lastChangeAt = millis();

  connectWifi();

#if SWITCH_IS_LATCHING
  // 토글 스위치는 물리적 위치가 기준 → 부팅 시 DB를 스위치 상태로 맞춤
  bool desired = (stableLevel == LOW);
  if (writeAutoMode(desired)) setModeFromDb(desired);
#else
  bool v;
  if (readAutoMode(v)) setModeFromDb(v);
#endif
  lastPollAt = millis();
}

void loop() {
  maintainWifi();
  pollSwitch();

  // 웹/앱에서 바뀐 값을 LED에 반영
  if (millis() - lastPollAt >= POLL_MS) {
    lastPollAt = millis();
    bool v;
    if (readAutoMode(v)) setModeFromDb(v);
  }

  delay(5);
}
