import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Isolated buyer entry: never copy public/, the command-center shell, or provider functions.
export function investorPortalConfig(environment: 'live' | 'staging') {
return defineConfig({
  define: { __PBK_PORTAL_ENV__: JSON.stringify(environment) },
  plugins: [react(), {
    name: 'pbk-investor-release-profile',
    transformIndexHtml: (html: string) => environment === 'live' ? html.replace(' · Staging', '') : html,
    generateBundle() {
      this.emitFile({type:'asset', fileName:'portal-release.json', source:JSON.stringify({environment})});
    },
  }],
  publicDir: false,
  build: {
    outDir: environment === 'live' ? '.pbk-local/investor-live' : '.pbk-local/investor-public-stage',
    sourcemap: false,
    rollupOptions: { input: path.resolve(__dirname, 'investor-portal.html') },
  },
});
}
export default investorPortalConfig('staging');
