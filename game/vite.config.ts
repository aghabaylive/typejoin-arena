import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never);
