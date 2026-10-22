import fs from 'node:fs';
import path from 'node:path';

const DB_FILE = path.resolve('records.json');

export class Storage {
  static load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (!data.history) data.history = [];
        return data;
      }
    } catch (e) {
      console.error('Ошибка загрузки БД, сброс к дефолту', e);
    }
    return { leaderboard: [], totalRaces: 0, history: [] };
  }

  static saveMatch({ winner, rounds, players, traps }) {
    const data = Storage.load();
    data.totalRaces++;

    
    if (winner) {
      const winnerScore = players.find(p => p.name === winner)?.score || 0;
      const existing = data.leaderboard.find(p => p.name === winner);
      if (existing) {
        existing.score = Math.max(existing.score, winnerScore);
        existing.wins += 1;
      } else {
        data.leaderboard.push({ name: winner, score: winnerScore, wins: 1 });
      }
      data.leaderboard.sort((a, b) => b.score - a.score);
      data.leaderboard = data.leaderboard.slice(0, 5);
    }

    
    if (!data.history) data.history = [];
    const matchId = `match_${Date.now()}`;
    data.history.unshift({
      id: matchId,
      date: new Date().toLocaleString('ru-RU'),
      winner: winner || 'Ничья',
      rounds,
      players,
      traps
    });
    data.history = data.history.slice(0, 15);

    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Ошибка сохранения данных:', e);
    }
  }
}