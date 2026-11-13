import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:8000', rewrite: path => path.replace(/^\/api/, '') } } },
  test: { environment: 'jsdom', restoreMocks: true },
});
