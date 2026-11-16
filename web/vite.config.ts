import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The version people see in the app (My account) and that each till reports online: the build date and
// the code's short id, e.g. 2026.11.16-c869432. It changes by itself with every update, nothing to bump.
const d = new Date();
const sha = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'local').slice(0, 7);
const BUILD = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}-${sha}`;

/** version.json next to the app: tills compare it with their own version to say "up to date" or "update ready". */
const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD, at: d.toISOString() }) });
  },
});

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __APP_BUILD__: JSON.stringify(BUILD) },
  // Older tills (Windows 10 with an old Chrome/Edge) must still run the app.
  build: { target: ['chrome87', 'edge88', 'firefox78', 'safari14'] },
  server: { port: 5173 },
});
