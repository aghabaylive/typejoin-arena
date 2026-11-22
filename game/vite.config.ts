import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  // main.ts uses top-level await (Pixi app.init); OBS's browser source and current Chrome support ES2022.
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never);
