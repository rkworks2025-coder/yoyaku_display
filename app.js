/**
 * yoyaku_display - app.js (v20260410-FETCH版)
 * 通信方式をJSONPからFetch APIに変更し、Googleの検閲とキャッシュ問題を回避
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbx1_sRPTOfl6wW0yVMN9emCAfcz2NfkXCh9mRXwwBPk5h65fY9bl69ShK5Tsoaklehufw/exec";

let currentArea = '大和';
let progressTimer;

window.onload = function() { 
  switchArea('大和');
  checkExistingPatrol();
  
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const cachedRaw = localStorage.getItem(`yoyaku_cache_${currentArea}`);
      if (cachedRaw) {
        renderData(JSON.parse(cachedRaw), true);
      }
    }
  });
};

/**
 * Fetch API通信コアロジック (JSONP廃止)
 */
async function callGAS(action, params = {}) {
  // ブラウザとGoogle側のキャッシュを強制的にバイパスするための識別子
  const cacheBuster = `_=${Date.now()}`;
  const queryParams = new URLSearchParams({ action, ...params }).toString();
  const url = `${GAS_URL}${GAS_URL.includes('?') ? '&' : '?'}${queryParams}&${cacheBuster}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors', // クロスドメイン通信を明示
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`HTTPステータス: ${response.status}`);
    }

    const data = await response.json();
    if (data && data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    console.error("GAS通信詳細エラー:", e);
    // 従来の呼び出し元との互換性を維持するためErrorオブジェクトを返す
    throw e;
  }
}

/**
 * エリア切り替え（キャッシュ即時表示）
 */
function switchArea(areaName) {
  currentArea = areaName;
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.textContent === areaName));
  
  const cacheKey = `yoyaku_cache_${areaName}`;
  const cachedRaw = localStorage.getItem(cacheKey);
  
  if (cachedRaw) {
    try {
      renderData(JSON.parse(cachedRaw), true);
    } catch (e) { localStorage.removeItem(cacheKey); }
  } else {
    document.getElementById('car-list').innerHTML = '<div class="loading">読み込み中...</div>';
  }

  callGAS('getData', { areaName })
    .then(newData => {
      localStorage.setItem(cacheKey, JSON.stringify(newData));
      renderData(newData, false);
    })
    .catch(renderError);
}

/**
 * 巡回開始
 */
function startPatrol() {
  const btn = document.getElementById('update-btn');
  const select = document.getElementById('area-select');
  if (!confirm(`巡回を開始しますか？`)) return;
  btn.disabled = true; select.disabled = true; btn.textContent = '起動中...';
  
  callGAS('triggerGitHubAction', { targetArea: select.value })
    .then(res => {
      if (res === 'OK') { 
        btn.textContent = '巡回中...'; 
        startWatchingProgress(); 
      } else { 
        alert('エラー: ' + res); 
        resetButton(); 
      }
    })
    .catch(e => { alert('通信エラー: ' + e); resetButton(); });
}

function checkExistingPatrol() {
  callGAS('getProgressStatus')
    .then(data => {
      if (data.total > 0 && data.current < data.total) {
        document.getElementById('update-btn').disabled = true;
        document.getElementById('area-select').disabled = true;
        startWatchingProgress();
      }
    }).catch(console.error);
}

/**
 * 進捗監視
 */
function startWatchingProgress() {
  const btn = document.getElementById('update-btn');
  if(progressTimer) clearInterval(progressTimer);
  
  progressTimer = setInterval(() => {
    callGAS('getProgressStatus')
      .then(data => {
        if (data.current > 0 && data.total > 0) {
          const progress = Math.min(100, (data.current / data.total) * 100);
          btn.style.setProperty('--progress-width', `${progress}%`);
          btn.textContent = `巡回中... (${data.current}/${data.total})`;
          
          if (data.current >= data.total - 1) {
            silentFinalSync();
          }
        } else if (data.isEmpty) { 
          silentFinalSync();
        }
      }).catch(console.error);
  }, 15000);
}

async function silentFinalSync() {
  if(progressTimer) clearInterval(progressTimer);
  
  const btn = document.getElementById('update-btn');
  btn.textContent = '処理中...';

  try {
    const newData = await callGAS('getData', { areaName: currentArea });
    localStorage.setItem(`yoyaku_cache_${currentArea}`, JSON.stringify(newData));
    btn.textContent = '✅ 完了！';
    renderData(newData, false);
  } catch (e) {
    console.error("最終同期失敗:", e);
    btn.textContent = '✅ 完了(同期失敗)';
  }
  
  setTimeout(() => resetButton(), 3000);
}

function patrolFinished() {}

function resetButton() {
  const btn = document.getElementById('update-btn');
  btn.disabled = false; 
  document.getElementById('area-select').disabled = false;
  btn.textContent = '↻ 更新開始'; 
  btn.style.setProperty('--progress-width', '0%');
  if(progressTimer) clearInterval(progressTimer);
}

function renderData(data, isCache = false) {
  const listDiv = document.getElementById('car-list');
  listDiv.innerHTML = "";
  if (!data || data.length === 0 || data.error) {
    listDiv.innerHTML = `<div class="loading">${data?.error || "データなし"}</div>`;
    document.getElementById('car-count').textContent = '0 台';
    return;
  }
  document.getElementById('car-count').textContent = data.length + ' 台';
  
  data.forEach(row => {
    const station = row[0], plate = row[1], model = row[2], getTime = String(row[3]), timelineStr = String(row[4] || "");
    let baseDate = new Date(getTime.replace(/-/g, '/'));
    if (isNaN(baseDate.getTime())) baseDate = new Date();
    const card = document.createElement('div'); card.className = 'car-card';
    
    if (timelineStr.length !== 288 && timelineStr.length !== 576) {
      card.innerHTML = `<div class="station-name">📍 ${station}</div><div class="car-name">${plate}</div><div class="error-msg">データ不整合</div>`;
      listDiv.appendChild(card); return;
    }

    const totalHours = timelineStr.length / 4; 
    const timelineWidth = totalHours === 144 ? 3200 : 1600;

    let timelineHtml = '<div class="timeline-container">';
    for (let char of timelineStr) {
      const cls = char === '○' ? 'status-ok' : (char === 's' ? 'status-stopped' : 'status-ng');
      timelineHtml += `<div class="time-slot ${cls}"></div>`;
    }
    timelineHtml += '</div>';

    let labelsHtml = '', gridsHtml = '';
    for (let h = 0; h < totalHours; h++) { 
      const leftPos = (h / totalHours) * 100;
      const slotDate = new Date(baseDate.getTime() + h * 60 * 60 * 1000);
      const currentHour = slotDate.getHours();
      if (currentHour % 2 === 0) {
        labelsHtml += `<div class="ruler-label" style="left: ${leftPos}%;">${currentHour}</div>`;
        if (currentHour === 0) {
          const mm = slotDate.getMonth() + 1, dd = slotDate.getDate();
          labelsHtml += `<div class="ruler-label" style="left: ${leftPos}%; margin-left: 6px; color: #ffcc00; z-index: 10;">${mm}/${dd}</div>`;
        }
      }
      gridsHtml += `<div class="grid-line" style="left: ${leftPos}%;"></div>`;
    }
    card.innerHTML = `<div class="station-name">📍 ${station}</div><div class="car-name">${plate} <span style="font-size:0.8em; font-weight:normal;">/ ${model}</span></div><div class="scroll-wrapper"><div class="timeline-full-width" style="width: ${timelineWidth}px;">${labelsHtml}${timelineHtml}${gridsHtml}</div></div>`;
    listDiv.appendChild(card);
  });

  if (!isCache) updateTime();
  else {
    const now = new Date();
    document.getElementById('display-time').textContent = `(保存) ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
}

function renderError(e) { document.getElementById('car-list').innerHTML = `<div class="loading">エラー: ${e}</div>`; }

function updateTime() {
  const now = new Date();
  document.getElementById('display-time').textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} 取得`;
}
