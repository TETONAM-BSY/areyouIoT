/* ═══════════════════════════════════════════════════════════════
   AreYouIoT SMART FARM DASHBOARD — Main Script

   흐름: Firebase 초기화 → 로그인 → farm/modules 구독
        → 모듈마다 화면(template) 생성 → 값 변경 시 화면 갱신
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const S = window.FARM_SCHEMA;
  const SENSOR_BY_KEY = Object.fromEntries(S.SENSORS.map(s => [s.key, s]));
  const RULE_BY_KEY   = Object.fromEntries(S.RULES.map(r => [r.key, r]));
  const LS_TAB_KEY = 'areyouiot.tab';

  let db = null;
  let auth = null;
  let modulesRef = null;
  let currentModule = null;
  const views = {};   // modId -> view state

  const $ = (sel, root = document) => root.querySelector(sel);

  // ── TOAST ─────────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, isErr = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isErr);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ── CLOCK ─────────────────────────────────────────────────────
  function tickClock() {
    $('#clock').textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  }

  function setConnStatus(state, text) {
    const el = $('#firebase-status');
    el.classList.remove('connected', 'error');
    if (state) el.classList.add(state);
    $('#firebase-status-text').textContent = text;
  }

  function setEmpty(text) {
    const box = $('#empty-state');
    if (text) {
      $('#empty-text').textContent = text;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  // ── HELPERS ───────────────────────────────────────────────────
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // updated_at 은 초 단위 기준. 실수로 ms 로 들어와도 자동 보정.
  function toEpochSec(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }

  // ONLINE 조건: meta.status === 'online' 이고 updated_at 이 STALE_SEC 이내
  function isOnline(data) {
    if (!data || !data.meta || data.meta.status !== 'online') return false;
    const ts = toEpochSec(data.sensors && data.sensors.updated_at);
    if (!ts) return false;
    return (Date.now() / 1000 - ts) <= S.STALE_SEC;
  }

  function parseNum(str) {
    if (String(str).trim() === '') return null;
    const n = Number(str);
    return Number.isFinite(n) ? n : null;
  }

  function moduleName(v) {
    return (v.data && v.data.meta && v.data.meta.name) || v.id;
  }

  // 장치가 water_level 을 안 보내면 초음파 거리 + 탱크 보정값으로 계산
  function sensorsWithDerived(data) {
    const sensors = Object.assign({}, data.sensors || {});
    const derived = {};
    const tank = data.config && data.config.water_tank;
    const d = Number(sensors.water_distance_cm);
    if (typeof sensors.water_level !== 'number' && tank && Number.isFinite(d)) {
      const empty = Number(tank.empty_cm);
      const full  = Number(tank.full_cm);
      if (Number.isFinite(empty) && Number.isFinite(full) && empty > full) {
        sensors.water_level = clamp((empty - d) / (empty - full) * 100, 0, 100);
        derived.water_level = true;
      }
    }
    return { sensors, derived };
  }

  // ── DB WRITE ──────────────────────────────────────────────────
  function modPath(v, rel) {
    return `${S.DB_ROOT}/${v.id}/${rel}`;
  }

  function dbWrite(v, rel, value, okMsg, method = 'set') {
    if (!db) {
      showToast('Firebase 미연결', true);
      if (v.data) applyData(v, v.data);
      return Promise.resolve(false);
    }
    return db.ref(modPath(v, rel))[method](value)
      .then(() => { if (okMsg) showToast(okMsg); return true; })
      .catch(err => {
        showToast('쓰기 실패: ' + (err.code || err.message), true);
        if (v.data) applyData(v, v.data);  // 화면을 DB 값으로 되돌림
        return false;
      });
  }

  // ── VIEW CREATION ─────────────────────────────────────────────
  function createView(modId) {
    const frag = $('#tpl-module').content.cloneNode(true);
    const root = frag.querySelector('.module-view');
    root.dataset.module = modId;
    const r = role => root.querySelector(`[data-role="${role}"]`);

    const v = {
      id: modId,
      root,
      data: null,
      name: r('name'), status: r('status'), fw: r('fw'), upd: r('updated'),
      sensors: r('sensors'), sensorSig: '', sensorCards: {},
      autoChk: r('auto-chk'), autoState: r('auto-state'),
      actuators: r('actuators'), act: {},
      rules: r('rules'), ruleSig: '', rule: {},
      tankEmpty: r('tank-empty'), tankFull: r('tank-full'), tankSave: r('tank-save'), tankDirty: false,
    };

    v.autoChk.addEventListener('change', () => onAutoToggle(v, v.autoChk.checked));
    buildActuators(v);
    bindTank(v);

    $('#module-views').appendChild(root);
    views[modId] = v;
    return v;
  }

  // ── SENSORS ───────────────────────────────────────────────────
  function sensorMeta(key) {
    return SENSOR_BY_KEY[key] ||
      { key, label: key, icon: '📟', unit: '', min: 0, max: 100, decimals: 1, color: '#7ab898' };
  }

  function buildSensorCard(m) {
    const card = document.createElement('div');
    card.className = 'sensor-card';
    card.style.setProperty('--accent-color', m.color);
    card.innerHTML = `
      <div class="sensor-label"><span class="s-icon"></span><span class="s-name"></span></div>
      <div class="sensor-value"><span class="s-num">—</span><span class="unit"></span></div>
      <div class="sensor-sub"></div>
      <div class="sensor-bar"><div class="sensor-bar-fill"></div></div>
      <div class="sensor-range"><span class="s-min"></span><span class="s-max"></span></div>`;
    // DB에서 온 키(미등록 센서)는 textContent 로만 넣는다
    $('.s-icon', card).textContent = m.icon;
    $('.s-name', card).textContent = m.label;
    $('.unit', card).textContent = m.unit;
    $('.s-min', card).textContent = m.min + m.unit;
    $('.s-max', card).textContent = m.max + m.unit;
    const fill = $('.sensor-bar-fill', card);
    fill.style.background = m.color;
    fill.style.boxShadow = `0 0 6px ${m.color}66`;
    return { card, meta: m, num: $('.s-num', card), sub: $('.sensor-sub', card), fill };
  }

  function renderSensors(v, sensors, derived) {
    const known = S.SENSORS.map(s => s.key).filter(k => k in sensors);
    const extra = Object.keys(sensors)
      .filter(k => k !== 'updated_at' && !SENSOR_BY_KEY[k])
      .sort();
    const keys = known.concat(extra);
    const sig = keys.join(',');

    if (sig !== v.sensorSig) {
      v.sensorSig = sig;
      v.sensors.innerHTML = '';
      v.sensorCards = {};
      keys.forEach(k => {
        const c = buildSensorCard(sensorMeta(k));
        v.sensorCards[k] = c;
        v.sensors.appendChild(c.card);
      });
    }

    keys.forEach(k => {
      const c = v.sensorCards[k];
      const m = c.meta;
      const n = Number(sensors[k]);
      if (Number.isFinite(n)) {
        c.num.textContent = n.toFixed(m.decimals);
        c.fill.style.width = clamp((n - m.min) / (m.max - m.min) * 100, 0, 100) + '%';
      } else {
        c.num.textContent = '—';
        c.fill.style.width = '0%';
      }
      c.sub.textContent = derived[k] ? '초음파 거리로 계산됨' : '';
    });
  }

  // ── ACTUATORS ─────────────────────────────────────────────────
  function buildActuators(v) {
    S.ACTUATORS.forEach(meta => {
      const row = document.createElement('div');
      row.className = 'actuator-row';
      row.innerHTML = `
        <div class="act-icon" style="--act-color:${meta.color}">${meta.icon}</div>
        <div class="act-info">
          <div class="act-name">${meta.label}</div>
          <div class="act-sub">—</div>
        </div>
        ${meta.slider ? `
        <div class="act-slider-wrap">
          <input type="range" class="act-slider" min="0" max="100" value="0" aria-label="${meta.label} 세기">
          <span class="act-slider-val">—</span>
        </div>` : ''}
        <label class="toggle toggle-sm">
          <input type="checkbox" aria-label="${meta.label}">
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>`;

      const a = {
        meta,
        icon: $('.act-icon', row),
        sub: $('.act-sub', row),
        chk: $('.toggle input', row),
        slider: $('.act-slider', row),
        sliderVal: $('.act-slider-val', row),
        sliding: false,
      };

      a.chk.addEventListener('change', () => onActuatorToggle(v, a, a.chk.checked));
      if (a.slider) {
        a.slider.addEventListener('input', () => {
          a.sliding = true;
          a.sliderVal.textContent = a.slider.value + '%';
        });
        a.slider.addEventListener('change', () => {
          a.sliding = false;
          onSliderCommit(v, a, Number(a.slider.value));
        });
      }

      v.act[meta.key] = a;
      v.actuators.appendChild(row);
    });
  }

  function renderActuators(v, acts, auto) {
    Object.values(v.act).forEach(a => {
      const on = acts[a.meta.key] === true;
      a.chk.checked = on;
      a.chk.disabled = auto;
      a.icon.classList.toggle('active', on);
      a.sub.textContent = on ? 'ON' : 'OFF';
      a.sub.classList.toggle('on', on);
      if (a.slider) {
        a.slider.disabled = auto;
        const val = acts[a.meta.slider];
        if (!a.sliding && typeof val === 'number') {
          a.slider.value = val;
          a.sliderVal.textContent = val + '%';
        }
      }
    });
  }

  function onActuatorToggle(v, a, val) {
    if (v.data && v.data.auto_mode === true) {
      a.chk.checked = !val;
      showToast('AUTO 모드에서는 수동 제어할 수 없습니다', true);
      return;
    }
    dbWrite(v, `actuators/${a.meta.key}`, val);
  }

  function onSliderCommit(v, a, val) {
    if (v.data && v.data.auto_mode === true) {
      showToast('AUTO 모드에서는 수동 제어할 수 없습니다', true);
      applyData(v, v.data);
      return;
    }
    dbWrite(v, `actuators/${a.meta.slider}`, clamp(Math.round(val), 0, 100));
  }

  function onAutoToggle(v, val) {
    dbWrite(v, 'auto_mode', val, val ? 'AUTO 모드로 전환' : 'MANUAL 모드로 전환');
  }

  // ── CONTROL RULES ─────────────────────────────────────────────
  function ruleMeta(key) {
    return RULE_BY_KEY[key] || { key, label: key, icon: '⚙', unit: '' };
  }

  function buildRuleRow(v, m) {
    const el = document.createElement('div');
    el.className = 'rule-row';
    el.innerHTML = `
      <div class="rule-header">
        <div class="rule-name"><span class="r-icon"></span><span class="r-name"></span></div>
        <label class="rule-enabled-toggle" title="규칙 활성화">
          <input type="checkbox" class="rule-chk">
          <div class="rule-chk-track"></div>
          <div class="rule-chk-thumb"></div>
        </label>
      </div>
      <div class="rule-inputs">
        <div class="rule-field"><label class="l-min"></label><input type="number" step="any" class="i-min" placeholder="—"></div>
        <div class="rule-field"><label class="l-max"></label><input type="number" step="any" class="i-max" placeholder="—"></div>
        <div class="rule-field"><label>Cooldown (s)</label><input type="number" step="1" min="0" class="i-cd" placeholder="—"></div>
      </div>
      <button class="rule-save-btn" type="button">저장</button>`;
    $('.r-icon', el).textContent = m.icon;
    $('.r-name', el).textContent = m.label;
    $('.l-min', el).textContent = `MIN (${m.unit || '-'})`;
    $('.l-max', el).textContent = `MAX (${m.unit || '-'})`;

    const row = {
      key: m.key, el, dirty: false,
      en: $('.rule-chk', el), min: $('.i-min', el), max: $('.i-max', el), cd: $('.i-cd', el),
    };

    [row.min, row.max, row.cd].forEach(inp => inp.addEventListener('input', () => {
      row.dirty = true;
      el.classList.add('dirty');
    }));
    row.en.addEventListener('change', () => {
      dbWrite(v, `control_rules/${m.key}/enabled`, row.en.checked);
    });
    $('.rule-save-btn', el).addEventListener('click', () => onRuleSave(v, row));
    return row;
  }

  function renderRules(v, rules) {
    const keys = S.RULES.map(r => r.key)
      .concat(Object.keys(rules).filter(k => !RULE_BY_KEY[k]).sort());
    const sig = keys.join(',');

    if (sig !== v.ruleSig) {
      v.ruleSig = sig;
      v.rules.innerHTML = '';
      v.rule = {};
      keys.forEach(k => {
        const row = buildRuleRow(v, ruleMeta(k));
        v.rule[k] = row;
        v.rules.appendChild(row.el);
      });
    }

    keys.forEach(k => {
      const row = v.rule[k];
      const r = rules[k] || {};
      row.en.checked = r.enabled === true;
      // 사용자가 입력 중인 값은 덮어쓰지 않음 (센서 갱신마다 입력이 날아가던 문제 수정)
      if (!row.dirty) {
        row.min.value = r.target_min ?? '';
        row.max.value = r.target_max ?? '';
        row.cd.value  = r.cooldown_sec ?? '';
      }
    });
  }

  function onRuleSave(v, row) {
    const min = parseNum(row.min.value);
    const max = parseNum(row.max.value);
    const cd  = parseNum(row.cd.value);

    if (min === null || max === null || cd === null) { showToast('MIN / MAX / Cooldown 을 모두 입력하세요', true); return; }
    if (min >= max) { showToast('MIN < MAX 조건을 확인하세요', true); return; }
    if (cd < 0 || !Number.isInteger(cd)) { showToast('Cooldown 은 0 이상의 정수(초)', true); return; }

    dbWrite(v, `control_rules/${row.key}`, {
      enabled: row.en.checked,
      target_min: min,
      target_max: max,
      cooldown_sec: cd,
    }, `[${ruleMeta(row.key).label}] 규칙 저장됨 ✓`).then(ok => {
      if (ok) {
        row.dirty = false;
        row.el.classList.remove('dirty');
        applyData(v, v.data);
      }
    });
  }

  // ── WATER TANK (ultrasonic calibration) ───────────────────────
  function bindTank(v) {
    const markDirty = () => { v.tankDirty = true; v.tankSave.classList.add('dirty'); };
    v.tankEmpty.addEventListener('input', markDirty);
    v.tankFull.addEventListener('input', markDirty);
    v.tankSave.addEventListener('click', () => {
      const empty = parseNum(v.tankEmpty.value);
      const full  = parseNum(v.tankFull.value);
      if (empty === null || full === null) { showToast('두 거리 값을 모두 입력하세요', true); return; }
      if (full < 0 || empty <= full) { showToast('빈 탱크 거리 > 가득 찬 거리 ≥ 0 이어야 합니다', true); return; }
      dbWrite(v, 'config/water_tank', { empty_cm: empty, full_cm: full }, '탱크 보정값 저장됨 ✓')
        .then(ok => {
          if (ok) {
            v.tankDirty = false;
            v.tankSave.classList.remove('dirty');
            applyData(v, v.data);
          }
        });
    });
  }

  function renderTank(v, tank) {
    if (v.tankDirty) return;
    v.tankEmpty.value = tank.empty_cm ?? '';
    v.tankFull.value  = tank.full_cm ?? '';
  }

  // ── APPLY MODULE DATA ─────────────────────────────────────────
  function renderStatus(v) {
    const online = isOnline(v.data);
    v.status.textContent = online ? 'ONLINE' : 'OFFLINE';
    v.status.className = 'module-status-badge ' + (online ? 'online' : 'offline');
  }

  function applyData(v, data) {
    data = data || {};
    v.data = data;

    const meta = data.meta || {};
    v.name.textContent = moduleName(v);
    v.fw.textContent = 'fw ' + (meta.fw_version || '—');

    const ts = toEpochSec(data.sensors && data.sensors.updated_at);
    v.upd.textContent = ts
      ? 'updated ' + new Date(ts * 1000).toLocaleString('ko-KR', { hour12: false })
      : 'updated —';
    renderStatus(v);

    const { sensors, derived } = sensorsWithDerived(data);
    renderSensors(v, sensors, derived);

    const auto = data.auto_mode === true;
    v.autoChk.checked = auto;
    v.autoState.textContent = auto ? 'AUTO' : 'MANUAL';
    v.autoState.classList.toggle('on', auto);
    v.root.classList.toggle('auto-on', auto);

    renderActuators(v, data.actuators || {}, auto);
    renderRules(v, data.control_rules || {});
    renderTank(v, (data.config && data.config.water_tank) || {});
  }

  // ── TABS ──────────────────────────────────────────────────────
  function renderTabs() {
    const nav = $('#module-tabs');
    nav.innerHTML = '';
    Object.keys(views).sort().forEach(id => {
      const v = views[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab-btn' + (id === currentModule ? ' active' : '');
      const label = document.createElement('span');
      label.textContent = moduleName(v);
      const dot = document.createElement('span');
      dot.className = 'tab-status' + (isOnline(v.data) ? ' online' : '');
      b.append(label, dot);
      b.addEventListener('click', () => switchTab(id));
      nav.appendChild(b);
    });
  }

  function switchTab(id) {
    if (!views[id]) return;
    currentModule = id;
    Object.values(views).forEach(v => v.root.classList.toggle('active', v.id === id));
    renderTabs();
    try { localStorage.setItem(LS_TAB_KEY, id); } catch (e) { /* ignore */ }
  }

  function savedTab() {
    try { return localStorage.getItem(LS_TAB_KEY); } catch (e) { return null; }
  }

  function clearViews() {
    Object.values(views).forEach(v => v.root.remove());
    Object.keys(views).forEach(k => delete views[k]);
    currentModule = null;
    $('#module-tabs').innerHTML = '';
  }

  // ── SUBSCRIPTION ──────────────────────────────────────────────
  function onModules(all) {
    all = all || {};
    const ids = Object.keys(all).sort();

    Object.keys(views).forEach(id => {
      if (!(id in all)) { views[id].root.remove(); delete views[id]; }
    });

    ids.forEach(id => applyData(views[id] || createView(id), all[id]));

    if (!ids.length) {
      setEmpty('등록된 모듈이 없습니다. DB의 farm/modules 아래에 모듈을 추가하세요.');
      $('#module-tabs').innerHTML = '';
      return;
    }
    setEmpty(null);

    if (!currentModule || !views[currentModule]) {
      const s = savedTab();
      currentModule = (s && views[s]) ? s : ids[0];
    }
    switchTab(currentModule);
  }

  function subscribe(user) {
    unsubscribe();
    setEmpty('모듈 데이터를 불러오는 중...');
    modulesRef = db.ref(S.DB_ROOT);
    modulesRef.on('value',
      snap => onModules(snap.val()),
      err => {
        clearViews();
        if (err && err.code === 'PERMISSION_DENIED') {
          setEmpty(`접근 권한이 없습니다. Firebase 콘솔에서 access/${user.uid} 값을 true 로 추가하세요.`);
        } else {
          setEmpty('데이터를 불러오지 못했습니다: ' + (err && (err.code || err.message)));
        }
        showToast('읽기 권한 없음', true);
      });
  }

  function unsubscribe() {
    if (modulesRef) { modulesRef.off(); modulesRef = null; }
    clearViews();
  }

  // ── AUTH ──────────────────────────────────────────────────────
  function authErrorText(err) {
    switch (err && err.code) {
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
      case 'auth/invalid-email':
        return '이메일 또는 비밀번호가 올바르지 않습니다.';
      case 'auth/too-many-requests':
        return '시도가 너무 많습니다. 잠시 후 다시 시도하세요.';
      case 'auth/network-request-failed':
        return '네트워크 오류입니다.';
      default:
        return (err && err.message) || '로그인 실패';
    }
  }

  function onAuthChanged(user) {
    if (!user) {
      unsubscribe();
      $('#user-box').hidden = true;
      $('#login-modal').classList.add('open');
      setEmpty('로그인이 필요합니다.');
      return;
    }
    $('#login-modal').classList.remove('open');
    $('#login-password').value = '';
    $('#login-error').textContent = '';
    $('#user-email').textContent = user.email || user.uid;
    $('#user-box').hidden = false;
    subscribe(user);
  }

  function bindAuthUi() {
    $('#login-form').addEventListener('submit', e => {
      e.preventDefault();
      const btn = $('#login-btn');
      btn.disabled = true;
      $('#login-error').textContent = '';
      auth.signInWithEmailAndPassword($('#login-email').value.trim(), $('#login-password').value)
        .catch(err => { $('#login-error').textContent = authErrorText(err); })
        .finally(() => { btn.disabled = false; });
    });
    $('#logout-btn').addEventListener('click', () => auth.signOut());
  }

  // ── BOOT ──────────────────────────────────────────────────────
  function boot() {
    tickClock();
    setInterval(tickClock, 1000);

    // updated_at 이 오래되면 OFFLINE 으로 바뀌도록 주기적으로 재평가
    setInterval(() => {
      Object.values(views).forEach(renderStatus);
      if (Object.keys(views).length) renderTabs();
    }, 5000);

    const cfg = window.FIREBASE_CONFIG;
    if (typeof firebase === 'undefined' || !cfg || !cfg.apiKey || !cfg.databaseURL) {
      setConnStatus('error', '미설정');
      setEmpty('Firebase SDK 또는 js/firebase-config.js 설정을 불러오지 못했습니다.');
      return;
    }

    try {
      firebase.initializeApp(cfg);
      auth = firebase.auth();
      db = firebase.database();
    } catch (e) {
      setConnStatus('error', 'ERROR');
      setEmpty('Firebase 초기화 실패: ' + e.message);
      return;
    }

    db.ref('.info/connected').on('value', snap => {
      if (snap.val()) setConnStatus('connected', 'CONNECTED');
      else setConnStatus('error', 'DISCONNECTED');
    });

    bindAuthUi();
    auth.onAuthStateChanged(onAuthChanged);
  }

  boot();
})();
