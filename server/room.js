import { Storage } from './storage.js';

export const MAP_W = 1000;
export const MAP_H = 560;
export const CAR_RADIUS = 7;


export function getPlatformBounds(x) {
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

export function isOffPlatform(x, y) {
  const bounds = getPlatformBounds(x);
  if (!bounds) return true;
  return y < bounds.top || y > bounds.bottom;
}


export const MAP_HOLES = [
  { x: 330, y: 170, r: 35 },
  { x: 330, y: 390, r: 35 },
  { x: 500, y: 280, r: 34 }, 
  { x: 670, y: 170, r: 35 },
  { x: 670, y: 390, r: 35 }
];

export class Room {
  constructor(code, isDebug = false, maxRounds = 5) {
    this.code = code;
    this.isDebug = isDebug;
    this.players = new Map();
    this.traps = new Map();
    this.pickups = [];
    this.readyVotes = new Set();
    this.state = isDebug ? 'RACING' : 'LOBBY';
    this.currentRound = 1;
    this.maxRounds = maxRounds;
    this.roundTimer = 60;
    this.buildingTimer = 0;
    this.finishers = [];
    this.roundResults = [];
    this.tickInterval = null;

    if (this.isDebug) {
      this.initDebugRoom();
    } else {
      this.initPickups();
    }
    this.startLoop();
  }

  initPickups() {
    this.pickups = [
      { id: 1, x: 260, y: 280, active: true, respawnTimer: 0 },
      { id: 2, x: 420, y: 180, active: true, respawnTimer: 0 },
      { id: 3, x: 420, y: 380, active: true, respawnTimer: 0 },
      { id: 4, x: 580, y: 180, active: true, respawnTimer: 0 },
      { id: 5, x: 580, y: 380, active: true, respawnTimer: 0 },
      { id: 6, x: 740, y: 280, active: true, respawnTimer: 0 }
    ];
  }

  initDebugRoom() {
    const debugTraps = [
      { type: 'bumper', x: 500, y: 160, angle: 0 },
      { type: 'thin_wall', x: 620, y: 200, angle: Math.PI / 4 },
      { type: 'turbine', x: 650, y: 280, angle: 0 },
      { type: 'ice', x: 610, y: 360, angle: 0 },
      { type: 'oil', x: 500, y: 410, angle: 0 },
      { type: 'boost', x: 360, y: 280, angle: 0 },
      { type: 'bomb', x: 390, y: 200, angle: 0 }
    ];

    debugTraps.forEach((t, i) => {
      this.traps.set(`debug_${i}`, {
        id: `debug_${i}`,
        ownerId: 'system',
        type: t.type,
        x: t.x,
        y: t.y,
        angle: t.angle
      });
    });
  }

  getSpawns() {
    if (this.isDebug) {
      return [
        { x: 300, y: 160, angle: 0 },
        { x: 300, y: 210, angle: 0 },
        { x: 300, y: 350, angle: 0 },
        { x: 300, y: 400, angle: 0 }
      ];
    }
    return [
      { x: 65, y: 150, angle: 0 },
      { x: 65, y: 230, angle: 0 },
      { x: 65, y: 310, angle: 0 },
      { x: 65, y: 390, angle: 0 }
    ];
  }

  addPlayer(id, name, color, token, ws) {
    if (this.players.size >= 4) return null;
    const spawns = this.getSpawns();
    const spawn = spawns[this.players.size % 4];

    const player = {
      id,
      name,
      color: color || '#e74c3c', 
      token,
      ws,
      x: spawn.x,
      y: spawn.y,
      spawnX: spawn.x,
      spawnY: spawn.y,
      angle: spawn.angle,
      speedX: 0,
      speedY: 0,
      angularVelocity: 0,
      inputs: { w: false, a: false, s: false, d: false, space: false },
      item: 'bumper',
      score: 0,
      roundEarned: 0,
      boostCooldown: 0,
      finished: false,
      eliminated: false,
      disconnected: false
    };

    this.players.set(id, player);
    return player;
  }

  reconnectPlayer(token, ws) {
    for (const p of this.players.values()) {
      if (p.token === token) {
        p.ws = ws;
        p.disconnected = false;
        return p;
      }
    }
    return null;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.readyVotes.delete(id);
  }

  voteReady(playerId) {
    if (this.state !== 'BUILDING') return;
    this.readyVotes.add(playerId);
    const activeCount = Array.from(this.players.values()).filter(p => !p.disconnected).length;
    if (this.readyVotes.size >= activeCount) {
      this.buildingTimer = 0;
    }
    this.broadcastState();
  }

  giveItem(playerId, itemType) {
    const player = this.players.get(playerId);
    if (player) {
      player.item = itemType;
      this.broadcastState();
    }
  }

  placeTrap(playerId, targetX, targetY, angle, trapType) {
    const player = this.players.get(playerId);
    if (!player || player.item !== trapType) return;

    if (!this.isDebug) {
      if (isOffPlatform(targetX, targetY) || targetX < 160 || targetX > 840) {
        player.ws.send(JSON.stringify({ type: 'CONFLICT_REJECTED', reason: 'Ставьте предмет на полотне песочных часов!' }));
        return;
      }
      for (const h of MAP_HOLES) {
        if (Math.hypot(targetX - h.x, targetY - h.y) < h.r) {
          player.ws.send(JSON.stringify({ type: 'CONFLICT_REJECTED', reason: 'Нельзя ставить предмет в яму!' }));
          return;
        }
      }
    }

    const trapId = `trap_${Date.now()}_${Math.random()}`;
    const trap = {
      id: trapId,
      ownerId: playerId,
      type: trapType,
      x: targetX,
      y: targetY,
      angle: angle || 0
    };

    this.traps.set(trapId, trap);
    if (!this.isDebug) player.item = null;

    this.broadcast({ type: 'TRAP_PLACED', trap });
  }

  useBomb(playerId, targetX, targetY) {
    const player = this.players.get(playerId);
    if (!player || player.item !== 'bomb') return;

    const BOMB_RADIUS = 85;
    const removedTrapIds = [];

    for (const [id, trap] of this.traps.entries()) {
      if (Math.hypot(trap.x - targetX, trap.y - targetY) <= BOMB_RADIUS) {
        removedTrapIds.push(id);
        this.traps.delete(id);
      }
    }

    if (!this.isDebug) player.item = null;
    this.broadcast({
      type: 'BOMB_EXPLODED',
      x: targetX,
      y: targetY,
      radius: BOMB_RADIUS,
      removedTrapIds
    });
  }

  startLoop() {
    this.tickInterval = setInterval(() => this.tick(), 1000 / 30);
  }

  stop() {
    clearInterval(this.tickInterval);
  }

  tick() {
    if (this.state === 'BUILDING') {
      this.buildingTimer -= 1 / 30;
      if (this.buildingTimer <= 0) {
        this.currentRound++;
        if (this.currentRound > this.maxRounds) {
          this.endGame();
        } else {
          this.startNewRound();
        }
      }
      this.broadcastState();
      return;
    }

    if (this.state !== 'RACING') {
      this.broadcastState();
      return;
    }

    if (!this.isDebug) {
      this.roundTimer -= 1 / 30;
      if (this.roundTimer <= 0) {
        this.finishRound();
        return;
      }
    }

    this.pickups.forEach(p => {
      if (!p.active) {
        p.respawnTimer -= 1 / 30;
        if (p.respawnTimer <= 0) p.active = true;
      }
    });

    const activePlayers = Array.from(this.players.values()).filter(p => !p.disconnected);

    for (const p of activePlayers) {
      if (p.finished || p.eliminated) continue;

      if (p.boostCooldown > 0) p.boostCooldown--;

      let steerInput = 0;
      if (p.inputs.a) steerInput -= 1;
      if (p.inputs.d) steerInput += 1;

      const spd = Math.hypot(p.speedX, p.speedY);
      if (spd > 0.1) {
        const steerPower = p.inputs.space ? 0.10 : 0.038;
        p.angularVelocity += steerInput * steerPower;
      }
      p.angularVelocity *= 0.82;
      p.angle += p.angularVelocity;

      let currentGrip = p.inputs.space ? 0.12 : 0.82;
      let currentFriction = p.inputs.space ? 0.985 : 0.98;
      let accelMultiplier = 1.0;

      
      if (!this.isDebug) {
        for (const h of MAP_HOLES) {
          if (Math.hypot(p.x - h.x, p.y - h.y) < h.r - 2) {
            p.eliminated = true;
            p.score -= 50;
            p.roundEarned -= 50;
            p.speedX = 0;
            p.speedY = 0;

            this.broadcast({
              type: 'HOLE_FALL',
              playerName: p.name,
              score: p.score
            });
            break;
          }
        }
      }

      
      if (!this.isDebug && !p.eliminated) {
        if (isOffPlatform(p.x, p.y)) {
          p.eliminated = true;
          p.score -= 50;
          p.roundEarned -= 50;
          p.speedX = 0;
          p.speedY = 0;

          this.broadcast({
            type: 'ABYSS_FALL',
            playerName: p.name,
            score: p.score
          });
          continue;
        }
      }

      if (p.eliminated) continue;

      
      for (const trap of this.traps.values()) {
        const dist = Math.hypot(p.x - trap.x, p.y - trap.y);

        if (trap.type === 'oil' && dist < 28) {
          currentGrip = 0.05;
          currentFriction = 0.86;
          accelMultiplier = 0.20;
        }

        if (trap.type === 'bumper' && dist < 18) {
          const nx = (p.x - trap.x) / (dist || 1);
          const ny = (p.y - trap.y) / (dist || 1);
          p.x = trap.x + nx * 19;
          p.y = trap.y + ny * 19;
          p.speedX = nx * 5.4;
          p.speedY = ny * 5.4;
        }

        if (trap.type === 'thin_wall') {
          const cos = Math.cos(trap.angle);
          const sin = Math.sin(trap.angle);
          const ax = trap.x - cos * 25, ay = trap.y - sin * 25;
          const bx = trap.x + cos * 25, by = trap.y + sin * 25;
          const dx = bx - ax, dy = by - ay;
          const lenSq = dx * dx + dy * dy;
          let t = ((p.x - ax) * dx + (p.y - ay) * dy) / (lenSq || 1);
          t = Math.max(0, Math.min(1, t));
          const qx = ax + t * dx, qy = ay + t * dy;
          const dWall = Math.hypot(p.x - qx, p.y - qy);

          if (dWall < CAR_RADIUS + 3) {
            const nx = (p.x - qx) / (dWall || 1);
            const ny = (p.y - qy) / (dWall || 1);
            p.x = qx + nx * (CAR_RADIUS + 4);
            p.y = qy + ny * (CAR_RADIUS + 4);
            const dot = p.speedX * nx + p.speedY * ny;
            if (dot < 0) {
              p.speedX = (p.speedX - dot * nx) * 0.85 - dot * nx * 0.3;
              p.speedY = (p.speedY - dot * ny) * 0.85 - dot * ny * 0.3;
            }
          }
        }

        if (trap.type === 'turbine') {
          const dx = p.x - trap.x, dy = p.y - trap.y;
          const cos = Math.cos(trap.angle), sin = Math.sin(trap.angle);
          const forward = dx * cos + dy * sin;
          const lateral = -dx * sin + dy * cos;

          if (forward > 0 && forward < 130 && Math.abs(lateral) < 26) {
            p.speedX += cos * 0.28;
            p.speedY += sin * 0.28;
          }
        }

        if (trap.type === 'ice') {
          if (Math.abs(p.x - trap.x) < 30 && Math.abs(p.y - trap.y) < 30) {
            currentGrip = 0.01;
            currentFriction = 0.999;
          }
        }

        
        if (trap.type === 'boost' && dist < 22) {
          if (p.boostCooldown <= 0) {
            const boostAngle = trap.angle || 0;
            p.speedX += Math.cos(boostAngle) * 5.8;
            p.speedY += Math.sin(boostAngle) * 5.8;
            p.boostCooldown = 18;
          }
        }
      }

      
      const baseAccel = 0.16 * accelMultiplier;
      if (p.inputs.w) {
        p.speedX += Math.cos(p.angle) * baseAccel;
        p.speedY += Math.sin(p.angle) * baseAccel;
      }
      if (p.inputs.s) {
        p.speedX -= Math.cos(p.angle) * (baseAccel * 0.5);
        p.speedY -= Math.sin(p.angle) * (baseAccel * 0.5);
      }

      const forwardX = Math.cos(p.angle), forwardY = Math.sin(p.angle);
      const rightX = -Math.sin(p.angle), rightY = Math.cos(p.angle);
      const forwardSpeed = p.speedX * forwardX + p.speedY * forwardY;
      const lateralSpeed = p.speedX * rightX + p.speedY * rightY;

      p.speedX = (forwardX * forwardSpeed + rightX * (lateralSpeed * (1 - currentGrip))) * currentFriction;
      p.speedY = (forwardY * forwardSpeed + rightY * (lateralSpeed * (1 - currentGrip))) * currentFriction;

      const currentSpeed = Math.hypot(p.speedX, p.speedY);
      const maxAllowed = (p.boostCooldown && p.boostCooldown > 8) ? 9.0 : 5.6;
      if (currentSpeed > maxAllowed) {
        const scale = maxAllowed / currentSpeed;
        p.speedX *= scale;
        p.speedY *= scale;
      }

      p.x += p.speedX;
      p.y += p.speedY;

      
      if (this.isDebug) {
        const minX = 220 + CAR_RADIUS, maxX = 780 - CAR_RADIUS;
        const minY = 20 + CAR_RADIUS, maxY = 540 - CAR_RADIUS;
        if (p.x < minX) { p.x = minX; p.speedX = Math.abs(p.speedX) * 0.5; }
        if (p.x > maxX) { p.x = maxX; p.speedX = -Math.abs(p.speedX) * 0.5; }
        if (p.y < minY) { p.y = minY; p.speedY = Math.abs(p.speedY) * 0.5; }
        if (p.y > maxY) { p.y = maxY; p.speedY = -Math.abs(p.speedY) * 0.5; }

        const dCenter = Math.hypot(p.x - 500, p.y - 280);
        if (dCenter < 75 + CAR_RADIUS) {
          const nx = (p.x - 500) / (dCenter || 1);
          const ny = (p.y - 280) / (dCenter || 1);
          p.x = 500 + nx * (75 + CAR_RADIUS);
          p.y = 280 + ny * (75 + CAR_RADIUS);
        }
      }

      
      if (!this.isDebug && p.x >= 840) {
        p.finished = true;
        p.speedX = 0;
        p.speedY = 0;
        this.finishers.push(p);

        this.broadcast({
          type: 'PLAYER_FINISHED',
          name: p.name,
          place: this.finishers.length
        });

        if (this.finishers.length === 1 && activePlayers.length > 1) {
          this.roundTimer = Math.min(this.roundTimer, 12);
        }
      }

      
      this.pickups.forEach(pick => {
        if (pick.active && Math.hypot(p.x - pick.x, p.y - pick.y) < 22) {
          pick.active = false;
          pick.respawnTimer = 9;
          const available = ['bumper', 'thin_wall', 'turbine', 'ice', 'oil', 'boost', 'bomb'];
          p.item = available[Math.floor(Math.random() * available.length)];
        }
      });
    }

    if (!this.isDebug) {
      const remaining = activePlayers.filter(p => !p.finished && !p.eliminated).length;
      if (remaining === 0 && activePlayers.length > 0) {
        this.finishRound();
        return;
      }
    }

    this.broadcastState();
  }

  finishRound() {
    const activePlayers = Array.from(this.players.values()).filter(p => !p.disconnected);
    const totalCount = activePlayers.length;
    const finishCount = this.finishers.length;

    if (finishCount === totalCount && totalCount > 1) {
      
    } else if (finishCount > 0) {
      this.finishers[0].score += 100;
      this.finishers[0].roundEarned += 100;

      for (let i = 1; i < this.finishers.length; i++) {
        this.finishers[i].score += 50;
        this.finishers[i].roundEarned += 50;
      }
    }

    this.roundResults = activePlayers
      .sort((a, b) => b.score - a.score)
      .map(pl => ({
        name: pl.name,
        color: pl.color,
        finished: pl.finished,
        eliminated: pl.eliminated,
        earned: pl.roundEarned,
        total: pl.score
      }));

    if (this.currentRound >= this.maxRounds) {
      this.endGame();
      return;
    }

    for (const p of this.players.values()) {
      if (!p.item) {
        const available = ['bumper', 'thin_wall', 'turbine', 'ice', 'oil', 'boost', 'bomb'];
        p.item = available[Math.floor(Math.random() * available.length)];
      }
    }

    this.state = 'BUILDING';
    this.buildingTimer = 30;
    this.readyVotes.clear();

    this.broadcast({
      type: 'ROUND_FINISHED',
      roundResults: this.roundResults,
      currentRound: this.currentRound,
      maxRounds: this.maxRounds
    });
  }

  startNewRound() {
    this.state = 'RACING';
    this.roundTimer = 60;
    this.finishers = [];
    this.readyVotes.clear();

    const spawns = this.getSpawns();
    let idx = 0;
    for (const p of this.players.values()) {
      const sp = spawns[idx % 4];
      p.x = sp.x;
      p.y = sp.y;
      p.spawnX = sp.x;
      p.spawnY = sp.y;
      p.angle = sp.angle;
      p.speedX = 0;
      p.speedY = 0;
      p.angularVelocity = 0;
      p.finished = false;
      p.eliminated = false;
      p.roundEarned = 0;
      idx++;
    }

    this.broadcast({ type: 'ROUND_START', currentRound: this.currentRound });
  }

  endGame() {
    this.state = 'FINISHED';
    const sorted = Array.from(this.players.values()).sort((a, b) => b.score - a.score);
    const best = sorted[0];
    if (best) Storage.saveRaceResult(best.name, best.score);

    this.broadcast({
      type: 'GAME_OVER',
      winner: best?.name,
      roundResults: this.roundResults,
      finalScores: sorted.map((p, i) => ({ place: i + 1, name: p.name, color: p.color, score: p.score }))
    });
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (!p.disconnected && p.ws.readyState === 1) {
        p.ws.send(data);
      }
    }
  }

  broadcastState() {
    const activeCount = Array.from(this.players.values()).filter(p => !p.disconnected).length;
    this.broadcast({
      type: 'STATE_UPDATE',
      isDebug: this.isDebug,
      state: this.state,
      currentRound: this.currentRound,
      maxRounds: this.maxRounds,
      roundTimer: Math.ceil(this.roundTimer),
      buildingTimer: Math.ceil(this.buildingTimer),
      readyVotes: this.readyVotes.size,
      activePlayers: activeCount,
      roundResults: this.roundResults,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: Math.round(p.x),
        y: Math.round(p.y),
        angle: p.angle,
        score: p.score,
        finished: p.finished,
        eliminated: p.eliminated,
        disconnected: p.disconnected,
        item: p.item
      })),
      traps: Array.from(this.traps.values()),
      pickups: this.pickups.filter(p => p.active).map(p => ({ id: p.id, x: p.x, y: p.y }))
    });
  }
}