import type { Config } from '../config';
import type { LeaderRow, Player } from './types';

/** Session leaderboard (memory only; a database comes later). */
export class Leaderboard {
  private rows = new Map<string, LeaderRow>();
  constructor(private cfg: Config) {}

  /**
   * @param rankedAlive real players alive at round end, sorted by mass (desc)
   * @param participants every real player who played this round (for kill points)
   */
  addRound(rankedAlive: Player[], participants: Player[]): void {
    const L = this.cfg.leaderboard;
    const add = (p: Player, pts: number) => {
      if (pts <= 0) return;
      const r = this.rows.get(p.userId) ?? { userId: p.userId, nickname: p.nickname, avatarUrl: p.avatarUrl, points: 0 };
      r.nickname = p.nickname;
      r.avatarUrl = p.avatarUrl;
      r.points += pts;
      this.rows.set(p.userId, r);
    };
    rankedAlive.forEach((p, i) => {
      if (p.isBot) return;
      add(p, i < L.placePoints.length ? L.placePoints[i] : i < 10 ? L.top10Points : 0);
    });
    for (const p of participants) if (!p.isBot) add(p, p.kills * L.pointsPerKill);
  }

  top(n: number): LeaderRow[] {
    return [...this.rows.values()].sort((a, b) => b.points - a.points).slice(0, n).map((r) => ({ ...r }));
  }

  points(userId: string): number {
    return this.rows.get(userId)?.points ?? 0;
  }
}
