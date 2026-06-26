import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    headers: {
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': '',
      'Access-Control-Allow-Origin': '*'
    },
    fs: {
      strict: false
    },
    hmr: {
      protocol: 'ws',
      port: 3045
    }
  }
})
