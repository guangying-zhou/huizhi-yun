const { readFileSync } = require('fs')
const { resolve } = require('path')

function loadEnv(dir) {
  const envPath = resolve(dir, '.env')
  const env = {}

  try {
    readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return

      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) return

      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim()
      env[key] = value
    })
  } catch (error) {
    console.warn(`[PM2] Warning: could not read ${envPath}:`, error.message)
  }

  return env
}

module.exports = {
  apps: [
    {
      name: 'hzy-codocs',
      cwd: '/opt/huizhi-yun/codocs',
      script: '.output/server/index.mjs',
      env: {
        NODE_ENV: 'production',
        ...loadEnv('/opt/huizhi-yun/codocs')
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/pm2/hzy-codocs-error.log',
      out_file: '/var/log/pm2/hzy-codocs-out.log'
    },
    {
      name: 'hzy-slidev',
      cwd: '/opt/huizhi-yun/slidev/slidev-service',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        ...loadEnv('/opt/huizhi-yun/slidev')
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      kill_timeout: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/pm2/hzy-slidev-error.log',
      out_file: '/var/log/pm2/hzy-slidev-out.log'
    }
  ]
}
