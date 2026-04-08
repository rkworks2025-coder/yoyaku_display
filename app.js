/**
 * yoyaku_display - app.js (キャッシュ表示・JSONP堅牢版)
 * 既存のロジックを維持しつつ、localStorageによる即時表示を追加
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbx1_sRPTOfl6wW0yVMN9emCAfcz2NfkXCh9mRXwwBPk5h65fY9bl69ShK5Tsoaklehufw/exec";

let currentArea = '大和';
let progressTimer;

window.onload = function() { 
  switchArea('大和');
  checkExistingPatrol();
};

/**
 * JSONP通信コアロジック
 */
function callGAS(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('通信タイムアウト: GASからの応答がありません'));
    }, 30000);

    const cleanup = () => {
      clearTimeout(timeout);
      delete window[callbackName];
      const script = document.getElementById(callbackName);
      if (script) script.remove();
    };

    window[callbackName] = function(data) {
      cleanup();
      if (data && data.error) {
        reject(data.error);
      } else {
        resolve(data);
      }
    };

    const queryParams = new URLSearchParams({ 
      action, 
      callback: callbackName,
      ...params 
    }).toString();

    const script = document.createElement('script');
    script.id = callbackName;
    script.src = `${GAS_URL}${GAS_URL.includes('?') ? '&' : '?'}${queryParams}`;
    
    script.onerror = () => {
      cleanup();
      reject(new Error('GASとの通信に失敗しました(JSONP)。デプロイ設定(全員)を確認してください。'));
    };

    document.head.appendChild(script);
  });
}

/**
 * エリア切り替え（キャッシュ即時表示対応）
 */
function switchArea(areaName) {
  currentArea = areaName;
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.textContent === areaName));
  
  const cacheKey = `yoyaku_cache_${areaName}`;
  const cachedRaw = localStorage.getItem(cacheKey);
  
  // 1. キャッシュがあれば即座に描画
  if (cachedRaw) {
    try {
      const cachedData = JSON.parse(cachedRaw);
      renderData(cachedData, true); // キャッシュであることを示すフラグを渡す
    } catch (e) {
      localStorage.removeItem(cacheKey);
    }
  } else {
    // キャッシュがない場合のみ読み込み中を表示
    document.getElementById('car-list').innerHTML = '<div class="loading">読み込み中...</div>';
    document.getElementById('display-time').textContent = '--:-- 取得';
    document.getElementById('car-count').textContent = '-- 台';
  }

  // 2. バックグラウンドで最新データを取得
  callGAS('getData', { areaName })
    .then(newData => {
      const newRaw = JSON.stringify(newData);
      // 3. データに変化がある場合のみ再描画・保存
      if (newRaw !== cachedRaw) {
        localStorage.setItem(cacheKey, newRaw);
        renderData(newData, false);
      } else {
        // 変化がない場合、取得時刻のみ更新（任意）
        updateTime();
      }
    })
    .catch(renderError);
}

function startPatrol() {
  const btn = document.getElementById('update-btn');
  const select = document.getElementById('area-select');
  if (!confirm(`巡回を開始しますか？`)) return;
  
  btn.disabled = true; 
  select.disabled = true; 
  btn.textContent = '起動中...';

  callGAS('triggerGitHubAction', { targetArea: select.value })
    .then(res => {
      if (res === 'OK') { 
        btn.textContent = '巡回中...'; 
        startWatchingProgress(); 
      } else { 
        alert('起動エラー: ' + res); 
        resetButton(); 
      }
    })
    .catch(e => { 
      alert('通信エラー: ' + e); 
      resetButton(); 
    });
}

function checkExistingPatrol() {
  callGAS('getProgressStatus')
    .then(data => {
      if (data.total > 0 && data.current < data.total) {
        document.getElementById('update-btn').disabled = true;
        document.getElementById('area-select').disabled = true;
        startWatchingProgress();
      }
    })
    .catch(console.error);
}

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
          if (data.current >= data.total - 1) patrolFinished();
        } else if (data.isEmpty) { 
          patrolFinished(); 
        }
      })
      .catch(console.error);
  }, 15000);
}

function patrolFinished() {
  if(progressTimer) clearInterval(progressTimer);
  document.getElementById('update-btn').textContent = '✅ 完了！';
  setTimeout(() => location.reload(), 3000);
}

function resetButton() {
  const btn = document.getElementById('update-btn');
  btn.disabled = false; 
  document.getElementById('area-select').disabled = false;
  btn.textContent = '↻ 更新開始'; 
  btn.style.setProperty('--progress-width', '0%');
  if(progressTimer) clearInterval(progressTimer);
}

/**
 * データの描画
 * @param {Array} data 取得データ
 * @param {boolean} isCache キャッシュからの読み込みかどうか
 */
function renderData(data, isCache = false) {
  const listDiv = document.getElementById('car-list');
  listDiv.innerHTML = "";
  if (!data || data.length === 0 || data.error) {
    listDiv.innerHTML = `<div class="loading">${data?.error || "データがありません"}</div>`;
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
      card.innerHTML = `<div class="station-name">📍 ${station}</div><div class="car-name">${plate}</div><div class="error-msg">【データ異常】取得数が不整合です (${timelineStr.length} / 288または576想定)</div>`;
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
          const mm = slotDate.getMonth() + 1;
          const dd = slotDate.getDate();
          labelsHtml += `<div class="ruler-label" style="left: ${leftPos}%; transform: none; margin-left: 6px; color: #ffcc00; z-index: 10;">${mm}/${dd}</div>`;
        }
      }
      gridsHtml += `<div class="grid-line" style="left: ${leftPos}%;"></div>`;
    }
    
    card.innerHTML = `<div class="station-name">📍 ${station}</div><div class="car-name">${plate} <span style="font-size:0.8em; font-weight:normal;">/ ${model}</span></div><div class="scroll-wrapper"><div class="timeline-full-width" style="width: ${timelineWidth}px;">${labelsHtml}${timelineHtml}${gridsHtml}</div></div>`;
    listDiv.appendChild(card);
  });

  // キャッシュ表示時は「取得」時間を更新しない（バックグラウンド更新完了時に更新される）
  if (!isCache) {
    updateTime();
  } else {
    const now = new Date();
    document.getElementById('display-time').textContent = `(保存) ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
}

function renderError(e) { 
  document.getElementById('car-list').innerHTML = `<div class="loading">エラー: ${e}</div>`;
}

function updateTime() {
  const now = new Date();
  document.getElementById('display-time').textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} 取得`;
}
