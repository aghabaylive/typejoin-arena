import { BRIDGE_CONFIG } from './config';
import { startBridge } from './server';
import type { EventSource } from './sources/EventSource';
import { FakeSource } from './sources/FakeSource';

function createSource(): EventSource {
  switch (BRIDGE_CONFIG.source) {
    case 'fake':
    default:
      // Later: case 'tiktok': return new TikTokSource(...)
      return new FakeSource();
  }
}

const bridge = await startBridge(createSource());

const shutdown = async () => {
  await bridge.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
