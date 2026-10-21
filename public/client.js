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

let ws = null;
let myId = null;
let currentRoom = null;
let gameState = null;
let isDebugRoom = false;
let isGameOver = false;

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
  lobbyScreen.style.display = 'flex';
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
            <td>${p.name}</td>
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
      isGameOver = false;

      modalTableHeaders.innerHTML = `<th>ИГРОК</th><th>ИТОГ</th><th>ЗА РАУНД</th><th>ВСЕГО</th>`;
      if (data.roundResults) {
        modalTableBody.innerHTML = data.roundResults.map(r => `
          <tr>
            <td>${r.name}</td>
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
      lapModal.style.display = 'flex';
      modalLapTitle.innerText = `ИГРА ОКОНЧЕНА! ПОБЕДИТЕЛЬ: ${data.winner}`;
      modalLapTimer.innerText = 'ИТОГОВЫЙ СЧЕТ ВСЕХ РАУНДОВ';
      btnModalAction.innerText = 'В ГЛАВНОЕ МЕНЮ';

      modalTableHeaders.innerHTML = `<th>МЕСТО</th><th>ИГРОК</th><th>ВСЕГО ОЧКОВ</th>`;
      if (data.finalScores) {
        modalTableBody.innerHTML = data.finalScores.map(r => `
          <tr style="font-weight: ${r.place === 1 ? 'bold' : 'normal'}; color: ${r.place === 1 ? '#f1c40f' : '#fff'}">
            <td>${r.place}</td>
            <td>${r.name}</td>
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

fetch('/api/records').then(r => r.json()).then(data => {
  const list = document.getElementById('records-list');
  list.innerHTML = data.leaderboard.map(p => `<li>${p.name}: ${p.score} очков (${p.wins} побед)</li>`).join('') || '<li>Пока нет рекордов</li>';
});

document.getElementById('btn-create').onclick = () => {
  const name = document.getElementById('player-name').value;
  const rounds = document.getElementById('room-rounds').value;
  connectSocket(() => ws.send(JSON.stringify({ type: 'CREATE_ROOM', name, rounds })));
};

document.getElementById('btn-debug').onclick = () => {
  const name = document.getElementById('player-name').value;
  connectSocket(() => ws.send(JSON.stringify({ type: 'JOIN_DEBUG_ROOM', name })));
};

document.getElementById('btn-join').onclick = () => {
  const name = document.getElementById('player-name').value;
  const code = document.getElementById('room-code-input').value.toUpperCase().trim();
  if (!code) return showAlert('Введите код комнаты!');
  connectSocket(() => ws.send(JSON.stringify({ type: 'JOIN_ROOM', code, name })));
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
  } else {
    
    function traceHourglass(targetCtx) {
      targetCtx.beginPath();
      
      targetCtx.moveTo(20, 20);
      targetCtx.lineTo(160, 20);
      for (let x = 160; x <= 840; x += 10) {
        const b = getPlatformBounds(x);
        targetCtx.lineTo(x, b.top);
      }
      targetCtx.lineTo(980, 20);
      targetCtx.lineTo(980, 540);
      targetCtx.lineTo(840, 540);
      for (let x = 840; x >= 160; x -= 10) {
        const b = getPlatformBounds(x);
        targetCtx.lineTo(x, b.bottom);
      }
      targetCtx.lineTo(20, 540);
      targetCtx.closePath();
    }

    
    ctx.save();
    traceHourglass(ctx);
    ctx.fillStyle = '#1e222b';
    ctx.fill();
    ctx.clip(); 

    
    ctx.fillStyle = '#182b20';
    ctx.fillRect(20, 20, 140, 520);
    ctx.strokeStyle = '#27ae60';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(160, 20); ctx.lineTo(160, 540);
    ctx.stroke();

    
    ctx.fillStyle = '#261e30';
    ctx.fillRect(840, 20, 140, 520);

    
    ctx.fillStyle = '#ffffff';
    for (let y = 20; y < 540; y += 20) {
      ctx.fillRect(835, y, 10, 10);
      ctx.fillRect(845, y + 10, 10, 10);
    }
    ctx.restore();

    
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.45)';
    ctx.lineWidth = 2.5;
    traceHourglass(ctx);
    ctx.stroke();

    
    MAP_HOLES.forEach(h => {
      ctx.fillStyle = '#0b0d10';
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    });

    
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

  gameState.traps.forEach(t => {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.angle || 0);

    if (t.type === 'oil') {
      ctx.fillStyle = '#111317';
      ctx.beginPath();
      ctx.arc(0, 0, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(70, 90, 110, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (t.type === 'bumper') {
      ctx.fillStyle = '#1e232a';
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (t.type === 'thin_wall') {
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(-25, -3, 50, 6);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.strokeRect(-25, -3, 50, 6);
    } else if (t.type === 'turbine') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(130, -26); ctx.lineTo(130, 26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0284c7';
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(16, 0); ctx.lineTo(0, 6);
      ctx.fill();
    } else if (t.type === 'ice') {
      ctx.fillStyle = 'rgba(129, 207, 224, 0.75)';
      ctx.fillRect(-30, -30, 60, 60);
    } else if (t.type === 'boost') {
      ctx.fillStyle = '#112217';
      ctx.fillRect(-16, -14, 32, 28);
      ctx.strokeStyle = '#27ae60';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-16, -14, 32, 28);
      ctx.strokeStyle = '#2ecc71';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'miter';
      [-8, 0, 8].forEach(offsetX => {
        ctx.beginPath();
        ctx.moveTo(offsetX - 4, -9);
        ctx.lineTo(offsetX + 3, 0);
        ctx.lineTo(offsetX - 4, 9);
        ctx.stroke();
      });
    }

    if (isBombArmed && Math.hypot(t.x - mousePos.x, t.y - mousePos.y) <= BOMB_RADIUS) {
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-20, -20, 40, 40);
    }

    ctx.restore();
  });

  
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
        ctx.strokeStyle = '#2ecc71';
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

    ctx.fillStyle = (p.id === myId) ? '#e74c3c' : '#2980b9';
    ctx.beginPath();
    ctx.roundRect(-8, -4, 16, 8, 4);
    ctx.fill();

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