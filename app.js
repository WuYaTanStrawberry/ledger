(function () {
'use strict';

var GAS = window.CONFIG.gasUrl;
var JIN_KG = 0.6; // 1 台斤 = 0.6 公斤
var $ = function (id) { return document.getElementById(id); };

var state = {
  pw: localStorage.getItem('ledger_pw') || '',
  unit: localStorage.getItem('ledger_unit') || 'jin', // jin=台斤, kg=公斤
  needSetup: false,
  today: '',
  season: null,
  seasons: [],
  data: null
};

// ---------- 小工具 ----------

function fmt(n) { return Number(n || 0).toLocaleString('zh-TW'); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function kgToUnit(kg) { return state.unit === 'jin' ? kg / JIN_KG : kg; }
function unitName() { return state.unit === 'jin' ? '台斤' : '公斤'; }
function weightStr(kg) {
  var v = kgToUnit(kg);
  return (Math.round(v * 10) / 10).toLocaleString('zh-TW') + ' ' + unitName();
}
function altWeightStr(kg) {
  if (state.unit === 'jin') return '= ' + (Math.round(kg * 100) / 100).toLocaleString('zh-TW') + ' 公斤';
  return '= ' + (Math.round(kg / JIN_KG * 10) / 10).toLocaleString('zh-TW') + ' 台斤';
}

function dateLabel(d) {
  var parts = d.split('-');
  var dt = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  var wd = '日一二三四五六'.charAt(dt.getDay());
  return (+parts[1]) + '/' + (+parts[2]) + '(' + wd + ')';
}

function loading(on) { $('loadingOverlay').classList.toggle('hidden', !on); }

var toastTimer = null;
function toast(msg) {
  var el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2600);
}

// ---------- API ----------

function api(params, silent) {
  if (!silent) loading(true);
  if (!('pw' in params)) params.pw = state.pw;
  return fetch(GAS, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(params)
  }).then(function (r) { return r.json(); })
    .catch(function () { return { ok: false, error: '連線失敗,請檢查網路後再試' }; })
    .finally(function () { if (!silent) loading(false); });
}

function fail(r) {
  var msg = (r && r.error) || '發生錯誤';
  toast('❌ ' + msg);
  if (msg.indexOf('密碼錯誤') >= 0 || msg.indexOf('尚未設定密碼') >= 0) logout();
}

// ---------- 登入流程 ----------

function showLogin(setupMode) {
  state.needSetup = !!setupMode;
  $('mainView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('pwInput2').classList.toggle('hidden', !setupMode);
  $('loginHint').textContent = setupMode
    ? '第一次使用,請設定一組密碼(至少 4 個字)'
    : '請輸入密碼';
  $('loginBtn').textContent = setupMode ? '設定密碼並開始使用' : '登入';
  $('loginErr').textContent = '';
  $('pwInput').value = '';
  $('pwInput2').value = '';
  $('pwInput').focus();
}

function showMain() {
  $('loginView').classList.add('hidden');
  $('mainView').classList.remove('hidden');
}

function doLogin() {
  var pw = $('pwInput').value.trim();
  if (!pw) { $('loginErr').textContent = '請輸入密碼'; return; }

  if (state.needSetup) {
    if (pw.length < 4) { $('loginErr').textContent = '密碼至少 4 個字'; return; }
    if (pw !== $('pwInput2').value.trim()) { $('loginErr').textContent = '兩次輸入的密碼不一樣'; return; }
    api({ action: 'initPassword', pw: pw }).then(function (r) {
      if (!r.ok) { $('loginErr').textContent = r.error || '設定失敗'; return; }
      loginWith(pw);
    });
    return;
  }
  loginWith(pw);
}

function loginWith(pw) {
  api({ action: 'init', pw: pw }).then(function (r) {
    if (!r.ok) { $('loginErr').textContent = r.error || '登入失敗'; return; }
    state.pw = pw;
    localStorage.setItem('ledger_pw', pw);
    showMain();
    render(r);
  });
}

function logout() {
  state.pw = '';
  localStorage.removeItem('ledger_pw');
  localStorage.removeItem('ledger_cache');
  $('settingsModal').classList.add('hidden');
  showLogin(false);
}

// ---------- 畫面渲染 ----------

function render(resp) {
  state.today = resp.today;
  state.season = resp.season;
  state.seasons = resp.seasons;
  state.data = resp.data;
  try { localStorage.setItem('ledger_cache', JSON.stringify(resp)); } catch (e) {}

  var sel = $('seasonSel');
  sel.innerHTML = state.seasons.map(function (s) {
    return '<option value="' + s.year + '"' + (s.year === state.season ? ' selected' : '') + '>' + esc(s.label) + '</option>';
  }).join('');

  var t = state.data.total;
  $('stRevenue').textContent = '$' + fmt(t.revenue);
  $('stWeight').textContent = weightStr(t.kg);
  $('stWeightSub').textContent = t.kg ? altWeightStr(t.kg) : '';
  $('stDays').textContent = t.days + ' 天';
  $('stAvg').textContent = '$' + fmt(t.avg);
  $('stBest').textContent = state.data.best
    ? '最佳單日 ' + dateLabel(state.data.best.date) + ' $' + fmt(state.data.best.revenue)
    : '';

  renderUnitToggle();
  renderChart();
  renderList();
  if (!$('fDate').value) $('fDate').value = state.today;
  prefillFromDate();
}

function renderUnitToggle() {
  $('unitJin').classList.toggle('on', state.unit === 'jin');
  $('unitKg').classList.toggle('on', state.unit === 'kg');
  updateWeightHint();
}

function updateWeightHint() {
  var w = Number($('fWeight').value) || 0;
  if (!w) { $('weightHint').textContent = ''; return; }
  var kg = state.unit === 'jin' ? w * JIN_KG : w;
  $('weightHint').textContent = state.unit === 'jin'
    ? '= ' + (Math.round(kg * 100) / 100) + ' 公斤'
    : '= ' + (Math.round(kg / JIN_KG * 10) / 10) + ' 台斤';
}

function renderChart() {
  var months = state.data.months;
  var el = $('chart');
  if (!months.length) {
    el.innerHTML = '<p class="muted center small">本季還沒有紀錄</p>';
    return;
  }
  var max = Math.max.apply(null, months.map(function (m) { return m.revenue; }));
  el.innerHTML = months.map(function (m) {
    var pct = max ? Math.max(2, Math.round(m.revenue / max * 100)) : 2;
    return '<div class="bar-row">' +
      '<span class="bar-label">' + (+m.month.slice(5)) + '月</span>' +
      '<div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="bar-val">$' + fmt(m.revenue) + '<small>' + weightStr(m.kg) + '・' + m.days + ' 天</small></span>' +
      '</div>';
  }).join('');
}

function renderList() {
  var rows = state.data.records;
  var el = $('recordList');
  if (!rows.length) {
    el.innerHTML = '<p class="muted center small">尚無紀錄,從上面的表單記下第一筆吧!</p>';
    return;
  }
  el.innerHTML = rows.map(function (r) {
    return '<div class="rec" data-date="' + r.date + '">' +
      '<div class="rec-main">' +
        '<div class="rec-date">' + dateLabel(r.date) + '</div>' +
        (r.note ? '<div class="rec-note">' + esc(r.note) + '</div>' : '') +
      '</div>' +
      '<div class="rec-nums">' +
        '<div class="rec-rev">$' + fmt(r.revenue) + '</div>' +
        '<div class="rec-kg">' + (r.kg ? weightStr(r.kg) : '') + '</div>' +
      '</div>' +
      '<button class="rec-del" data-date="' + r.date + '" aria-label="刪除">🗑️</button>' +
      '</div>';
  }).join('');
}

// 選了日期 → 若那天已有紀錄就帶入(=修改模式)
function prefillFromDate() {
  var d = $('fDate').value;
  var hit = (state.data && state.data.records || []).find(function (r) { return r.date === d; });
  if (hit) {
    $('fRevenue').value = hit.revenue || '';
    $('fWeight').value = hit.kg ? Math.round(kgToUnit(hit.kg) * 10) / 10 : '';
    $('fNote').value = hit.note || '';
    $('entryTitle').textContent = '✏️ 修改 ' + dateLabel(d) + ' 的紀錄';
    $('saveBtn').textContent = '💾 更新這一天';
    $('entryHint').textContent = '這一天已有紀錄,儲存會覆蓋原本的數字';
  } else {
    $('entryTitle').textContent = d === state.today ? '📝 今日記帳' : '📝 記帳';
    $('saveBtn').textContent = '💾 儲存';
    $('entryHint').textContent = '';
  }
  updateWeightHint();
}

function clearFormNumbers() {
  $('fRevenue').value = '';
  $('fWeight').value = '';
  $('fNote').value = '';
  updateWeightHint();
}

// ---------- 動作 ----------

function save() {
  var date = $('fDate').value;
  if (!date) { toast('請選日期'); return; }
  var revenue = Number($('fRevenue').value) || 0;
  var w = Number($('fWeight').value) || 0;
  if (!revenue && !w) { toast('請至少填營收或重量'); return; }
  var kg = state.unit === 'jin' ? w * JIN_KG : w;

  api({
    action: 'save',
    date: date,
    revenue: revenue,
    kg: Math.round(kg * 100) / 100,
    note: $('fNote').value.trim()
  }).then(function (r) {
    if (!r.ok) { fail(r); return; }
    render(r);
    toast('✅ 已儲存 ' + dateLabel(date));
  });
}

function del(date) {
  if (!confirm('確定要刪除 ' + dateLabel(date) + ' 的紀錄嗎?')) return;
  api({ action: 'delete', date: date }).then(function (r) {
    if (!r.ok) { fail(r); return; }
    if ($('fDate').value === date) clearFormNumbers();
    render(r);
    toast('🗑️ 已刪除 ' + dateLabel(date));
  });
}

function switchSeason(year) {
  api({ action: 'init', season: year }).then(function (r) {
    if (!r.ok) { fail(r); return; }
    render(r);
  });
}

function setUnit(u) {
  state.unit = u;
  localStorage.setItem('ledger_unit', u);
  if (state.data) render({ ok: true, today: state.today, season: state.season, seasons: state.seasons, data: state.data });
}

function changePw() {
  var pw = $('newPw').value.trim();
  if (pw.length < 4) { toast('新密碼至少 4 個字'); return; }
  api({ action: 'changePw', newPw: pw }).then(function (r) {
    if (!r.ok) { fail(r); return; }
    state.pw = pw;
    localStorage.setItem('ledger_pw', pw);
    $('newPw').value = '';
    $('settingsModal').classList.add('hidden');
    toast('✅ 密碼已更新');
  });
}

// ---------- 啟動 ----------

function start() {
  if (state.pw) {
    showMain();
    // 先用快取秒開,背景再更新
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem('ledger_cache') || 'null'); } catch (e) {}
    if (cached && cached.ok) render(cached);
    api({ action: 'init' }, !!cached).then(function (r) {
      if (!r.ok) { fail(r); return; }
      render(r);
    });
  } else {
    api({ action: 'ping', pw: '' }).then(function (r) {
      if (r && r.ok) showLogin(!r.hasPassword);
      else { showLogin(false); $('loginErr').textContent = '連不上後端,請稍後再試'; }
    });
  }
}

// ---------- 事件 ----------

$('loginBtn').addEventListener('click', doLogin);
$('pwInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
$('pwInput2').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

$('saveBtn').addEventListener('click', save);
$('fDate').addEventListener('change', prefillFromDate);
$('fWeight').addEventListener('input', updateWeightHint);
$('unitJin').addEventListener('click', function () { setUnit('jin'); });
$('unitKg').addEventListener('click', function () { setUnit('kg'); });
$('seasonSel').addEventListener('change', function () { switchSeason(this.value); });

$('recordList').addEventListener('click', function (e) {
  var delBtn = e.target.closest('.rec-del');
  if (delBtn) { del(delBtn.getAttribute('data-date')); return; }
  var rec = e.target.closest('.rec');
  if (rec) {
    $('fDate').value = rec.getAttribute('data-date');
    prefillFromDate();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

$('settingsBtn').addEventListener('click', function () { $('settingsModal').classList.remove('hidden'); });
$('closeSettingsBtn').addEventListener('click', function () { $('settingsModal').classList.add('hidden'); });
$('logoutBtn').addEventListener('click', logout);
$('changePwBtn').addEventListener('click', changePw);
$('settingsModal').addEventListener('click', function (e) {
  if (e.target === this) this.classList.add('hidden');
});

start();

})();
