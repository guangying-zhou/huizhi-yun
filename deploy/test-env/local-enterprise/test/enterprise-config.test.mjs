import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync('enterprise/nuxt.config.ts', 'utf8')

test('Enterprise pilot keeps its Cloudflare default but accepts an explicit local callback', () => {
  assert.match(source, /HZY_ENTERPRISE_OIDC_REDIRECT_URI/)
  assert.match(source, /HZY_ENTERPRISE_LOGOUT_REDIRECT_URI/)
  assert.match(source, /https:\/\/hzy-test\.huizhi\.yun\/enterprise\/api\/auth\/oidc-callback/)
  assert.match(source, /HZY_DEPLOYMENT_PUBLIC_URL/)
})

test('local runner selects tenant-runtime without enabling a development auth bypass', () => {
  const runner = readFileSync('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
  assert.match(runner, /HZY_DATA_ACCESS_MODE: 'tenant-runtime'/)
  assert.match(runner, /NUXT_PUBLIC_CODOCS_URL: `\$\{profile.publicOrigin\}\/codocs`/)
  assert.match(runner, /HZY_CONSOLE_TOKEN_URL: `\$\{profile.identity.canonicalIssuer\}\/oauth\/token`/)
  assert.match(runner, /HZY_LOCAL_DEV_RUNTIME_BYPASS: 'false'/)
  assert.match(runner, /HZY_DEV_RUNTIME_BYPASS: 'false'/)
})

test('local runner widens the Happy Eyeballs attempt budget for public egress', () => {
  const runner = readFileSync('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
  assert.match(runner, /NODE_OPTIONS: '--network-family-autoselection-attempt-timeout=1000'/)
})

test('only loopback local Workflow enables the exact Console eligibility deployment override', () => {
  const runner = readFileSync('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
  assert.match(runner, /profile\.runtime\.transportMode !== 'loopback' \|\| profile\.listeners\.workflow\.host !== '127\.0\.0\.1'/)
  assert.match(runner, /profile\.features\?\.workflowLocal === true\s*\? \{ HZY_CONSOLE_LOCAL_WORKFLOW_DEPLOYMENT: 'C000001-test-workflow-local' \}/)
})

test('Console receives the in-app notification guard only from the enabled private profile switch', () => {
  const runner = readFileSync('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
  const consoleRunner = runner.slice(runner.indexOf('function startConsole('), runner.indexOf('function processEnvironment('))
  assert.match(consoleRunner, /profile\.features\?\.notificationsInAppOnly === true\s*\? \{ HZY0_NOTIFICATIONS_IN_APP_ONLY: 'true' \}\s*: \{\}/)
})
