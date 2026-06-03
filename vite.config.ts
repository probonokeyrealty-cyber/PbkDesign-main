import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const configuredDevBridgeTarget =
  process.env.PBK_DEV_BRIDGE_URL ||
  process.env.PBK_BRIDGE_URL ||
  process.env.PBK_HOSTED_BRIDGE_URL

const devBridgeTarget =
  configuredDevBridgeTarget ||
  'http://127.0.0.1:8788'

if (!configuredDevBridgeTarget && process.env.NODE_ENV !== 'production') {
  console.warn('[PBK Vite] No bridge URL configured; dev proxy defaults to http://127.0.0.1:8788.')
}

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

function shellHistoryFallback() {
  return {
    name: 'pbk-shell-history-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/index.shell.html/')) {
          req.url = '/index.shell.html'
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    shellHistoryFallback(),
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
      '/health': {
        target: devBridgeTarget,
        changeOrigin: true,
        headers: devBridgeProxyHeaders,
      },
      '/status': {
        target: devBridgeTarget,
        changeOrigin: true,
        headers: devBridgeProxyHeaders,
      },
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
      '/ws': {
        target: devBridgeTarget,
        changeOrigin: true,
        ws: true,
        headers: devBridgeProxyHeaders,
      },
      '/api/ws': {
        target: devBridgeTarget,
        changeOrigin: true,
        ws: true,
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
      output: {
        manualChunks(id) {
          const normalizedId = id.split(path.sep).join('/');
          if (normalizedId.includes('/node_modules/')) {
            if (/[\\/]node_modules[\\/](react|react-dom|react-router)([\\/]|$)/.test(id)) {
              return 'vendor-react';
            }
            if (
              /[\\/]node_modules[\\/](@mui|@emotion|@radix-ui|@popperjs|lucide-react)([\\/]|$)/.test(
                id
              )
            ) {
              return 'vendor-ui';
            }
            if (/[\\/]node_modules[\\/](recharts|d3-|three)([\\/]|$)/.test(id)) {
              return 'vendor-visualization';
            }
            return 'vendor';
          }
          const routeMatch = normalizedId.match(/\/src\/app\/routes\/([^/.]+)/);
          if (routeMatch?.[1]) {
            return `route-${routeMatch[1].replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`;
          }
        },
      },
    },
  },
})
