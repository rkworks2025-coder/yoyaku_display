/**
 * yoyaku_display - app.js (v20260429-エリア最優先・スマート同期版)
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbx1_sRPTOfl6wW0yVMN9emCAfcz2NfkXCh9mRXwwBPk5h65fY9bl69ShK5Tsoaklehufw/exec";

let currentArea = localStorage.getItem('selected_area') || '大和';
let lastTimestamp = localStorage.getItem('last_update_ts') || 0;
let progressTimer;

window.onload = function() { 
  // 保存されていたエリアで起動
  switchArea(currentArea, true);
  checkExistingPatrol();
  
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      // 復帰時に更新があるかチェック
      smartRefresh();
    }
  });
};

/**
 * エリア切り替え
 * @param {boolean} isInitial 起動時の呼び出しかどうか
 */
function switchArea(areaName, isInitial = false) {
  currentArea = areaName;
  localStorage.setItem('selected_area', areaName);
  
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.textContent === areaName));
  
  const cacheKey = `yoyaku_cache_${areaName}`;
  const cachedRaw = localStorage.getItem(cacheKey);
  
  // まずキャッシュを表示（起動時以外、またはキャッシュがある場合）
  if (cachedRaw) {
    renderData(JSON.parse(cachedRaw), true);
  } else {
    document.getElementById('car-list').innerHTML = '<div class="loading">読み込み中...</div>';
  }

  // 起動時または更新が必要な場合のみGASと通信
  if (isInitial) {
    smartRefresh();
  } else {
    fetchLatestData();
  }
}

/**
 * 更新時刻をチェックし、必要ならリロード
 */
async function smartRefresh() {
  try {
    const status = await callGAS('getProgressStatus');
    // SystemStatus D1 の時刻が保存されているものより新しければ読み込む
    if (String(status.timestamp) !== String(lastTimestamp)) {
      await fetchLatestData();
      lastTimestamp = status.timestamp;
      localStorage.setItem('last_update_ts', lastTimestamp);
    }
  } catch (e) { console.error("更新チェック失敗:", e); }
}

async function fetchLatestData() {
  try {
    const newData = await callGAS('getData', { areaName: currentArea });
    localStorage.setItem(`yoyaku_cache_${currentArea}`, JSON.stringify(newData));
    renderData(newData, false);
  } catch (e) { renderError(e); }
}

async function callGAS(action, params = {}) {
  const cacheBuster = `_=${Date.now()}`;
  const queryParams = new URLSearchParams({ action, ...params }).toString();
  const url = `${GAS_URL}${GAS_URL.includes('?') ? '&' : '?'}${queryParams}&${cacheBuster}`;

  const response = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP: ${response.status}`);
  const data = await response.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

function startPatrol() {
  const btn = document.getElementById('update-btn');
  const select = document.getElementById('area-select');
  if (!confirm(`巡回を開始しますか？`)) return;
  btn.disabled = true; select.disabled = true; btn.textContent = '起動中...';
  
  callGAS('triggerGitHubAction', { targetArea: select.value })
    .then(res => {
      if (res === 'OK') { startWatchingProgress(); } 
      else { alert('エラー: ' + res); resetButton(); }
    }).catch(e => { alert('通信エラー: ' + e); resetButton(); });
}

function startWatchingProgress() {
  if(progressTimer) clearInterval(progressTimer);
  const btn = document.getElementById('update-btn');

  progressTimer = setInterval(() => {
    callGAS('getProgressStatus')
      .then(data => {
        if (data.current > 0 && data.total > 0) {
          const progress = Math.min(100, (data.current / data.total) * 100);
          btn.style.setProperty('--progress-width', `${progress}%`);
          btn.textContent = `巡回中... (${data.current}/${data.total})`;
          
          // 完了検知
          if (data.current >= data.total - 1 || data.isEmpty) {
            finishPatrolSequence(data.timestamp);
          }
        }
      }).catch(console.error);
  }, 10000);
}

async function finishPatrolSequence(newTs) {
  if(progressTimer) clearInterval(progressTimer);
  const btn = document.getElementById('update-btn');
  btn.textContent = '同期中...';

  lastTimestamp = newTs;
  localStorage.setItem('last_update_ts', lastTimestamp);
  
  await fetchLatestData();
  btn.textContent = '✅ 完了';
  setTimeout(() => resetButton(), 3000);
}

function checkExistingPatrol() {
  callGAS('getProgressStatus').then(data => {
    if (data.total > 0 && data.current < data.total) {
      document.getElementById('update-btn').disabled = true;
      startWatchingProgress();
    }
  }).catch(console.error);
}

function resetButton() {
  const btn = document.getElementById('update-btn');
  btn.disabled = false; document.getElementById('area-select').disabled = false;
  btn.textContent = '↻ 更新開始'; btn.style.setProperty('--progress-width', '0%');
}

function renderData(data, isCache = false) {
  const listDiv = document.getElementById('car-list');
  listDiv.innerHTML = "";
  if (!data || data.length === 0) {
    listDiv.innerHTML = '<div class="loading">車両なし</div>';
    document.getElementById('car-count').textContent = '0 台';
    return;
  }
  document.getElementById('car-count').textContent = data.length + ' 台';
  
  data.forEach(row => {
    const [station, plate, model, getTime, timelineStr] = row;
    const card = document.createElement('div'); card.className = 'car-card';
    
    if (!timelineStr || (timelineStr.length !== 288 && timelineStr.length !== 576)) {
      card.innerHTML = `<div class="station-name">📍 ${station}</div><div class="car-name">${plate}</div><div class="error-msg">データ不整合</div>`;
      listDiv.appendChild(card); return;
    }

    const totalHours = timelineStr.length / 4; 
    const timelineWidth = totalHours === 144 ? 3200 : 1600;
    let baseDate = new Date(String(getTime).replace(/-/g, '/'));
    if (isNaN(baseDate.getTime())) baseDate = new Date();

    let timelineHtml = '<div class="timeline-container">';
    for (let char of timelineStr) {
      const cls = char === '○' ? 'status-ok' : (char === 's' ? 'status-stopped' : 'status-ng');
      timelineHtml += `<div class="time-slot ${cls}"></div>`;
    }
    timelineHtml += '</div>';

    let labelsHtml = '';
    for (let h = 0; h < totalHours; h++) { 
      const leftPos = (h / totalHours) * 100;
      const slotDate = new Date(baseDate.getTime() + h * 60 * 60 * 1000);
      const currentHour = slotDate.getHours();
      if (currentHour % 2 === 0) {
        labelsHtml += `<div class="ruler-label" style="left: ${leftPos}%;">${currentHour}</div>`;
        if (currentHour === 0) {
          labelsHtml += `<div class="ruler-label" style="left: ${leftPos}%; margin-left: 6px; color: #ffcc00; top: 11px;">${slotDate.getMonth()+1}/${slotDate.getDate()}</div>`;
        }
      }
    }
    card.innerHTML = `<div class="station-name">📍 ${station}</div><div class="car-name">${plate} <span style="font-size:0.8em; font-weight:normal;">/ ${model}</span></div><div class="scroll-wrapper"><div class="timeline-full-width" style="width: ${timelineWidth}px;">${labelsHtml}${timelineHtml}</div></div>`;
    listDiv.appendChild(card);
  });
  updateTimeDisplay(isCache);
}

function updateTimeDisplay(isCache) {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  document.getElementById('display-time').textContent = isCache ? `(保存) ${timeStr}` : `${timeStr} 取得`;
}

function renderError(e) { document.getElementById('car-list').innerHTML = `<div class="loading">エラー: ${e}</div>`; }
