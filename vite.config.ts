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

const pbkBuildId =
  process.env.PBK_DEPLOY_SHA ||
  process.env.COMMIT_REF ||
  process.env.RENDER_GIT_COMMIT ||
  process.env.GITHUB_SHA ||
  `${Date.now()}`

const portalEnvironment = process.env.PBK_PORTAL_ENV || (process.env.NODE_ENV === 'production' ? 'live' : 'staging')
if (!['live', 'staging'].includes(portalEnvironment)) throw Error('Invalid PBK portal environment')

const marketPreviewBranch = process.env.HEAD
const stagingMarketIndicators =
  process.env.CONTEXT === 'deploy-preview' &&
  (marketPreviewBranch === 'codex/house-zip-staging-indicators' ||
    marketPreviewBranch === 'codex/van-nuys-market-map-preview')
const marketQa91411 =
  stagingMarketIndicators &&
  marketPreviewBranch === 'codex/house-zip-staging-indicators' &&
  process.env.REVIEW_ID === '111'
const marketQa91411Page = 'market-comparison-91411-qa.html'
const includeLegacyShell = process.env.PBK_INCLUDE_LEGACY_SHELL === 'true'
const modernShellEntry = 'index.shell.html'
const legacyShellEntry = 'legacy-command-center.html'

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

const shellHistoryPaths = new Set([
  '/',
  '/index',
  '/index.html',
  '/dashboard',
  '/command-center',
  '/leads',
  '/deal',
  '/deals',
  '/analyzer',
  '/inbox',
  '/fleet',
  '/agent-fleet',
  '/agents',
  '/memory',
  '/brain',
  '/skills',
  '/skill-studio',
  '/analytics',
  '/settings',
  '/property-log',
  '/dialer',
  '/dialer/van-nuys-demo',
  '/prospecting',
  '/campaigns',
  '/agent',
  '/agent-console',
  '/ava-chat',
])

const shellHistoryPrefixes = [
  '/index.shell.html/',
  '/leads/',
  '/deal/',
  '/deals/',
  '/inbox/',
  '/skills/',
  '/skill-studio/',
]

function shouldServeShellHistory(url = '') {
  const pathname = url.split('?')[0]
  return shellHistoryPaths.has(pathname) || shellHistoryPrefixes.some((prefix) => pathname.startsWith(prefix))
}

function shellHistoryFallback() {
  const shellUrl = (url: string) => {
    const query = url.indexOf('?')
    return `/${modernShellEntry}${query < 0 ? '' : url.slice(query)}`
  }

  return {
    name: 'pbk-shell-history-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || ''
        const query = url.indexOf('?')
        const pathname = query < 0 ? url : url.slice(0, query)
        const suffix = query < 0 ? '' : url.slice(query)
        if (pathname === `/${legacyShellEntry}` && includeLegacyShell) {
          req.url = `/index.html${suffix}`
        } else if (shouldServeShellHistory(url)) req.url = shellUrl(url)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (shouldServeShellHistory(req.url)) req.url = shellUrl(req.url || '')
        next()
      })
    },
  }
}

function isolateCommandCenterShells() {
  return {
    name: 'pbk-command-center-shells',
    generateBundle: {
      order: 'post' as const,
      handler(_options, bundle) {
        const shell = bundle[modernShellEntry]
        if (!shell || shell.type !== 'asset') this.error('Modern PBK Center entry was not built')

        if (includeLegacyShell) {
          const legacy = bundle['index.html']
          if (!legacy || legacy.type !== 'asset') this.error('Opt-in legacy Command Center entry was not built')
          delete bundle['index.html']
          this.emitFile({ type: 'asset', fileName: legacyShellEntry, source: legacy.source })
        }

        this.emitFile({ type: 'asset', fileName: 'index.html', source: shell.source })
      },
    },
  } satisfies import('vite').Plugin
}

function pbkBuildManifest() {
  return {
    name: 'pbk-build-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'pbk-build-manifest.json',
        source: JSON.stringify(
          {
            buildId: pbkBuildId,
            portalEnvironment,
            generatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
      })
    },
  }
}

export default defineConfig({
  appType: 'mpa',
  define: {
    __PBK_BUILD_ID__: JSON.stringify(pbkBuildId),
    __PBK_PORTAL_ENV__: JSON.stringify(portalEnvironment),
    'import.meta.env.PBK_MARKET_STAGING_INDICATORS': JSON.stringify(stagingMarketIndicators),
    'import.meta.env.PBK_MARKET_91411_QA_PATH': JSON.stringify(
      marketQa91411 ? `/${marketQa91411Page}` : '',
    ),
  },
  plugins: [
    figmaAssetResolver(),
    shellHistoryFallback(),
    isolateCommandCenterShells(),
    pbkBuildManifest(),
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
  // The React shell owns index.html. Legacy builds publish to a separate entry.
  build: {
    rollupOptions: {
      input: {
        ...(includeLegacyShell && { legacy: path.resolve(__dirname, 'index.html') }),
        analyzer: path.resolve(__dirname, 'analyzer.html'),
        shell: path.resolve(__dirname, 'index.shell.html'),
        investor: path.resolve(__dirname, 'investor-portal.html'),
        ...(marketQa91411 && {
          marketQa91411: path.resolve(__dirname, marketQa91411Page),
        }),
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|react-router)[\\/]/.test(id)) {
            return 'vendor-react'
          }
          if (
            /[\\/]node_modules[\\/](@mui|@emotion|@radix-ui|lucide-react|cmdk|vaul|sonner)[\\/]/.test(id)
          ) {
            return 'vendor-ui'
          }
          if (/[\\/]node_modules[\\/](recharts|react-slick|embla-carousel-react)[\\/]/.test(id)) {
            return 'vendor-charts'
          }
          if (/[\\/]node_modules[\\/](@huggingface|onnxruntime-node|@langchain)[\\/]/.test(id)) {
            return 'vendor-ai'
          }
          return undefined
        },
      },
    },
  },
})
