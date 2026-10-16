/* ═══════════════════════════════════════════════════════════════
   FARM SCHEMA — 화면에 표시할 센서/액추에이터/제어규칙 정의

   ▶ 확장 방법
     - 새 센서:    SENSORS 배열에 한 줄 추가 (DB의 sensors/<key> 와 key 일치)
                   목록에 없는 센서 키가 DB에 들어와도 기본 카드로 자동 표시됨
     - 새 액추에이터: ACTUATORS 에 추가 (슬라이더가 있으면 slider 에 DB 키 지정)
     - 새 제어규칙: RULES 에 추가
     - 새 모듈:    DB의 farm/modules 아래에 module_03 ... 추가하면 탭이 자동 생성됨
   ═══════════════════════════════════════════════════════════════ */

window.FARM_SCHEMA = {
  DB_ROOT: 'farm/modules',

  // sensors/updated_at 이 이 시간(초)보다 오래되면 OFFLINE 으로 표시
  STALE_SEC: 60,

  SENSORS: [
    { key: 'temperature',       label: '온도',       icon: '🌡',  unit: '°C',  min: 0, max: 50,   decimals: 1, color: '#ff6633' },
    { key: 'air_humidity',      label: '습도',       icon: '💧', unit: '%',   min: 0, max: 100,  decimals: 1, color: '#00ccff' },
    { key: 'illuminance',       label: '조도',       icon: '☀️', unit: 'lux', min: 0, max: 1000, decimals: 0, color: '#ffee55' },
    { key: 'soil_moisture',     label: '토양수분',   icon: '🌱', unit: '%',   min: 0, max: 100,  decimals: 1, color: '#44dd88' },
    { key: 'water_level',       label: '수위',       icon: '🪣', unit: '%',   min: 0, max: 100,  decimals: 0, color: '#44aaff' },
    { key: 'water_distance_cm', label: '초음파 거리', icon: '📡', unit: 'cm',  min: 0, max: 100,  decimals: 1, color: '#aa88ff' },
  ],

  ACTUATORS: [
    { key: 'fan',    label: '냉각 팬',   icon: '🌀', color: '#00ccff', slider: 'fan_speed' },
    { key: 'heater', label: '히터',      icon: '🔥', color: '#ff6633' },
    { key: 'led',    label: 'LED 조명',  icon: '💡', color: '#ffee55', slider: 'led_brightness' },
    { key: 'pump',   label: '워터 펌프', icon: '💦', color: '#44aaff' },
  ],

  RULES: [
    { key: 'temperature',   label: '온도',     icon: '🌡',  unit: '°C'  },
    { key: 'air_humidity',  label: '습도',     icon: '💧', unit: '%'   },
    { key: 'illuminance',   label: '조도',     icon: '☀️', unit: 'lux' },
    { key: 'soil_moisture', label: '토양수분', icon: '🌱', unit: '%'   },
  ],
};
