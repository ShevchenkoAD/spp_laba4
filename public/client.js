const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const lobbyScreen = document.getElementById('lobby-screen');
const gameUi = document.getElementById('game-ui');
const alertBanner = document.getElementById('alert-banner');
const itemIcon = document.getElementById('item-icon');
const btnStartGame = document.getElementById('btn-start-game');
const btnVoteReady = document.getElementById('btn-vote-ready');
const hudPhaseTimer = document.getElementById('hud-phase-timer');
const hudRoundTimer = document.getElementById('hud-round-timer');
const hudRound = document.getElementById('hud-round');
const debugToolbar = document.getElementById('debug-toolbar');
const playersTableBody = document.getElementById('players-table-body');

const lapModal = document.getElementById('lap-modal');
const modalLapTitle = document.getElementById('modal-lap-title');
const modalLapTimer = document.getElementById('modal-lap-timer');
const modalTableHeaders = document.getElementById('modal-table-headers');
const modalTableBody = document.getElementById('modal-table-body');
const btnModalAction = document.getElementById('btn-modal-action');
const gameOverDownloads = document.getElementById('game-over-downloads');
const btnDlLastPng = document.getElementById('btn-dl-last-png');
const btnDlLastSvg = document.getElementById('btn-dl-last-svg');

const btnOpenHistory = document.getElementById('btn-open-history');
const historyModal = document.getElementById('history-modal');
const historyList = document.getElementById('history-list');
const btnCloseHistory = document.getElementById('btn-close-history');

let ws = null;
let myId = null;
let currentRoom = null;
let gameState = null;
let isDebugRoom = false;
let isGameOver = false;
let lastMatchTraps = [];

let mousePos = { x: 0, y: 0, onCanvas: false };
let currentItemRotation = 0;

const ITEM_NAMES = {
  bumper: 'БАМПЕР',
  thin_wall: 'СТЕНА',
  turbine: 'ТУРБИНА',
  ice: 'ЛЕД',
  oil: 'МАСЛО',
  boost: 'ТУРБО',
  bomb: 'БОМБА'
};

function getPlatformBounds(x) {
  if (x < 20 || x > 980) return null;
  let indent = 0;
  const d = Math.abs(x - 500);
  if (d < 340) {
    indent = 130 * 0.5 * (1 + Math.cos((d / 340) * Math.PI));
  }
  return {
    top: 20 + indent,
    bottom: 540 - indent
  };
}

const MAP_HOLES = [
  { x: 330, y: 170, r: 35 },
  { x: 330, y: 390, r: 35 },
  { x: 500, y: 280, r: 34 },
  { x: 670, y: 170, r: 35 },
  { x: 670, y: 390, r: 35 }
];


function drawTraps(targetCtx, traps) {
  (traps || []).forEach(t => {
    targetCtx.save();
    targetCtx.translate(t.x, t.y);
    targetCtx.rotate(t.angle || 0);

    
    if (t.type === 'oil') {
      targetCtx.fillStyle = '#111317';
      targetCtx.beginPath();
      targetCtx.arc(0, 0, 28, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.strokeStyle = 'rgba(70, 90, 110, 0.5)';
      targetCtx.lineWidth = 2;
      targetCtx.stroke();
    }
    
    else if (t.type === 'bumper') {
      targetCtx.fillStyle = '#1e232a';
      targetCtx.beginPath();
      targetCtx.arc(0, 0, 14, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.strokeStyle = '#e74c3c';
      targetCtx.lineWidth = 3;
      targetCtx.stroke();
    }
    
    else if (t.type === 'thin_wall') {
      targetCtx.fillStyle = '#cbd5e1';
      targetCtx.fillRect(-25, -3, 50, 6);
      targetCtx.strokeStyle = '#475569';
      targetCtx.lineWidth = 1;
      targetCtx.strokeRect(-25, -3, 50, 6);
    }
    
    else if (t.type === 'turbine') {
      targetCtx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      targetCtx.beginPath();
      targetCtx.moveTo(0, 0);
      targetCtx.lineTo(130, -26);
      targetCtx.lineTo(130, 26);
      targetCtx.closePath();
      targetCtx.fill();

      targetCtx.fillStyle = '#0284c7';
      targetCtx.beginPath();
      targetCtx.arc(0, 0, 11, 0, Math.PI * 2);
      targetCtx.fill();

      targetCtx.fillStyle = '#38bdf8';
      targetCtx.beginPath();
      targetCtx.moveTo(0, -6); targetCtx.lineTo(16, 0); targetCtx.lineTo(0, 6);
      targetCtx.fill();
    }
    
    else if (t.type === 'ice') {
      targetCtx.fillStyle = 'rgba(129, 207, 224, 0.75)';
      targetCtx.fillRect(-30, -30, 60, 60);
      targetCtx.strokeStyle = '#e0f7fa';
      targetCtx.lineWidth = 1.5;
      targetCtx.strokeRect(-30, -30, 60, 60);
    }
    
    else if (t.type === 'boost') {
      targetCtx.fillStyle = '#112217';
      targetCtx.fillRect(-16, -14, 32, 28);
      targetCtx.strokeStyle = '#27ae60';
      targetCtx.lineWidth = 1.5;
      targetCtx.strokeRect(-16, -14, 32, 28);
      targetCtx.strokeStyle = '#2ecc71';
      targetCtx.lineWidth = 3.5;
      targetCtx.lineCap = 'round';
      targetCtx.lineJoin = 'miter';
      [-8, 0, 8].forEach(offsetX => {
        targetCtx.beginPath();
        targetCtx.moveTo(offsetX - 4, -9);
        targetCtx.lineTo(offsetX + 3, 0);
        targetCtx.lineTo(offsetX - 4, 9);
        targetCtx.stroke();
      });
    }
    
    else if (t.type === 'bomb') {
      targetCtx.fillStyle = '#111317';
      targetCtx.beginPath();
      targetCtx.arc(0, 0, 14, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.strokeStyle = '#e74c3c';
      targetCtx.lineWidth = 2.5;
      targetCtx.stroke();

      targetCtx.fillStyle = '#e67e22';
      targetCtx.fillRect(-2, -18, 4, 6);
    }

    targetCtx.restore();
  });
}


function drawMapToContext(targetCtx, traps) {
  targetCtx.clearRect(0, 0, 1000, 560);

  function traceHourglass(c) {
    c.beginPath();
    c.moveTo(20, 20);
    c.lineTo(160, 20);
    for (let x = 160; x <= 840; x += 10) {
      const b = getPlatformBounds(x);
      c.lineTo(x, b.top);
    }
    c.lineTo(980, 20);
    c.lineTo(980, 540);
    c.lineTo(840, 540);
    for (let x = 840; x >= 160; x -= 10) {
      const b = getPlatformBounds(x);
      c.lineTo(x, b.bottom);
    }
    c.lineTo(20, 540);
    c.closePath();
  }

  targetCtx.save();
  traceHourglass(targetCtx);
  targetCtx.fillStyle = '#1e222b';
  targetCtx.fill();
  targetCtx.clip();

  
  targetCtx.fillStyle = '#182b20';
  targetCtx.fillRect(20, 20, 140, 520);
  targetCtx.strokeStyle = '#27ae60';
  targetCtx.lineWidth = 3;
  targetCtx.beginPath();
  targetCtx.moveTo(160, 20); targetCtx.lineTo(160, 540);
  targetCtx.stroke();

  targetCtx.fillStyle = '#261e30';
  targetCtx.fillRect(840, 20, 140, 520);
  targetCtx.fillStyle = '#ffffff';
  for (let y = 20; y < 540; y += 20) {
    targetCtx.fillRect(835, y, 10, 10);
    targetCtx.fillRect(845, y + 10, 10, 10);
  }
  targetCtx.restore();

  targetCtx.strokeStyle = 'rgba(231, 76, 60, 0.45)';
  targetCtx.lineWidth = 2.5;
  traceHourglass(targetCtx);
  targetCtx.stroke();

  
  MAP_HOLES.forEach(h => {
    targetCtx.fillStyle = '#0b0d10';
    targetCtx.beginPath();
    targetCtx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
    targetCtx.fill();
    targetCtx.strokeStyle = '#e74c3c';
    targetCtx.lineWidth = 2.5;
    targetCtx.stroke();
  });

  
  drawTraps(targetCtx, traps);
}


function generateMapSVG(traps) {
  let topD = 'M 20 20 L 160 20 ';
  for (let x = 160; x <= 840; x += 10) {
    const b = getPlatformBounds(x);
    topD += `L ${x} ${b.top} `;
  }
  topD += 'L 980 20 L 980 540 L 840 540 ';
  for (let x = 840; x >= 160; x -= 10) {
    const b = getPlatformBounds(x);
    topD += `L ${x} ${b.bottom} `;
  }
  topD += 'L 20 540 Z';

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" width="1000" height="560">
  <rect width="1000" height="560" fill="#0b0d10"/>
  <path d="${topD}" fill="#1e222b" stroke="rgba(231,76,60,0.45)" stroke-width="2.5"/>
  <rect x="20" y="20" width="140" height="520" fill="#182b20" opacity="0.6"/>
  <line x1="160" y1="20" x2="160" y2="540" stroke="#27ae60" stroke-width="3"/>
  <rect x="840" y="20" width="140" height="520" fill="#261e30" opacity="0.6"/>
  <line x1="840" y1="20" x2="840" y2="540" stroke="#ffffff" stroke-width="3" stroke-dasharray="10 10"/>
`;

  MAP_HOLES.forEach(h => {
    svg += `  <circle cx="${h.x}" cy="${h.y}" r="${h.r}" fill="#0b0d10" stroke="#e74c3c" stroke-width="2.5"/>\n`;
  });

  (traps || []).forEach(t => {
    const deg = ((t.angle || 0) * 180) / Math.PI;
    svg += `  <g transform="translate(${t.x}, ${t.y}) rotate(${deg})">\n`;
    if (t.type === 'oil') {
      svg += `    <circle cx="0" cy="0" r="28" fill="#111317" stroke="rgba(70,90,110,0.5)" stroke-width="2"/>\n`;
    } else if (t.type === 'bumper') {
      svg += `    <circle cx="0" cy="0" r="14" fill="#1e232a" stroke="#e74c3c" stroke-width="3"/>\n`;
    } else if (t.type === 'thin_wall') {
      svg += `    <rect x="-25" y="-3" width="50" height="6" fill="#cbd5e1" stroke="#475569" stroke-width="1"/>\n`;
    } else if (t.type === 'turbine') {
      svg += `    <polygon points="0,0 130,-26 130,26" fill="rgba(255,255,255,0.16)"/>\n`;
      svg += `    <circle cx="0" cy="0" r="11" fill="#0284c7"/>\n`;
      svg += `    <polygon points="0,-6 16,0 0,6" fill="#38bdf8"/>\n`;
    } else if (t.type === 'ice') {
      svg += `    <rect x="-30" y="-30" width="60" height="60" fill="rgba(129,207,224,0.75)" stroke="#e0f7fa" stroke-width="1.5"/>\n`;
    } else if (t.type === 'boost') {
      svg += `    <rect x="-16" y="-14" width="32" height="28" fill="#112217" stroke="#27ae60" stroke-width="1.5"/>\n`;
      [-8, 0, 8].forEach(off => {
        svg += `    <polyline points="${off - 4},-9 ${off + 3},0 ${off - 4},9" fill="none" stroke="#2ecc71" stroke-width="3.5" stroke-linecap="round"/>\n`;
      });
    } else if (t.type === 'bomb') {
      svg += `    <circle cx="0" cy="0" r="14" fill="#111317" stroke="#e74c3c" stroke-width="2.5"/>\n`;
    }
    svg += `  </g>\n`;
  });

  svg += `</svg>`;
  return svg;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadMatchPNG(traps, filename = 'map.png') {
  const off = document.createElement('canvas');
  off.width = 1000;
  off.height = 560;
  const offCtx = off.getContext('2d');
  drawMapToContext(offCtx, traps);
  off.toBlob(blob => downloadBlob(blob, filename), 'image/png');
}

function downloadMatchSVG(traps, filename = 'map.svg') {
  const svgText = generateMapSVG(traps);
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
}



const keys = { w: false, a: false, s: false, d: false, space: false };

window.addEventListener('keydown', e => {
  if (e.code === 'Escape') {
    leaveGame();
    return;
  }
  if (['KeyW', 'ArrowUp'].includes(e.code)) keys.w = true;
  if (['KeyS', 'ArrowDown'].includes(e.code)) keys.s = true;
  if (['KeyA', 'ArrowLeft'].includes(e.code)) keys.a = true;
  if (['KeyD', 'ArrowRight'].includes(e.code)) keys.d = true;
  if (e.code === 'Space') keys.space = true;
  if (e.code === 'Enter') triggerStartGame();
  sendInput();
});

window.addEventListener('keyup', e => {
  if (['KeyW', 'ArrowUp'].includes(e.code)) keys.w = false;
  if (['KeyS', 'ArrowDown'].includes(e.code)) keys.s = false;
  if (['KeyA', 'ArrowLeft'].includes(e.code)) keys.a = false;
  if (['KeyD', 'ArrowRight'].includes(e.code)) keys.d = false;
  if (e.code === 'Space') keys.space = false;
  sendInput();
});

function sendInput() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'INPUT', inputs: keys }));
  }
}

function triggerStartGame() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'START_GAME' }));
  }
}

function triggerReadyVote() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'VOTE_READY' }));
    btnVoteReady.classList.add('voted');
  }
}

btnStartGame.onclick = () => triggerStartGame();
btnVoteReady.onclick = () => triggerReadyVote();

btnModalAction.onclick = () => {
  if (isGameOver) {
    leaveGame();
  } else {
    lapModal.style.display = 'none';
  }
};

btnDlLastPng.onclick = () => downloadMatchPNG(lastMatchTraps, 'final_match_map.png');
btnDlLastSvg.onclick = () => downloadMatchSVG(lastMatchTraps, 'final_match_map.svg');

function leaveGame() {
  if (ws) {
    ws.send(JSON.stringify({ type: 'LEAVE_ROOM' }));
    ws.close();
    ws = null;
  }
  localStorage.removeItem('race_session');
  currentRoom = null;
  myId = null;
  gameState = null;
  isGameOver = false;
  gameUi.style.display = 'none';
  lapModal.style.display = 'none';
  gameOverDownloads.style.display = 'none';
  lobbyScreen.style.display = 'flex';
  loadRecordsAndHistory();
}

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  mousePos.x = (e.clientX - rect.left) * scaleX;
  mousePos.y = (e.clientY - rect.top) * scaleY;
  mousePos.onCanvas = true;
});

canvas.addEventListener('mouseleave', () => {
  mousePos.onCanvas = false;
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousedown', e => {
  if (!gameState || !myId) return;
  const me = gameState.players.find(p => p.id === myId);
  if (!me || !me.item) return;

  const canPlace = isDebugRoom || gameState.state === 'BUILDING';
  if (!canPlace) return;

  if (e.button === 2) {
    currentItemRotation = (currentItemRotation + Math.PI / 6) % (Math.PI * 2);
    return;
  }

  if (e.button === 0) {
    if (me.item === 'bomb') {
      ws.send(JSON.stringify({
        type: 'USE_BOMB',
        x: mousePos.x,
        y: mousePos.y
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'PLACE_TRAP',
        x: mousePos.x,
        y: mousePos.y,
        angle: currentItemRotation,
        trapType: me.item
      }));
    }
  }
});

document.querySelectorAll('.dbg-btn').forEach(btn => {
  btn.onclick = () => {
    const itemType = btn.getAttribute('data-item');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'GIVE_ITEM', itemType }));
    }
  };
});

function showAlert(text, ms = 3000) {
  alertBanner.innerText = text;
  alertBanner.style.display = 'block';
  setTimeout(() => { alertBanner.style.display = 'none'; }, ms);
}

function connectSocket(onOpenCallback) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    if (onOpenCallback) onOpenCallback();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'ROOM_JOINED') {
      currentRoom = data.code;
      myId = data.playerId;
      isDebugRoom = data.isDebug;
      isGameOver = false;
      localStorage.setItem('race_session', JSON.stringify({ code: data.code, token: data.token }));

      lobbyScreen.style.display = 'none';
      gameUi.style.display = 'flex';
      document.getElementById('hud-room').innerText = currentRoom;

      if (isDebugRoom) {
        debugToolbar.style.display = 'flex';
        showAlert('Вы в ДЕБАГ КОМНАТЕ.', 4000);
      } else {
        debugToolbar.style.display = 'none';
        showAlert(`Комната ${currentRoom} создана. Нажмите СТАРТ`, 4000);
      }
    }

    if (data.type === 'STATE_UPDATE') {
      gameState = data;
      isDebugRoom = data.isDebug;

      hudRound.innerText = `${gameState.currentRound}/${gameState.maxRounds}`;
      hudRoundTimer.innerText = `Время: ${gameState.roundTimer}с`;

      const sortedPlayers = [...gameState.players].sort((a, b) => b.score - a.score);
      playersTableBody.innerHTML = sortedPlayers.map(p => {
        let status = 'В ПУТИ';
        if (p.eliminated) status = 'УПАЛ';
        else if (p.finished) status = 'ФИНИШ';

        return `
          <tr style="color: ${p.id === myId ? '#f1c40f' : '#fff'}; font-weight: ${p.id === myId ? 'bold' : 'normal'}">
            <td>
              <span class="player-color-dot" style="background: ${p.color};"></span>
              ${p.name}
            </td>
            <td style="color: ${status === 'УПАЛ' ? '#e74c3c' : (status === 'ФИНИШ' ? '#2ecc71' : '#fff')}">${status}</td>
            <td>${p.score}</td>
          </tr>
        `;
      }).join('');

      if (gameState.state === 'RACING') {
        btnStartGame.style.display = 'none';
        btnVoteReady.style.display = 'none';
        hudPhaseTimer.style.display = 'none';
        hudRoundTimer.style.display = 'inline-block';
        lapModal.style.display = 'none';
        canvas.style.cursor = isDebugRoom ? 'crosshair' : 'default';
      } else if (gameState.state === 'LOBBY') {
        btnStartGame.style.display = 'inline-block';
        btnVoteReady.style.display = 'none';
        hudPhaseTimer.style.display = 'none';
        hudRoundTimer.style.display = 'none';
        lapModal.style.display = 'none';
        canvas.style.cursor = 'default';
      } else if (gameState.state === 'BUILDING') {
        btnStartGame.style.display = 'none';
        btnVoteReady.style.display = 'inline-block';
        btnVoteReady.innerText = `ГОТОВ (${gameState.readyVotes}/${gameState.activePlayers})`;
        hudPhaseTimer.style.display = 'inline-block';
        hudPhaseTimer.innerText = `Стройка: ${gameState.buildingTimer}с`;
        hudRoundTimer.style.display = 'none';
        canvas.style.cursor = 'crosshair';
        modalLapTimer.innerText = `До конца фазы: ${gameState.buildingTimer}с`;
      }

      render();
    }

    if (data.type === 'HOLE_FALL') {
      showAlert(`💀 ${data.playerName} упал в яму и выбыл! (-50)`, 3000);
    }

    if (data.type === 'ABYSS_FALL') {
      showAlert(`💀 ${data.playerName} сорвался в бездну и выбыл! (-50)`, 3000);
    }

    if (data.type === 'PLAYER_FINISHED') {
      showAlert(`🏁 ${data.name} доехал до финиша! (${data.place}-е место)`, 3000);
    }

    if (data.type === 'CONFLICT_REJECTED') {
      showAlert(`ОШИБКА: ${data.reason}`, 3000);
    }

    if (data.type === 'ROUND_FINISHED') {
      btnVoteReady.classList.remove('voted');
      lapModal.style.display = 'flex';
      modalLapTitle.innerText = `ИТОГИ РАУНДА ${data.currentRound}/${data.maxRounds}`;
      btnModalAction.innerText = 'ПЕРЕЙТИ К СТРОЙКЕ';
      gameOverDownloads.style.display = 'none';
      isGameOver = false;

      modalTableHeaders.innerHTML = `<th>ИГРОК</th><th>ИТОГ</th><th>ЗА РАУНД</th><th>ВСЕГО</th>`;
      if (data.roundResults) {
        modalTableBody.innerHTML = data.roundResults.map(r => `
          <tr>
            <td>
              <span class="player-color-dot" style="background: ${r.color};"></span>
              ${r.name}
            </td>
            <td style="color: ${r.finished ? '#2ecc71' : '#e74c3c'}">${r.finished ? 'ДОЕХАЛ' : 'УПАЛ'}</td>
            <td style="color: ${r.earned > 0 ? '#2ecc71' : (r.earned < 0 ? '#e74c3c' : '#888')};">
              ${r.earned > 0 ? '+' + r.earned : r.earned}
            </td>
            <td>${r.total}</td>
          </tr>
        `).join('');
      }
    }

    if (data.type === 'GAME_OVER') {
      isGameOver = true;
      lastMatchTraps = data.traps || [];
      lapModal.style.display = 'flex';
      modalLapTitle.innerText = `ИГРА ОКОНЧЕНА! ПОБЕДИТЕЛЬ: ${data.winner}`;
      modalLapTimer.innerText = 'ИТОГОВЫЙ СЧЕТ ВСЕХ РАУНДОВ';
      btnModalAction.innerText = 'В ГЛАВНОЕ МЕНЮ';
      gameOverDownloads.style.display = 'flex';

      modalTableHeaders.innerHTML = `<th>МЕСТО</th><th>ИГРОК</th><th>ВСЕГО ОЧКОВ</th>`;
      if (data.finalScores) {
        modalTableBody.innerHTML = data.finalScores.map(r => `
          <tr style="font-weight: ${r.place === 1 ? 'bold' : 'normal'}; color: ${r.place === 1 ? '#f1c40f' : '#fff'}">
            <td>${r.place}</td>
            <td>
              <span class="player-color-dot" style="background: ${r.color};"></span>
              ${r.name}
            </td>
            <td>${r.score}</td>
          </tr>
        `).join('');
      }
    }

    if (data.type === 'ERROR') {
      document.getElementById('lobby-status').innerText = data.message;
    }
  };

  ws.onclose = () => {
    showAlert('Связь потеряна. Переподключение...', 5000);
    setTimeout(() => {
      const saved = localStorage.getItem('race_session');
      if (saved) {
        const { code, token } = JSON.parse(saved);
        connectSocket(() => {
          ws.send(JSON.stringify({ type: 'RECONNECT', code, token }));
        });
      }
    }, 2000);
  };
}


function loadRecordsAndHistory() {
  fetch('/api/records').then(r => r.json()).then(data => {
    const list = document.getElementById('records-list');
    list.innerHTML = data.leaderboard.map(p => `<li>${p.name}: ${p.score} очков (${p.wins} побед)</li>`).join('') || '<li>Пока нет рекордов</li>';

    if (data.history && data.history.length > 0) {
      historyList.innerHTML = data.history.map(m => `
        <div class="history-item" data-id="${m.id}">
          <div class="history-header">
            <span>Матч: ${m.date} (${m.rounds} раундов)</span>
            <span style="color: #2ecc71;">Победитель: ${m.winner}</span>
          </div>
          <div class="history-body">
            <div class="history-players">
              ${m.players.map(p => `
                <div>
                  <span class="player-color-dot" style="background: ${p.color};"></span>
                  <strong>${p.name}:</strong> ${p.score} очков
                </div>
              `).join('')}
            </div>
            <div class="history-preview-box">
              <canvas class="history-preview-canvas" width="200" height="112" data-id="${m.id}"></canvas>
              <div class="history-btns">
                <button class="btn-mini btn-dl-png" data-id="${m.id}">PNG</button>
                <button class="btn-mini btn-dl-svg" data-id="${m.id}">SVG</button>
              </div>
            </div>
          </div>
        </div>
      `).join('');

      data.history.forEach(m => {
        const pCanvas = document.querySelector(`.history-preview-canvas[data-id="${m.id}"]`);
        if (pCanvas) {
          const pCtx = pCanvas.getContext('2d');
          pCtx.setTransform(1, 0, 0, 1, 0, 0);
          pCtx.scale(200 / 1000, 112 / 560);
          drawMapToContext(pCtx, m.traps);
        }
      });

      document.querySelectorAll('.btn-dl-png').forEach(b => {
        b.onclick = () => {
          const id = b.getAttribute('data-id');
          const m = data.history.find(h => h.id === id);
          if (m) downloadMatchPNG(m.traps, `${m.id}.png`);
        };
      });

      document.querySelectorAll('.btn-dl-svg').forEach(b => {
        b.onclick = () => {
          const id = b.getAttribute('data-id');
          const m = data.history.find(h => h.id === id);
          if (m) downloadMatchSVG(m.traps, `${m.id}.svg`);
        };
      });

    } else {
      historyList.innerHTML = '<div style="color: #888; padding: 20px;">История пуста. Сыграйте хотя бы один матч!</div>';
    }
  });
}

loadRecordsAndHistory();

btnOpenHistory.onclick = () => {
  loadRecordsAndHistory();
  historyModal.style.display = 'flex';
};

btnCloseHistory.onclick = () => {
  historyModal.style.display = 'none';
};

document.getElementById('btn-create').onclick = () => {
  const name = document.getElementById('player-name').value;
  const color = document.getElementById('player-color').value;
  const rounds = document.getElementById('room-rounds').value;
  connectSocket(() => ws.send(JSON.stringify({ type: 'CREATE_ROOM', name, color, rounds })));
};

document.getElementById('btn-debug').onclick = () => {
  const name = document.getElementById('player-name').value;
  const color = document.getElementById('player-color').value;
  connectSocket(() => ws.send(JSON.stringify({ type: 'JOIN_DEBUG_ROOM', name, color })));
};

document.getElementById('btn-join').onclick = () => {
  const name = document.getElementById('player-name').value;
  const color = document.getElementById('player-color').value;
  const code = document.getElementById('room-code-input').value.toUpperCase().trim();
  if (!code) return showAlert('Введите код комнаты!');
  connectSocket(() => ws.send(JSON.stringify({ type: 'JOIN_ROOM', code, name, color })));
};


function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (isDebugRoom) {
    
    ctx.fillStyle = '#1e222b';
    ctx.fillRect(220, 20, 560, 520);
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 10;
    ctx.strokeRect(220, 20, 560, 520);

    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(500, 280, 75, 0, Math.PI * 2);
    ctx.fill();

    
    drawTraps(ctx, gameState.traps);
  } else {
    
    drawMapToContext(ctx, gameState.traps);

    
    gameState.pickups.forEach(p => {
      ctx.fillStyle = '#f39c12';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('?', p.x, p.y + 4);
    });
  }

  
  const me = gameState.players.find(p => p.id === myId);
  const isBombArmed = (gameState.state === 'BUILDING' || isDebugRoom) && me && me.item === 'bomb' && mousePos.onCanvas;
  const BOMB_RADIUS = 85;

  if (isBombArmed) {
    gameState.traps.forEach(t => {
      if (Math.hypot(t.x - mousePos.x, t.y - mousePos.y) <= BOMB_RADIUS) {
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-20, -20, 40, 40);
        ctx.restore();
      }
    });
  }

  
  if ((gameState.state === 'BUILDING' || isDebugRoom) && me && me.item && mousePos.onCanvas) {
    ctx.save();
    ctx.translate(mousePos.x, mousePos.y);

    if (me.item === 'bomb') {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(231, 76, 60, 0.15)';
      ctx.beginPath();
      ctx.arc(0, 0, BOMB_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.65;
      ctx.rotate(currentItemRotation);

      if (me.item === 'oil') {
        ctx.fillStyle = '#111317';
        ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.fill();
      } else if (me.item === 'bumper') {
        ctx.fillStyle = '#1e232a';
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      } else if (me.item === 'thin_wall') {
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(-25, -3, 50, 6);
      } else if (me.item === 'turbine') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(130, -26); ctx.lineTo(130, 26);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#0284c7';
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
      } else if (me.item === 'ice') {
        ctx.fillStyle = '#81cfe0';
        ctx.fillRect(-30, -30, 60, 60);
      } else if (me.item === 'boost') {
        ctx.fillStyle = '#112217';
        ctx.fillRect(-16, -14, 32, 28);
        ctx.strokeStyle = '#27ae60';
        ctx.lineWidth = 3;
        [-8, 0, 8].forEach(offsetX => {
          ctx.beginPath();
          ctx.moveTo(offsetX - 4, -9);
          ctx.lineTo(offsetX + 3, 0);
          ctx.lineTo(offsetX - 4, 9);
          ctx.stroke();
        });
      }
    }
    ctx.restore();
  }

  
  gameState.players.forEach(p => {
    if (p.eliminated) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    ctx.globalAlpha = (p.disconnected || p.finished) ? 0.4 : 1.0;

    ctx.fillStyle = p.color || ((p.id === myId) ? '#e74c3c' : '#2980b9');
    ctx.beginPath();
    ctx.roundRect(-8, -4, 16, 8, 4);
    ctx.fill();

    ctx.strokeStyle = (p.id === myId) ? '#f1c40f' : 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = (p.id === myId) ? 1.5 : 1;
    ctx.stroke();

    ctx.fillStyle = '#000';
    ctx.fillRect(-6, -5, 4, 1.5);
    ctx.fillRect(2, -5, 4, 1.5);
    ctx.fillRect(-6, 3.5, 4, 1.5);
    ctx.fillRect(2, 3.5, 4, 1.5);

    ctx.fillStyle = '#ecf0f1';
    ctx.fillRect(0, -2.5, 3, 5);

    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(7, -3, 1.5, 1.5);
    ctx.fillRect(7, 1.5, 1.5, 1.5);

    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - 10);

    if (p.id === myId) {
      itemIcon.innerText = p.item ? ITEM_NAMES[p.item] : 'НЕТ';
    }
  });
}