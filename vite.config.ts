import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const devBridgeTarget =
  process.env.PBK_DEV_BRIDGE_URL ||
  process.env.PBK_BRIDGE_URL ||
  process.env.PBK_HOSTED_BRIDGE_URL ||
  'http://127.0.0.1:8788'

const devBridgeApiKey =
  process.env.PBK_DEV_BRIDGE_API_KEY ||
  process.env.PBK_BRIDGE_API_KEY ||
  process.env.PBK_OPENCLAW_API_KEY ||
  process.env.OPENCLAW_API_KEY ||
  ''

const devBridgeProxyHeaders = devBridgeApiKey
  ? { Authorization: `Bearer ${devBridgeApiKey}` }
  : undefined

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  server: {
    proxy: {
      '/api': {
        target: devBridgeTarget,
        changeOrigin: true,
        headers: devBridgeProxyHeaders,
      },
      '/invoke': {
        target: devBridgeTarget,
        changeOrigin: true,
        headers: devBridgeProxyHeaders,
      },
      '/state': {
        target: devBridgeTarget,
        changeOrigin: true,
        headers: devBridgeProxyHeaders,
      },
      '/events': {
        target: devBridgeTarget,
        changeOrigin: true,
        headers: devBridgeProxyHeaders,
      },
    },
  },

  // Multi-page build:
  //   - index.html       → Paradise design (vanilla, the new Command Center)
  //   - analyzer.html    → Engine: React deal analyzer (mounts <App />)
  //   - index.shell.html → Paradise React shell (mounts <ParadiseRouter />)
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        analyzer: path.resolve(__dirname, 'analyzer.html'),
        shell: path.resolve(__dirname, 'index.shell.html'),
      },
    },
  },
})
