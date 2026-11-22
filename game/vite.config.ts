import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    // TikTok LIVE Studio's "Add link" rejects 127.0.0.1 / localhost URLs. A hosts entry
    // (127.0.0.1 arena.typejoin.test) gives a normal-looking local domain; vite must allow that Host header.
    allowedHosts: ['arena.typejoin.test'],
  },
  // main.ts uses top-level await (Pixi app.init); OBS's browser source and current Chrome support ES2022.
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never);
