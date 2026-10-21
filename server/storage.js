import fs from 'node:fs';
import path from 'node:path';

const DB_FILE = path.resolve('records.json');

export class Storage {
  static load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('Ошибка загрузки БД, сброс к дефолту', e);
    }
    return { leaderboard: [], totalRaces: 0 };
  }

  static saveRaceResult(winnerName, score) {
    const data = Storage.load();
    data.totalRaces++;
    
    const existing = data.leaderboard.find(p => p.name === winnerName);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      existing.wins += 1;
    } else {
      data.leaderboard.push({ name: winnerName, score, wins: 1 });
    }

    
    data.leaderboard.sort((a, b) => b.score - a.score);
    data.leaderboard = data.leaderboard.slice(0, 5);

    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Ошибка сохранения данных:', e);
    }
  }
}