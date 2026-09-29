const fs = require('node:fs')
const path = require('node:path')

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

const root = required('HZY0_REPO_ROOT')
const profile = required('HZY0_PROFILE_FILE')
const node = required('HZY0_NODE_BIN')
const mode = required('HZY0_MODE')
if (!path.isAbsolute(root) || !path.isAbsolute(profile) || !path.isAbsolute(node)) throw new Error('HZY0 paths must be absolute')
if (!fs.existsSync(path.join(root, 'deploy/test-env/local-enterprise/run-process.mjs'))) throw new Error('Local Enterprise runner is missing')
if (!['dev', 'node'].includes(mode)) throw new Error('HZY0_MODE must be dev or node')

const configuration = JSON.parse(fs.readFileSync(profile, 'utf8'))

module.exports = {
  apps: ['gateway', 'enterprise', 'codocs-editor', ...(configuration.identity.consoleFacadeMode === 'local-canonical-facade' ? ['console'] : []),
    ...(configuration.features?.codocsCollaborationV2 === true ? ['collab'] : []),
    ...(configuration.features?.workflowLocal === true ? ['workflow', 'aims'] : [])].map(app => ({
    name: `hzy0-${app}`,
    cwd: root,
    script: path.join(root, 'deploy/test-env/local-enterprise/run-process.mjs'),
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
