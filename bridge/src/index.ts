import { BRIDGE_CONFIG } from './config';
import { startBridge } from './server';
import type { EventSource } from './sources/EventSource';
import { FakeSource } from './sources/FakeSource';
import { TikTokSource } from './sources/TikTokSource';

function createSource(): EventSource {
  switch (BRIDGE_CONFIG.source) {
    case 'tiktok':
      if (!BRIDGE_CONFIG.tiktokUsername) {
        console.error('SOURCE=tiktok needs TIKTOK_USERNAME=<account>');
        process.exit(1);
      }
      console.log(`[bridge] TikTok source: @${BRIDGE_CONFIG.tiktokUsername}${BRIDGE_CONFIG.signApiKey ? ' (with SIGN_API_KEY)' : ' (free signing tier)'}`);
      return new TikTokSource({ username: BRIDGE_CONFIG.tiktokUsername, signApiKey: BRIDGE_CONFIG.signApiKey });
    case 'fake':
    default:
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
