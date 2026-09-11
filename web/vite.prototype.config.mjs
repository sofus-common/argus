import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({ plugins: [react()], server: {
  host: '127.0.0.1', port: 5174, strictPort: true,
  proxy: { '/api': {
    target: 'http://127.0.0.1:5173', changeOrigin: true, ws: true,
    configure(proxy) {
      const forwardOrigin = (outgoing, incoming) => {
        if (incoming.headers.origin === 'http://127.0.0.1:5174') outgoing.setHeader('origin', 'http://127.0.0.1:5173')
      }
      proxy.on('proxyReq', forwardOrigin)
      proxy.on('proxyReqWs', forwardOrigin)
    },
  } },
} })
