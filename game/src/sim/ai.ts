import type { Ball } from './types';
import type { Sim } from './Sim';

/**
 * Autonomous movement. Viewers never steer (stream delay makes that impossible).
 * Priority: storm escape > flee > chase > pellet > wander.
 * Result: unit direction in b.aiDx / b.aiDy and b.aiMode.
 */
export function think(sim: Sim, b: Ball): void {
  const c = sim.cfg;
  const ai = c.ai;
  const owner = sim.players.get(b.ownerId);
  const t = b.temperament === 'bold' ? ai.bold : ai.cautious;
  const sight = ai.sightBase + ai.sightPerRadius * b.radius;
  const now = sim.time;
  const { cx, cy } = c.arena;
  const dxC = cx - b.x, dyC = cy - b.y;
  const distC = Math.hypot(dxC, dyC);

  let dx = 0, dy = 0;
  let mode: Ball['aiMode'] = 'wander';

  // 0) Storm: get back into the safe zone first.
  if (sim.stormActive() && distC > sim.safeRadius() - b.radius * 0.5) {
    set(dxC, dyC, 'storm');
    return finish();
  }

  // Dash ability: lock onto the nearest smaller ball.
  if (owner && owner.dashUntil > now) {
    let target = owner.dashTargetId != null ? sim.ballById(owner.dashTargetId) : undefined;
    if (!target || target.mass >= b.mass) {
      target = sim.nearestSmallerBall(b);
      owner.dashTargetId = target?.id ?? null;
    }
    if (target) {
      set(target.x - b.x, target.y - b.y, 'dash');
      return finish();
    }
  }

  // 1) Flee from much bigger balls.
  let fx = 0, fy = 0, threats = 0;
  // 2) Chase prey.
  let prey: Ball | null = null;
  let preyScore = -Infinity;
  const fleeRange = sight * t.fleeMul;
  const chaseRange = sight * t.chaseMul;
  const meHarmless = sim.isHarmless(b);
  for (const o of sim.balls) {
    if (o === b || o.ownerId === b.ownerId) continue;
    const ox = o.x - b.x, oy = o.y - b.y;
    const d = Math.hypot(ox, oy) || 0.001;
    const gap = d - o.radius - b.radius;
    if (o.mass >= b.mass * ai.fleeRatio && !sim.isHarmless(o)) {
      if (gap < fleeRange) {
        const w = 1 - Math.max(0, gap) / fleeRange + 0.2;
        fx -= (ox / d) * w;
        fy -= (oy / d) * w;
        threats++;
      }
    } else if (!meHarmless && o.mass <= b.mass * ai.chaseRatio && !sim.isHarmless(o) && gap < chaseRange) {
      const score = o.mass / (d + 50);
      if (score > preyScore) {
        preyScore = score;
        prey = o;
      }
    }
  }

  if (threats > 0) {
    // Fleeing into the wall is pointless: bend the escape toward the arena interior.
    const edge = distC / (c.arena.radius - b.radius + 1);
    if (edge > 0.7) {
      const k = (edge - 0.7) * 3;
      fx += (dxC / (distC || 1)) * k;
      fy += (dyC / (distC || 1)) * k;
    }
    set(fx, fy, 'flee');
  } else if (prey) {
    // Lead the target a little.
    set(prey.x + prey.vx * 0.25 - b.x, prey.y + prey.vy * 0.25 - b.y, 'chase');
  } else if (b.mergeAt > 0 && now >= b.mergeAt && sim.siblingOf(b)) {
    const s = sim.siblingOf(b)!;
    set(s.x - b.x, s.y - b.y, 'merge');
  } else {
    const p = sim.nearestPellet(b.x, b.y);
    if (p) set(p.x - b.x, p.y - b.y, 'pellet');
    else {
      if (now >= b.wanderUntil) {
        b.wanderAngle += (sim.rand() - 0.5) * Math.PI * 1.5;
        const [lo, hi] = ai.wanderChangeSec;
        b.wanderUntil = now + lo + sim.rand() * (hi - lo);
      }
      set(Math.cos(b.wanderAngle), Math.sin(b.wanderAngle), 'wander');
    }
  }
  return finish();

  function set(x: number, y: number, m: Ball['aiMode']) {
    const l = Math.hypot(x, y);
    if (l < 1e-6) return;
    dx = x / l;
    dy = y / l;
    mode = m;
  }

  function finish() {
    // Wall avoidance.
    const limit = c.arena.radius - b.radius;
    if (distC > limit - ai.wallAvoidMargin && distC > 0) {
      const k = Math.min(1, (distC - (limit - ai.wallAvoidMargin)) / ai.wallAvoidMargin);
      dx += (dxC / distC) * k * 0.8;
      dy += (dyC / distC) * k * 0.8;
    }
    // Heavy balls steer around spikes (they would split).
    if (b.mass > c.spikes.splitAboveMass && mode !== 'dash') {
      for (const s of sim.spikes) {
        if (!s.active) continue;
        const sx = b.x - s.x, sy = b.y - s.y;
        const d = Math.hypot(sx, sy) || 0.001;
        const range = b.radius + c.spikes.radius + c.ai.spikeAvoidMargin;
        if (d < range) {
          const k = (1 - d / range) * 2;
          dx += (sx / d) * k;
          dy += (sy / d) * k;
        }
      }
    }
    const l = Math.hypot(dx, dy);
    if (l > 1e-6) {
      b.aiDx = dx / l;
      b.aiDy = dy / l;
    }
    b.aiMode = mode;
  }
}
