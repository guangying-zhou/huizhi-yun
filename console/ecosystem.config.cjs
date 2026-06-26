const fs = require('node:fs')
const path = require('node:path')

const appRoot = __dirname
const configuredEnvFile = process.env.HZY_CONSOLE_ENV_FILE || ''
const envFile = configuredEnvFile
  ? (path.isAbsolute(configuredEnvFile) ? configuredEnvFile : path.join(appRoot, configuredEnvFile))
  : path.join(appRoot, '.env')

function parseEnvFile(filePath, required) {
  if (!fs.existsSync(filePath)) {
    if (required) {
      throw new Error(`Console PM2 env file not found: ${filePath}`)
    }
    return {}
  }

  const env = {}
  const content = fs.readFileSync(filePath, 'utf8')

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) {
      continue
    }

    const key = line.slice(0, equalsIndex).trim()
    let value = line.slice(equalsIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1)
    }

    env[key] = value
  }

  return env
}

const fileEnv = parseEnvFile(envFile, Boolean(configuredEnvFile))
const appName = process.env.HZY_CONSOLE_PM2_NAME || fileEnv.HZY_CONSOLE_PM2_NAME || fileEnv.PM2_NAME || 'hzy-console-prod'
const host = process.env.HZY_CONSOLE_HOST || fileEnv.HOST || fileEnv.NITRO_HOST || '127.0.0.1'
const port = process.env.HZY_CONSOLE_PORT || fileEnv.PORT || fileEnv.NITRO_PORT || '3030'

module.exports = {
  apps: [
    {
      name: appName,
      cwd: appRoot,
      script: '.output/server/index.mjs',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        ...fileEnv,
        NODE_ENV: 'production',
        HOST: host,
        PORT: port,
        NITRO_HOST: host,
        NITRO_PORT: port
      },
      error_file: path.join(appRoot, `logs/${appName}-error.log`),
      out_file: path.join(appRoot, `logs/${appName}-out.log`),
      merge_logs: true,
      time: true
    }
  ]
}
