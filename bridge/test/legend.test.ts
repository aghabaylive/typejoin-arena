import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import { parseLegendMode, type BridgeMessage } from '@typejoin/shared';
import { BRIDGE_CONFIG } from '../src/config';
import { startBridge, type BridgeHandle } from '../src/server';
import { Settings } from '../src/settings';
import { FakeSource } from '../src/sources/FakeSource';

describe('legend mode (host panel toggle)', () => {
  it('accepts only "full" and "off"', () => {
    expect(parseLegendMode('full')).toBe('full');
    expect(parseLegendMode('off')).toBe('off');
    for (const x of ['OFF', 'on', '', null, undefined, 1, {}]) expect(parseLegendMode(x)).toBeNull();
  });
});

describe('saved legend setting (data/settings.json)', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'tj-settings-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('no file -> no saved choice; setLegend writes the file and a new instance reads it back', () => {
    const file = join(tmp(), 'data', 'settings.json');
    expect(new Settings(file).legend).toBeNull();
    new Settings(file).setLegend('off');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ legend: 'off' });
    expect(new Settings(file).legend).toBe('off');
    new Settings(file).setLegend('full');
    expect(new Settings(file).legend).toBe('full');
  });

  it('a broken or invalid file is ignored (game default)', () => {
    const file = join(tmp(), 'settings.json');
    writeFileSync(file, '{ not json');
    expect(new Settings(file).legend).toBeNull();
    writeFileSync(file, JSON.stringify({ legend: 'sideways' }));
    expect(new Settings(file).legend).toBeNull();
  });
});

describe('legend toggle over the bridge', () => {
  let bridge: BridgeHandle | undefined;
  const clients: WebSocket[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.terminate();
    await bridge?.close();
    bridge = undefined;
  });

  /** A game page: collects every 'legend' host message it receives. */
  const connect = async (port: number) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    clients.push(ws);
    const legend: string[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as BridgeMessage;
      if (m.kind === 'host' && m.action === 'legend') legend.push(m.mode);
    });
    await new Promise((r) => ws.once('open', r));
    await new Promise((r) => setTimeout(r, 50));
    return legend;
  };
  const toggle = (port: number, mode: string) =>
    fetch(`http://127.0.0.1:${port}/host/cmd`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` },
      body: JSON.stringify({ cmd: 'legend', mode }),
    });

  it('host OFF/ON reaches the running game at once, is saved, and is re-sent after a bridge restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tj-bridge-'));
    const port = 18000 + Math.floor(Math.random() * 2000);
    const cfg = { ...BRIDGE_CONFIG, port, settingsFile: join(dir, 'settings.json'), banFile: join(dir, 'bans.json'), logDir: join(dir, 'logs') };
    try {
      bridge = await startBridge(new FakeSource(), cfg);
      const live = await connect(port);
      expect(live).toEqual([]); // nothing saved yet: the game keeps its config default
      expect((await toggle(port, 'off')).status).toBe(200);
      await new Promise((r) => setTimeout(r, 50));
      expect(live).toEqual(['off']); // applied live, no reload
      expect((await toggle(port, 'sideways')).status).toBe(400);
      expect(JSON.parse(readFileSync(cfg.settingsFile, 'utf8'))).toEqual({ legend: 'off' });
      // Restart the bridge: a (re)connecting game page gets the saved choice.
      await bridge.close();
      bridge = await startBridge(new FakeSource(), cfg);
      expect(await connect(port)).toEqual(['off']);
      expect((await toggle(port, 'full')).status).toBe(200);
      expect(new Settings(cfg.settingsFile).legend).toBe('full');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
