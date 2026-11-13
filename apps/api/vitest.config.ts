import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS 依賴 decorator metadata 做依賴注入，esbuild 不支援，改用 SWC 轉譯
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // 所有測試共用同一個測試資料庫，依序執行避免互相干擾
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
