// ==========================================
// 予約表示アプリ (app.js)
// 改修内容: GAS_URLを「予約管理メイン」の新URLに更新
// ==========================================

const GAS_URL = "https://script.google.com/macros/s/AKfycbwpNRM_753x0gG5sl5_LTwxn5afUUQqezpmPb874-Stsl5aVUJBLTBk70nW5RE_mdU0/exec";

let currentArea = '多摩';
let dataCache = {};

/**
 * 初期化処理
 */
window.onload = function() {
    loadData(currentArea);
};

/**
 * エリア切り替え
 */
function switchArea(area) {
    if (currentArea === area) return;
    currentArea = area;
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.innerText === area) btn.classList.add('active');
    });

    loadData(area);
}

/**
 * データ取得 (Fetch API)
 */
async function loadData(areaName) {
    const container = document.getElementById('vehicle-container');
    const updateTimeEl = document.getElementById('update-time');
    
    // キャッシュ確認
    if (dataCache[areaName]) {
        renderData(dataCache[areaName]);
        return;
    }

    container.innerHTML = '<div class="loading">データを読み込み中...</div>';

    try {
        const response = await fetch(`${GAS_URL}?action=getData&areaName=${encodeURIComponent(areaName)}`);
        if (!response.ok) throw new Error("ネットワークエラー");
        
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        dataCache[areaName] = data;
        renderData(data);
    } catch (err) {
        container.innerHTML = `<div class="error">エラー: ${err.message}</div>`;
    }
}

/**
 * 画面レンダリング
 */
function renderData(data) {
    const container = document.getElementById('vehicle-container');
    const updateTimeEl = document.getElementById('update-time');
    
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="no-data">対象車両はありません</div>';
        updateTimeEl.innerText = "--:--";
        return;
    }

    // タイムラインの基準時刻 (getTime) を取得
    const baseTime = data[0][4];
    updateTimeEl.innerText = baseTime;

    let html = '';
    data.forEach(row => {
        const [station, plate, model, , , rsvData] = row;
        
        html += `
            <div class="vehicle-card">
                <div class="card-header">
                    <span class="station">${station}</span>
                    <span class="plate">${plate} / ${model}</span>
                </div>
                <div class="timeline-container">
                    ${generateTimeline(rsvData)}
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

/**
 * タイムライン(○×s)の生成
 */
function generateTimeline(rsvData) {
    if (!rsvData) return '';
    
    // 288文字のデータをスロットに変換
    let slots = '';
    for (let i = 0; i < rsvData.length; i++) {
        const char = rsvData[i];
        let className = 'empty';
        if (char === '○') className = 'vacant';
        if (char === '×') className = 'full';
        if (char === 's') className = 'impossible';
        
        slots += `<div class="slot ${className}"></div>`;
    }
    return slots;
}

/**
 * GitHub Actions実行 (手動更新)
 */
async function triggerUpdate() {
    const btn = document.querySelector('.update-btn');
    btn.disabled = true;
    btn.innerText = "更新送信中...";

    try {
        const response = await fetch(`${GAS_URL}?action=triggerGitHubAction&targetArea=${encodeURIComponent(currentArea)}`);
        const result = await response.json();
        
        if (result === "OK") {
            alert("更新リクエストを送信しました。数分後に反映されます。");
        } else {
            throw new Error(result.error || "送信失敗");
        }
    } catch (err) {
        alert("エラー: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "手動更新";
    }
}
