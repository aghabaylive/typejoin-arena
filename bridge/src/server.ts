import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GIFT_ABILITIES, GIFT_MAP, devGifts,
  type BridgeMessage, type GameEvent, type GameToBridgeMessage, type HostAction, type PlayerSnapshot, type SourceState,
} from '@typejoin/shared';
import type { EventSource, RawSourceEvent } from './sources/EventSource';
import { FakeSource } from './sources/FakeSource';
import { Normalizer } from './normalize';
import { BRIDGE_CONFIG } from './config';
import { AvatarProxy } from './avatarProxy';
import { BanList, loadNameFilter } from './moderation';
import { EventLog } from './eventLog';

const page = (f: string) => fileURLToPath(new URL(`../public/${f}`, import.meta.url));
/** Local gift icons (downloaded by gifts:fetch), served for the dev panel. */
const GIFT_ICON_DIR = fileURLToPath(new URL('../../game/public/gifts/', import.meta.url));
const ICON_TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

export interface BridgeHandle {
  close(): Promise<void>;
}

interface DelayStat { count: number; sumMs: number; maxMs: number }
const addDelay = (s: DelayStat, ms: number) => {
  s.count++;
  s.sumMs += ms;
  s.maxMs = Math.max(s.maxMs, ms);
};

const isLoopback = (req: IncomingMessage) => {
  const a = req.socket.remoteAddress ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
};

export async function startBridge(source: EventSource, cfg = BRIDGE_CONFIG): Promise<BridgeHandle> {
  const normalizer = new Normalizer({ joinAliases: cfg.joinAliases, streakMemoryMs: cfg.streakMemoryMs });
  const bans = new BanList(cfg.banFile);
  const nameFilter = loadNameFilter(cfg.nameFilterFile);
  const log = new EventLog(cfg.logDir, source.name);
  const avatars = new AvatarProxy({ size: 128, cacheEntries: cfg.avatarCacheEntries });
  const isFake = source instanceof FakeSource;
  const recent: GameEvent[] = [];
  let totalEvents = 0;
  const counts: Record<string, number> = {};
  let dropped = 0;
  const platformToBridge: DelayStat = { count: 0, sumMs: 0, maxMs: 0 };
  const bridgeToGame: DelayStat = { count: 0, sumMs: 0, maxMs: 0 };
  let game: Omit<GameToBridgeMessage, 'kind' | 'delay'> & { at: number } = { players: [], queued: 0, phase: '?', roundNo: 0, paused: false, at: 0 };
  const statusLog: { at: string; state: SourceState; detail?: string }[] = [];
  const startedAt = Date.now();
  console.log(`[bridge] bans: ${bans.list().length}, name filter words: ${nameFilter.size}, event log: ${cfg.logDir}`);

  const http = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      console.error('[bridge] http error', err);
      send(res, 500, { error: 'internal' });
    });
  });
  const wss = new WebSocketServer({ server: http });

  const sendAll = (m: BridgeMessage) => {
    const msg = JSON.stringify(m);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  };

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ kind: 'hello', source: source.name, version: 1 } satisfies BridgeMessage));
    ws.send(JSON.stringify({ kind: 'status', state: source.state } satisfies BridgeMessage));
    console.log(`[bridge] game client connected (${wss.clients.size} total)`);
    ws.on('close', () => console.log(`[bridge] game client left (${wss.clients.size} total)`));
    ws.on('message', (data) => {
      let m: GameToBridgeMessage;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (m?.kind !== 'players' || !Array.isArray(m.players)) return;
      game = { players: m.players.slice(0, 500), queued: m.queued, phase: m.phase, roundNo: m.roundNo, paused: m.paused, at: Date.now() };
      if (m.delay?.count > 0) {
        bridgeToGame.count += m.delay.count;
        bridgeToGame.sumMs += m.delay.sumMs;
        bridgeToGame.maxMs = Math.max(bridgeToGame.maxMs, m.delay.maxMs);
      }
    });
  });

  source.onStatus((state, detail) => {
    statusLog.push({ at: new Date().toISOString(), state, detail });
    if (statusLog.length > 100) statusLog.shift();
    console.log(`[bridge] source ${source.name}: ${state}${detail ? ` (${detail})` : ''}`);
    sendAll({ kind: 'status', state, detail });
  });

  function onRaw(raw: RawSourceEvent): void {
    const receivedAt = Date.now();
    if (raw.sourceTs) addDelay(platformToBridge, Math.max(0, receivedAt - raw.sourceTs));
    for (const ev of normalizer.normalize(raw)) {
      if (bans.has(ev.userId)) {
        dropped++;
        log.write(ev, { dropped: 'banned' });
        continue;
      }
      const event = { ...ev, nickname: nameFilter.apply(ev.nickname) } as GameEvent;
      log.write(event);
      totalEvents++;
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      recent.push(event);
      if (recent.length > cfg.recentEventLimit) recent.shift();
      sendAll({ kind: 'event', event });
    }
  }

  function host(action: HostAction): void {
    sendAll({ kind: 'host', ...action });
  }

  /** Control endpoints: local machine, same origin, JSON body only (blocks cross-site requests). */
  function controlAllowed(req: IncomingMessage): boolean {
    if (!isLoopback(req)) return false;
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return false;
    if (req.method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) return false;
    return true;
  }

  async function servePage(res: ServerResponse, file: string): Promise<void> {
    const html = await readFile(page(file), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' });
    res.end(html);
  }

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const p = url.pathname;

    if (p === '/health') return send(res, 200, { ok: true, source: source.name, state: source.state, clients: wss.clients.size });

    // Avatar proxy: the game (another origin) loads these, so CORS is allowed here only.
    if (p === '/avatar') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      const img = req.method === 'GET' ? await avatars.get(url.searchParams.get('url') ?? '') : null;
      if (!img) return send(res, 404, { error: 'no avatar' });
      res.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'public, max-age=3600', 'content-length': img.length });
      return void res.end(img);
    }

    const icon = /^\/gifts\/(\d+)\.(webp|png|jpe?g|gif)$/.exec(p);
    if (icon && req.method === 'GET') {
      try {
        const data = await readFile(`${GIFT_ICON_DIR}${icon[1]}.${icon[2]}`);
        res.writeHead(200, { 'content-type': ICON_TYPES[icon[2]], 'cache-control': 'max-age=86400' });
        return void res.end(data);
      } catch {
        return send(res, 404, { error: 'no icon' });
      }
    }

    if (p.startsWith('/dev') || p.startsWith('/host')) {
      if (!controlAllowed(req)) return send(res, 403, { error: 'local only' });
    }

    // ---------- host panel (any source) ----------
    if (p === '/host' || p === '/host/') return servePage(res, 'host.html');
    if (p === '/host/state' && req.method === 'GET') {
      return send(res, 200, {
        source: source.name, state: source.state, statusLog: statusLog.slice(-20),
        game: { ...game, ageMs: game.at ? Date.now() - game.at : null, clients: wss.clients.size },
        bans: bans.list(), nameFilterWords: nameFilter.size,
        stats: {
          uptimeSec: Math.round((Date.now() - startedAt) / 1000), totalEvents, dropped, counts,
          platformToBridgeMs: platformToBridge.count ? Math.round(platformToBridge.sumMs / platformToBridge.count) : null,
          platformToBridgeMaxMs: platformToBridge.maxMs,
          bridgeToGameMs: bridgeToGame.count ? +(bridgeToGame.sumMs / bridgeToGame.count).toFixed(1) : null,
          bridgeToGameMaxMs: bridgeToGame.maxMs,
          avatars: avatars.stats,
          source: (source as { stats?: unknown }).stats ?? null,
        },
      });
    }
    if (p === '/host/cmd' && req.method === 'POST') {
      const b = (await readJson(req)) as Record<string, unknown>;
      const userId = typeof b.userId === 'string' ? b.userId : '';
      switch (b.cmd) {
        case 'pause': host({ action: 'pause' }); break;
        case 'resume': host({ action: 'resume' }); break;
        case 'restartRound': host({ action: 'restartRound' }); break;
        case 'ban': {
          if (!userId) return send(res, 400, { error: 'userId required' });
          const nick = game.players.find((pl: PlayerSnapshot) => pl.userId === userId)?.nickname ?? String(b.nickname ?? userId);
          bans.ban(userId, nick);
          host({ action: 'remove', userId });
          console.log(`[bridge] banned ${userId} (${nick})`);
          break;
        }
        case 'unban':
          if (!userId) return send(res, 400, { error: 'userId required' });
          bans.unban(userId);
          break;
        default:
          return send(res, 400, { error: 'unknown cmd' });
      }
      return send(res, 200, { ok: true });
    }

    // ---------- dev panel ----------
    if (p === '/dev' || p === '/dev/') return servePage(res, isFake ? 'dev.html' : 'live.html');
    if (p === '/dev/state' && req.method === 'GET') {
      const base = { source: source.name, state: source.state, clients: wss.clients.size, totalEvents, counts, recent: recent.slice(-40).reverse() };
      if (!isFake) return send(res, 200, base);
      return send(res, 200, {
        ...base,
        rates: source.rates,
        users: source.users.map((u) => ({ userId: u.userId, nickname: u.nickname })),
        gifts: devGifts().map((g) => ({ ...g, ability: GIFT_ABILITIES.find((a) => GIFT_MAP[a] === g.giftId) ?? null })),
      });
    }
    if (p === '/dev/cmd' && req.method === 'POST') {
      // Real viewers only in TikTok mode: no fake viewers, likes or gifts can be injected.
      if (!isFake) return send(res, 403, { error: `dev commands are disabled for source=${source.name}` });
      const body = (await readJson(req)) as Record<string, unknown>;
      const userId = typeof body.userId === 'string' && body.userId ? body.userId : undefined;
      const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      switch (body.cmd) {
        case 'addViewers': source.addViewers(num(body.n, 10)); break;
        case 'rejoinAll': source.rejoinAll(); break;
        case 'likes': source.likeBurst(num(body.count, 100), userId); break;
        case 'gift':
          if (!source.gift(num(body.giftId, 0), num(body.units, 1), userId)) return send(res, 400, { error: 'unknown gift' });
          break;
        case 'follow': source.follow(userId); break;
        case 'share': source.share(userId); break;
        case 'chat': source.chat(String(body.text ?? ''), userId); break;
        case 'rates': source.setRates(body as never); break;
        default: return send(res, 400, { error: 'unknown cmd' });
      }
      return send(res, 200, { ok: true, rates: source.rates });
    }
    send(res, 404, { error: 'not found' });
  }

  await source.start(onRaw);

  await new Promise<void>((resolve) => http.listen(cfg.port, cfg.host, resolve));
  console.log(`[bridge] source=${source.name}  ws://localhost:${cfg.port}  host panel: http://localhost:${cfg.port}/host  dev: http://localhost:${cfg.port}/dev`);

  return {
    async close() {
      await source.stop();
      await log.close();
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}
