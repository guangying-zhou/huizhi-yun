const { readFileSync } = require('fs')
const { resolve } = require('path')

/**
 * 解析 .env 文件，返回键值对对象
 * @param {string} dir 模块目录的绝对路径
 * @returns {Record<string, string>}
 */
function loadEnv(dir) {
  const envPath = resolve(dir, '.env')
  const env = {}
  try {
    readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
      line = line.trim()
      if (!line || line.startsWith('#')) return
      const eqIndex = line.indexOf('=')
      if (eqIndex === -1) return
      const key = line.slice(0, eqIndex).trim()
      const value = line.slice(eqIndex + 1).trim()
      env[key] = value
    })
  } catch (e) {
    console.warn(`[PM2] Warning: could not read ${envPath}:`, e.message)
  }
  return env
}

module.exports = {
  apps: [
    {
      name: 'hzy-workflow',
      cwd: '/opt/huizhi-yun/workflow',
      script: '.output/server/index.mjs',
      env: {
        NODE_ENV: 'production',
        PORT: '3020',
        NITRO_PORT: '3020',
        NITRO_HOST: '127.0.0.1',
        ...loadEnv('/opt/huizhi-yun/workflow')
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/pm2/hzy-workflow-error.log',
      out_file: '/var/log/pm2/hzy-workflow-out.log'
    }
  ]
}
