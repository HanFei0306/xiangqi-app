/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The Android WebView loads the bundle from file:///android_asset/public/,
 * where the origin is "null". ES modules are blocked there by CORS, and an
 * absolute "/assets/..." path would not resolve under file:// either. So for
 * production builds we emit a classic (non-module) script with a RELATIVE
 * path, placed after #root. The bundle itself is self-contained (no ESM
 * import/export survives Rollup's single-file output). This keeps the raw
 * `dist/` directly openable via file:// as well as inside the APK.
 */
function classicScriptForFileProtocol(): Plugin {
  return {
    name: 'classic-script-for-file-protocol',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const names = Object.keys(bundle);
      const js = names.find((n) => n.endsWith('.js'));
      const css = names.find((n) => n.endsWith('.css'));
      if (!js) return;
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;
      const jsName = js.split('/').pop()!;
      const cssName = css ? css.split('/').pop() : undefined;
      html.source = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%236E3218'/%3E%3Ccircle cx='32' cy='34' r='20' fill='%23CEB280'/%3E%3Ccircle cx='32' cy='32' r='20' fill='%23C9A23C'/%3E%3Ccircle cx='32' cy='32' r='18' fill='%23F4E4C2'/%3E%3Ccircle cx='32' cy='32' r='15' fill='none' stroke='%2396701E' stroke-width='1.4'/%3E%3Ctext x='32' y='40' font-size='21' text-anchor='middle' fill='%23B0281E'%3E%E5%B8%A5%3C/text%3E%3C/svg%3E" />
    <title>象棋训练 · Xiangqi Trainer</title>
${cssName ? `    <link rel="stylesheet" href="assets/${cssName}">\n` : ''}  </head>
  <body>
    <div id="root"></div>
    <script src="assets/${jsName}"></script>
  </body>
</html>
`;
    },
  };
}

// Vite + React + Vitest configuration.
export default defineConfig({
  base: './',
  plugins: [react(), classicScriptForFileProtocol()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules/**', 'dist/**', '_backup/**'],
    css: false,
  },
});
