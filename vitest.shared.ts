import { defineConfig } from 'vitest/config';

// Inline PostCSS config stops Vite from searching parent folders for a stray postcss.config.
export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: { environment: 'node' },
});
