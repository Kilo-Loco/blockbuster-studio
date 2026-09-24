import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  resolve: { alias: { '@shared': r('./shared'), '@web': r('./web/src') } },
  test: { include: ['shared/**/*.test.ts', 'server/**/*.test.ts'], environment: 'node' },
});
