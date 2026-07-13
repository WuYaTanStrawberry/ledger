(function () {
'use strict';

var GAS = window.CONFIG.gasUrl;
var JIN_KG = 0.6; // 1 台斤 = 0.6 公斤
var $ = function (id) { return document.getElementById(id); };

var CATS = ['觀光採果', '宅配', '盤商'];
var LEGACY_CAT = '未分類';
var GRADES = ['1號', '2號', '3號', '4號', '5號'];
var CAT_META = {
  '觀光採果': { emoji: '🧺', cls: 'c-pick' },
  '宅配':     { emoji: '📦', cls: 'c-ship' },
  '盤商':     { emoji: '🚚', cls: 'c-whole' },
  '未分類':   { emoji: '📄', cls: 'c-none' }
};

var state = {
  pw: localStorage.getItem('ledger_pw') || '',
  unit: localStorage.getItem('ledger_unit') || 'jin', // jin=台斤, kg=公斤
  needSetup: false,
  today: '',
  season: null,
  seasons: [],
  data: null,
  editingId: null
};

// ---------- 小工具 ----------

function fmt(n) { return Number(n || 0).toLocaleString('zh-TW'); }

// 私密瀏覽模式下 setItem 可能丟例外,一律包起來
function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function kgToUnit(kg, unit) { return (unit || state.unit) === 'jin' ? kg / JIN_KG : kg; }
function unitToKg(w, unit) { return (unit || state.unit) === 'jin' ? w * JIN_KG : w; }
function unitName(unit) { return (unit || state.unit) === 'jin' ? '台斤' : '公斤'; }
function weightStr(kg, unit) {
  return round1(kgToUnit(kg, unit)).toLocaleString('zh-TW') + ' ' + unitName(unit);
}
function altWeightStr(kg) {
  if (state.unit === 'jin') return '= ' + round2(kg).toLocaleString('zh-TW') + ' 公斤';
  return '= ' + round1(kg / JIN_KG).toLocaleString('zh-TW') + ' 台斤';
}

function catMeta(cat) { return CAT_META[cat] || CAT_META[LEGACY_CAT]; }
function chipHtml(cat, grade) {
  var m = catMeta(cat);
  return '<span class="chip ' + m.cls + '">' + m.emoji + ' ' + esc(cat) +
    (grade ? '<b class="grade">' + esc(grade) + '</b>' : '') + '</span>';
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
    store('ledger_pw', pw);
    showMain();
    render(r);
  });
}

function logout() {
  state.pw = '';
  localStorage.removeItem('ledger_pw');
  localStorage.removeItem('ledger_cache2');
  $('settingsModal').classList.add('hidden');
  showLogin(false);
}

// ---------- 畫面渲染 ----------

function render(resp) {
  state.today = resp.today;
  state.season = resp.season;
  state.seasons = resp.seasons;
  state.data = resp.data;
  store('ledger_cache2', JSON.stringify(resp));

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
  renderCats();
  renderChart();
  renderList();
  if (!$('fDate').value) $('fDate').value = state.today;
}

function renderUnitToggle() {
  $('unitJin').classList.toggle('on', state.unit === 'jin');
  $('unitKg').classList.toggle('on', state.unit === 'kg');
  $('weightLabel').textContent = '產量(' + unitName() + ')';
  updateWeightHint();
}

// 單價 × 總收入 → 自動算產量
function autoCalcWeight() {
  var price = Number($('fPrice').value) || 0;
  var revenue = Number($('fRevenue').value) || 0;
  if (price > 0 && revenue > 0) {
    $('fWeight').value = round1(revenue / price);
  }
  updateWeightHint();
}

function updateWeightHint() {
  var w = Number($('fWeight').value) || 0;
  var price = Number($('fPrice').value) || 0;
  var revenue = Number($('fRevenue').value) || 0;
  var parts = [];
  if (price > 0 && revenue > 0) {
    parts.push('自動計算:$' + fmt(revenue) + ' ÷ $' + fmt(price) + ' = ' + round1(revenue / price) + ' ' + unitName());
  }
  if (w > 0) {
    var kg = unitToKg(w);
    parts.push(state.unit === 'jin'
      ? '= ' + round2(kg) + ' 公斤'
      : '= ' + round1(kg / JIN_KG) + ' 台斤');
  }
  $('weightHint').textContent = parts.join('・');
}

function onCatChange() {
  $('gradeField').classList.toggle('hidden', $('fCat').value !== '盤商');
}

// 編輯舊資料才會出現「未分類」選項
function ensureLegacyOption(need) {
  var sel = $('fCat');
  var opt = sel.querySelector('option[value="' + LEGACY_CAT + '"]');
  if (need && !opt) {
    opt = document.createElement('option');
    opt.value = LEGACY_CAT;
    opt.textContent = '📄 未分類(舊資料)';
    sel.appendChild(opt);
  } else if (!need && opt) {
    opt.remove();
  }
}

function renderCats() {
  var cats = state.data.cats || {};
  var grades = state.data.grades || {};
  var el = $('catStats');
  var order = CATS.concat(cats[LEGACY_CAT] ? [LEGACY_CAT] : []);
  var present = order.filter(function (c) { return cats[c]; });
  if (!present.length) {
    el.innerHTML = '<p class="muted center small">本季還沒有紀錄</p>';
    return;
  }
  var max = Math.max.apply(null, present.map(function (c) { return cats[c].revenue; }));
  el.innerHTML = present.map(function (c) {
    var v = cats[c];
    var pct = max ? Math.max(2, Math.round(v.revenue / max * 100)) : 2;
    var html = '<div class="cat-row">' +
      '<div class="cat-head">' + chipHtml(c) +
        '<span class="cat-nums">$' + fmt(v.revenue) + '・' + weightStr(v.kg) + '</span></div>' +
      '<div class="bar slim"><div class="bar-fill ' + catMeta(c).cls + '" style="width:' + pct + '%"></div></div>';
    if (c === '盤商') {
      var gRows = GRADES.filter(function (g) { return grades[g]; }).map(function (g) {
        return '<div class="grade-row"><span class="grade-name">' + g + '</span>' +
          '<span>$' + fmt(grades[g].revenue) + '・' + weightStr(grades[g].kg) + '</span></div>';
      }).join('');
      if (gRows) html += '<div class="grade-list">' + gRows + '</div>';
    }
    return html + '</div>';
  }).join('');
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
  // 按日期分組(後端已照日期新→舊排好)
  var dates = [];
  var byDate = {};
  rows.forEach(function (r) {
    if (!byDate[r.date]) { byDate[r.date] = []; dates.push(r.date); }
    byDate[r.date].push(r);
  });
  el.innerHTML = dates.map(function (d) {
    var list = byDate[d];
    var rev = 0, kg = 0;
    list.forEach(function (r) { rev += r.revenue; kg += r.kg; });
    var head = '<div class="day-head"><span class="day-date">' + dateLabel(d) + '</span>' +
      '<span class="day-sum">$' + fmt(rev) + '・' + weightStr(kg) + '</span></div>';
    var items = list.map(function (r) {
      var priceInfo = r.price
        ? '<span class="rec-price">$' + fmt(r.price) + '/' + unitName(r.priceUnit) + '</span>'
        : '';
      return '<div class="rec" data-id="' + esc(r.id) + '">' +
        '<div class="rec-main">' +
          '<div class="rec-tags">' + chipHtml(r.category, r.grade) + priceInfo + '</div>' +
          (r.note ? '<div class="rec-note">' + esc(r.note) + '</div>' : '') +
        '</div>' +
        '<div class="rec-nums">' +
          '<div class="rec-rev">$' + fmt(r.revenue) + '</div>' +
          '<div class="rec-kg">' + (r.kg ? weightStr(r.kg) : '') + '</div>' +
        '</div>' +
        '<button class="rec-del" data-id="' + esc(r.id) + '" aria-label="刪除">🗑️</button>' +
        '</div>';
    }).join('');
    return '<div class="day-group">' + head + items + '</div>';
  }).join('');
}

// ---------- 編輯 ----------

function findEntry(id) {
  return (state.data && state.data.records || []).find(function (r) { return r.id === id; });
}

function startEdit(id) {
  var r = findEntry(id);
  if (!r) return;
  state.editingId = id;
  state.unit = r.priceUnit === 'kg' ? 'kg' : 'jin';
  store('ledger_unit', state.unit);
  ensureLegacyOption(r.category === LEGACY_CAT);
  $('fDate').value = r.date;
  $('fCat').value = r.category;
  onCatChange();
  if (r.category === '盤商' && r.grade) $('fGrade').value = r.grade;
  $('fPrice').value = r.price || '';
  $('fRevenue').value = r.revenue || '';
  $('fWeight').value = r.kg ? round1(kgToUnit(r.kg)) : '';
  $('fNote').value = r.note || '';
  $('entryTitle').textContent = '✏️ 修改 ' + dateLabel(r.date) + ' 的紀錄';
  $('saveBtn').textContent = '💾 更新這一筆';
  $('cancelEditBtn').classList.remove('hidden');
  $('entryHint').textContent = '正在修改已存在的紀錄,儲存會覆蓋原本的數字';
  renderUnitToggle();
  refreshWeightDisplays(); // 單位可能跟著這筆切換了,同步全頁顯示
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  state.editingId = null;
  ensureLegacyOption(false);
  if ($('fCat').value === LEGACY_CAT) { $('fCat').value = CATS[0]; onCatChange(); }
  $('fPrice').value = '';
  $('fRevenue').value = '';
  $('fWeight').value = '';
  $('fNote').value = '';
  $('fDate').value = state.today || $('fDate').value;
  $('entryTitle').textContent = '📝 記一筆';
  $('saveBtn').textContent = '💾 儲存';
  $('cancelEditBtn').classList.add('hidden');
  $('entryHint').textContent = '';
  updateWeightHint();
}

// ---------- 動作 ----------

function save() {
  var date = $('fDate').value;
  if (!date) { toast('請選日期'); return; }
  var category = $('fCat').value;
  var grade = category === '盤商' ? $('fGrade').value : '';
  var price = Number($('fPrice').value) || 0;
  var revenue = Number($('fRevenue').value) || 0;
  var w = Number($('fWeight').value) || 0;
  if (!revenue && !w) { toast('請至少填總收入或產量'); return; }

  api({
    action: 'save',
    id: state.editingId || '',
    date: date,
    category: category,
    grade: grade,
    price: price,
    priceUnit: state.unit,
    revenue: revenue,
    kg: round2(unitToKg(w)),
    note: $('fNote').value.trim()
  }).then(function (r) {
    if (!r.ok) { fail(r); return; }
    var wasEdit = !!state.editingId;
    cancelEdit();
    render(r);
    toast(wasEdit ? '✅ 已更新 ' + dateLabel(date) : '✅ 已記下 ' + dateLabel(date) + ' 一筆');
  });
}

function del(id) {
  var r = findEntry(id);
  var desc = r ? dateLabel(r.date) + ' ' + r.category + (r.grade ? '(' + r.grade + ')' : '') + ' $' + fmt(r.revenue) : '這筆紀錄';
  if (!confirm('確定要刪除 ' + desc + ' 嗎?')) return;
  api({ action: 'delete', id: id }).then(function (resp) {
    if (!resp.ok) { fail(resp); return; }
    if (state.editingId === id) cancelEdit();
    render(resp);
    toast('🗑️ 已刪除');
  });
}

function switchSeason(year) {
  api({ action: 'init', season: year }).then(function (r) {
    if (!r.ok) { fail(r); return; }
    render(r);
  });
}

function refreshWeightDisplays() {
  if (!state.data) return;
  renderCats();
  renderChart();
  renderList();
  var t = state.data.total;
  $('stWeight').textContent = weightStr(t.kg);
  $('stWeightSub').textContent = t.kg ? altWeightStr(t.kg) : '';
}

function setUnit(u) {
  state.unit = u;
  store('ledger_unit', u);
  renderUnitToggle();
  autoCalcWeight();
  refreshWeightDisplays();
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
  localStorage.removeItem('ledger_cache'); // 舊版快取格式,清掉
  if (state.pw) {
    showMain();
    // 先用快取秒開,背景再更新
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem('ledger_cache2') || 'null'); } catch (e) {}
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
$('cancelEditBtn').addEventListener('click', cancelEdit);
$('fCat').addEventListener('change', onCatChange);
$('fPrice').addEventListener('input', autoCalcWeight);
$('fRevenue').addEventListener('input', autoCalcWeight);
$('fWeight').addEventListener('input', updateWeightHint);
$('unitJin').addEventListener('click', function () { setUnit('jin'); });
$('unitKg').addEventListener('click', function () { setUnit('kg'); });
$('seasonSel').addEventListener('change', function () { switchSeason(this.value); });

$('recordList').addEventListener('click', function (e) {
  var delBtn = e.target.closest('.rec-del');
  if (delBtn) { del(delBtn.getAttribute('data-id')); return; }
  var rec = e.target.closest('.rec');
  if (rec) startEdit(rec.getAttribute('data-id'));
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
