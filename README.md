# AreYouIoT — Smart Farm Control Panel

Firebase Realtime Database 기반 스마트팜 웹 대시보드 + ESP32 테스트 펌웨어.

```
areyouiot/
├─ index.html                 # 대시보드 화면 (레이아웃 + 모듈 템플릿)
├─ css/style.css              # 스타일
├─ js/
│  ├─ firebase-config.js      # Firebase 웹 설정 (공개 식별자)
│  ├─ schema.js               # 센서/액추에이터/규칙 정의  ← 확장할 때 여기만 수정
│  ├─ background.js           # 배경 애니메이션
│  └─ app.js                  # 로그인, DB 구독, 화면 갱신, 쓰기
├─ database.rules.json        # RTDB 보안 규칙
├─ firebase.json / .firebaserc# Firebase CLI 배포 설정
├─ firebase/seed-farm.json    # 초기 데이터 (/farm 노드에 Import)
└─ esp32/switch_mode_test/    # ESP32 스위치 → auto_mode 테스트 스케치
```

---

## 1. 보안 설정 (최초 1회)

웹 apiKey 는 공개돼도 되는 값이라 레포에 그대로 둡니다. 대신 **로그인 + 허용 목록(access)** 으로 막습니다.

1. **Authentication 켜기**
   Firebase 콘솔 → Authentication → 로그인 방법 → **이메일/비밀번호** 사용 설정
2. **계정 만들기** (Authentication → 사용자 → 사용자 추가)
   - 웹 관리자 계정 1개
   - ESP32 전용 계정 1개
   - (Pi 게이트웨이, Android 앱도 같은 방식으로 계정 추가)
3. **허용 목록 등록**
   Realtime Database → 데이터 에서 루트에 아래처럼 추가 (UID는 사용자 목록에서 복사)
   ```json
   "access": {
     "웹계정UID": true,
     "ESP32계정UID": true
   }
   ```
4. **Rules 적용**
   Realtime Database → 규칙 탭에 `database.rules.json` 내용 붙여넣고 게시
   (또는 CLI: `firebase deploy --only database`)
5. (권장) Authentication → 설정 → 사용자 작업 → **"생성(가입) 사용 설정" 해제**
   허용 목록이 있어서 필수는 아니지만, 아무나 계정을 만드는 것 자체를 막아둡니다.

> ⚠️ Rules 를 적용하면 **로그인 안 한 기기는 전부 막힙니다.**
> Raspberry Pi 게이트웨이 / Android 앱이 지금 인증 없이 DB에 쓰고 있다면, Rules 게시 전에 먼저 로그인을 붙이세요.
> Pi 는 Admin SDK + 서비스 계정 키를 쓰면 Rules 를 우회하므로 가장 간단합니다 (키 파일은 절대 커밋 금지 — `.gitignore` 에 포함됨).

---

## 2. 데이터 구조

```
access/
  <uid>: true                     # 접근 허용 사용자

farm/modules/<module_XX>/         # module_01, module_02, ... (module_숫자 형식)
  auto_mode: bool                 # true = AUTO, false = MANUAL
  actuators/
    fan, heater, led, pump: bool
    fan_speed, led_brightness: 0~100
  control_rules/<sensor>/
    enabled: bool
    target_min, target_max: number   (min < max)
    cooldown_sec: number (≥ 0)
  meta/
    name: string (≤ 40자)
    fw_version: string
    status: "online" | "offline"
  sensors/
    temperature, air_humidity, illuminance, soil_moisture: number
    water_level: number (%)
    water_distance_cm: number     # 초음파 센서 원시값 (센서 → 수면 거리)
    updated_at: number            # Unix 시간, **초 단위**
  config/
    water_tank/
      empty_cm: number            # 탱크가 비었을 때 거리 (큰 값)
      full_cm:  number            # 탱크가 가득 찼을 때 거리 (작은 값)
```

### 초음파 센서 (water_distance_cm)
- 장치(Pi/ESP32)는 **측정한 거리(cm)** 를 `sensors/water_distance_cm` 에 씁니다.
- 수위 % 는 `config/water_tank` 보정값으로 계산합니다:
  `water_level = (empty_cm - distance) / (empty_cm - full_cm) × 100`
- 장치가 `water_level` 도 함께 보내면 그 값을 그대로 표시하고, 안 보내면 대시보드가 위 식으로 계산합니다.
- 보정값은 대시보드의 **WATER TANK** 패널에서 수정할 수 있습니다.

### ONLINE / OFFLINE 판단
`meta/status == "online"` **이고** `sensors/updated_at` 이 60초 이내일 때만 ONLINE.
장치가 꺼져서 status 를 못 바꿔도 60초 후 자동으로 OFFLINE 으로 표시됩니다.

---

## 3. 확장하기

| 하고 싶은 것 | 할 일 |
|---|---|
| 모듈 추가 | DB `farm/modules/module_03` 생성 → 탭 자동 생성 |
| 센서 추가 | 장치가 `sensors/<새키>` 로 쓰기 → 기본 카드로 자동 표시. 이름/단위/범위는 `js/schema.js` 의 `SENSORS` 에 추가 |
| 액추에이터 추가 | `js/schema.js` 의 `ACTUATORS` 에 추가 (Rules 는 bool / 0~100 숫자면 그대로 통과) |
| 제어 규칙 추가 | `js/schema.js` 의 `RULES` 에 추가 |
| 새 최상위 항목 | `database.rules.json` 에 경로 추가 (정의 안 된 경로는 쓰기 거부됨) |

---

## 4. 초기 데이터 넣기

Realtime Database → `farm` 노드 선택 → ⋮ → **JSON 가져오기** → `firebase/seed-farm.json`
(루트에서 가져오면 `access` 까지 지워지니 꼭 `farm` 노드에서 가져오세요.)

---

## 5. ESP32 스위치 테스트

`esp32/switch_mode_test/` 참고. 요약:

1. Arduino IDE 에 ESP32 보드 패키지 + **ArduinoJson v7** 설치
2. `secrets.example.h` → `secrets.h` 복사 후 Wi-Fi / 계정 정보 입력
3. 스위치: GPIO 4 ↔ GND, 상태 LED: 내장 LED(GPIO 2)
4. 업로드 후 시리얼 모니터 115200
5. 버튼 누르면 `auto_mode` 가 토글되고 대시보드 AUTO 토글이 같이 바뀌는지 확인
   반대로 웹에서 바꾸면 3초 안에 ESP32 LED 가 따라 바뀌는지 확인

토글(슬라이드) 스위치를 쓰면 스케치 상단 `SWITCH_IS_LATCHING` 을 `1` 로 바꾸세요.

---

## 6. 로컬 실행

`file://` 로 열면 일부 브라우저에서 동작이 제한될 수 있습니다. 간단한 서버로 여세요.

```bash
python -m http.server 8000
# http://localhost:8000
```

GitHub Pages 로 배포했다면 Firebase 콘솔 → Authentication → 설정 → **승인된 도메인** 에
`<계정>.github.io` 를 추가해야 로그인이 됩니다.
