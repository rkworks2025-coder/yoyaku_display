/**
 * yoyaku_display - app.js
 * 既存のロジックとUI処理を100%維持
 */

const GAS_URL = "https://script.google.com/macros/s/AKfycbx1_sRPTOfl6wW0yVMN9emCAfcz2NfkXCh9mRXwwBPk5h65fY9bl69ShK5Tsoaklehufw/exec";

let currentArea = '大和';
let progressTimer;

window.onload = function() { 
  switchArea('大和');
  checkExistingPatrol();
};

/**
 * GASへの汎用通信関数 (google.script.run の代替)
 */
async function callGAS(action, params = {}) {
  const query = new URLSearchParams({ action, ...params }).toString();
  try {
    const response = await fetch(`${GAS_URL}?${query}`);
    if (!response.ok) throw new Error('Network response was not ok');
    return await response.json();
  } catch (error) {
    console.error('GAS Connection Error:', error);
    throw error;
  }
}

function switchArea(areaName) {
  currentArea = areaName;
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.textContent === areaName));
  updateTime();
  document.getElementById('car-list').innerHTML = '<div class="loading">読み込み中...</div>';
  
  callGAS('getData', { areaName })
    .then(renderData)
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

function renderData(data) {
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
}

function renderError(e) { 
  document.getElementById('car-list').innerHTML = `<div class="loading">エラー: ${e}</div>`;
}

function updateTime() {
  const now = new Date();
  document.getElementById('display-time').textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} 取得`;
}
