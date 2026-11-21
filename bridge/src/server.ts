import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { PLACEHOLDER_GIFTS, type BridgeMessage, type GameEvent } from '@typejoin/shared';
import type { EventSource } from './sources/EventSource';
import { FakeSource } from './sources/FakeSource';
import { Normalizer } from './normalize';
import { BRIDGE_CONFIG } from './config';

const DEV_HTML = fileURLToPath(new URL('../public/dev.html', import.meta.url));

export interface BridgeHandle {
  close(): Promise<void>;
}

export async function startBridge(source: EventSource, cfg = BRIDGE_CONFIG): Promise<BridgeHandle> {
  const normalizer = new Normalizer({ joinAliases: cfg.joinAliases, streakMemoryMs: cfg.streakMemoryMs });
  const recent: GameEvent[] = [];
  let totalEvents = 0;

  const http = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      console.error('[bridge] http error', err);
      send(res, 500, { error: 'internal' });
    });
  });
  const wss = new WebSocketServer({ server: http });

  wss.on('connection', (ws) => {
    const hello: BridgeMessage = { kind: 'hello', source: source.name, version: 1 };
    ws.send(JSON.stringify(hello));
    console.log(`[bridge] game client connected (${wss.clients.size} total)`);
    ws.on('close', () => console.log(`[bridge] game client left (${wss.clients.size} total)`));
  });

  function broadcast(event: GameEvent): void {
    totalEvents++;
    recent.push(event);
    if (recent.length > cfg.recentEventLimit) recent.shift();
    const msg = JSON.stringify({ kind: 'event', event } satisfies BridgeMessage);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  }

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    if (url.pathname === '/health') return send(res, 200, { ok: true, source: source.name, clients: wss.clients.size });

    // Future seam: GET /avatar?url=... (avatar proxy) will be mounted here.

    if (!(source instanceof FakeSource)) return send(res, 404, { error: 'not found' });

    if (url.pathname === '/dev' || url.pathname === '/dev/') {
      const html = await readFile(DEV_HTML, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return void res.end(html);
    }
    if (url.pathname === '/dev/state' && req.method === 'GET') {
      return send(res, 200, {
        rates: source.rates,
        users: source.users.map((u) => ({ userId: u.userId, nickname: u.nickname })),
        gifts: PLACEHOLDER_GIFTS,
        clients: wss.clients.size,
        totalEvents,
        recent: recent.slice(-20).reverse(),
      });
    }
    if (url.pathname === '/dev/cmd' && req.method === 'POST') {
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

  await source.start((raw) => {
    for (const ev of normalizer.normalize(raw)) broadcast(ev);
  });

  await new Promise<void>((resolve) => http.listen(cfg.port, cfg.host, resolve));
  console.log(`[bridge] source=${source.name}  ws://localhost:${cfg.port}  dev panel: http://localhost:${cfg.port}/dev`);

  return {
    async close() {
      await source.stop();
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
