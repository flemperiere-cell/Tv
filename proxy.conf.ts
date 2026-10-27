import type { ProxyOptions } from 'vite'

const target = 'http://127.0.0.1:3000'

function configureProxy(...[proxy]: Parameters<NonNullable<ProxyOptions['configure']>>) {
  proxy.on('proxyReq', (proxyRequest) => {
    proxyRequest.setHeader('origin', target)
  })
}

const proxy: Record<string, ProxyOptions> = {
  '/api': {
    target,
    changeOrigin: true,
    configure: configureProxy,
  },
  '/tv/api': {
    target,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/tv\/api/, '/api'),
    configure: configureProxy,
  },
}

export default proxy
