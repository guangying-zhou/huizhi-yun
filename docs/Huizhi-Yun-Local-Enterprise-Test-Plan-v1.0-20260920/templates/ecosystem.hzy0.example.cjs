// PM2 结构样例，不是当前已实现的启动程序。
// 必须先实现主方案 LET-01 的 run-process.mjs/doctor，完成身份与配置预检。
// 仅启动新前端栈；不列入 Runtime、数据库、Caddy 或 cloudflared。
// 在净化的启动环境及独立 PM2_HOME 中使用；不要从生产 shell 继承秘密。
const fs = require('node:fs')
const path = require('node:path')

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`Missing reviewed configuration: ${name}`)
  return value
}
function existingAbsolute(name) {
  const value = required(name)
  if (!path.isAbsolute(value) || !fs.existsSync(value)) {
    throw new Error(`${name} must be an existing absolute path`)
  }
  return value
}

const root = existingAbsolute('HZY0_REPO_ROOT')
const profile = existingAbsolute('HZY0_PROFILE_FILE')
const node = existingAbsolute('HZY0_NODE_BIN')
const mode = required('HZY0_MODE')
if (!['dev', 'node'].includes(mode)) throw new Error('HZY0_MODE must be dev or node')
const runner = path.join(root, 'deploy/test-env/local-enterprise/run-process.mjs')
if (!fs.existsSync(runner)) throw new Error('LET-01 runner is not implemented; do not start this example')

module.exports = {
  apps: ['gateway', 'console', 'enterprise'].map(app => ({
    name: `hzy0-${app}`,
    cwd: root,
    script: runner,
    interpreter: node,
    args: ['--app', app, '--profile', profile, '--mode', mode],
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    autorestart: true,
    min_uptime: 10000,
    max_restarts: 5,
    restart_delay: 2000,
    kill_timeout: 10000,
    env: {
      HZY_APP_RUN_MODE: 'test',
      HZY_PLATFORM_ENVIRONMENT: 'test',
      HZY_DEV_APPLICATIONS_ENABLED: 'false',
      HZY_LOCAL_DEV_APPLICATIONS_ENABLED: 'false',
      HZY_LOCAL_DEV_RUNTIME_BYPASS: 'false',
      HZY_DEV_RUNTIME_BYPASS: 'false',
      HZY_CONSOLE_DEV_POLICY_BYPASS: 'false',
      CONSOLE_DEV_POLICY_BYPASS: 'false'
    }
  }))
}
// runner 应从已通过预检的 profile 选定真实进程/参数、密钥引用和最小 env，
// 按需配置 Console（不能无视身份阶段），并转发信号/清理子进程。
// 上面的 env 不是完整安全隔离；PM2 守护进程自身也必须由净化环境启动。
