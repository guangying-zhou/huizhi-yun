import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

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

test('Aims event-less summary delivery receives only the reviewed Codocs loopback and target binding', () => {
  const runner = readFileSync('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
  const aimsRunner = runner.slice(runner.indexOf('function startAims('), runner.indexOf('function startEnterprise('))
  let childEnv
  const start = runInNewContext(`(${aimsRunner})`, {
    root: '/fixture', values: { profile: '/fixture/profile.json' },
    processEnvironment: () => ({}), readLocalAimsClientSecret: () => 'fixture',
    spawn: (_command, _args, options) => { childEnv = options.env }
  })
  const profile = { features: { workflowLocal: true, companySummaryCodocsDelivery: true },
    runtime: { transportMode: 'loopback', canonicalEndpoint: 'https://runtime.example.test', expectedTenant: 'C000001', expectedRuntimeDeployment: 'R' },
    listeners: { aims: { host: '127.0.0.1', port: 23141 }, workflow: { port: 23140 }, codocsEditor: { port: 23130 }, gatewayInternal: { port: 23121 } },
    identity: { canonicalIssuer: 'https://console.example.test', codocsDeployment: 'C000001-test-codocs' }, publicOrigin: 'https://hzy0.isme.dev' }
  start(profile)
  assert.equal(childEnv.HZY_CODOCS_TARGET_DEPLOYMENT, 'C000001-test-codocs')
  assert.equal(childEnv.HZY_CODOCS_SERVICE_BASE_URL, 'http://127.0.0.1:23130/codocs')
  profile.features.companySummaryCodocsDelivery = false
  start(profile)
  assert.equal(Object.hasOwn(childEnv, 'HZY_CODOCS_TARGET_DEPLOYMENT'), false)
  assert.equal(Object.hasOwn(childEnv, 'HZY_CODOCS_SERVICE_BASE_URL'), false)
})

test('only loopback local Workflow enables the exact Console eligibility deployment override', () => {
  const runner = readFileSync('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
  assert.match(runner, /profile\.runtime\.transportMode !== 'loopback' \|\| profile\.listeners\.workflow\.host !== '127\.0\.0\.1'/)
  assert.match(runner, /profile\.features\?\.workflowLocal === true\s*\? \{ HZY_CONSOLE_LOCAL_WORKFLOW_DEPLOYMENT: 'C000001-test-workflow-local', HZY_CONSOLE_LOCAL_AIMS_DEPLOYMENT: 'C000001-test-aims',/)
  // The notification detail verifier call reaches the loopback Workflow listener, only in the same branch.
  assert.match(runner, /HZY_WORKFLOW_SERVICE_BASE_URL: `http:\/\/127\.0\.0\.1:\$\{profile\.listeners\.workflow\.port\}\/workflow` \}/)
})

test('Console receives the in-app notification guard only from the enabled private profile switch', () => {
  const runner = readFileSync('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
  const consoleRunner = runner.slice(runner.indexOf('function startConsole('), runner.indexOf('function processEnvironment('))
  assert.match(consoleRunner, /profile\.features\?\.notificationsInAppOnly === true\s*\? \{ HZY0_NOTIFICATIONS_IN_APP_ONLY: 'true' \}\s*: \{\}/)
  assert.match(consoleRunner, /profile\.features\?\.workflowLocal === true && profile\.features\?\.companySummaryCodocsDelivery === true\s*\? \{ HZY0_COMPANY_SUMMARY_CODOCS_DELIVERY: 'true' \}\s*: \{\}/)
})

test('Workflow receives both in-app guards only when its private notification switch is true', () => {
  const runner = readFileSync('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
  const workflowRunner = runner.slice(runner.indexOf('function startWorkflow('), runner.indexOf('function startAims('))
  let childEnv
  const start = runInNewContext(`(${workflowRunner})`, {
    root: '/fixture', values: { profile: '/fixture/profile.json' },
    processEnvironment: () => ({ NODE_ENV: 'development' }),
    readLocalWorkflowClientSecret: () => 'test-only-placeholder',
    spawn: (_command, _args, options) => { childEnv = options.env }
  })
  for (const notificationsInAppOnly of [true, false, undefined]) {
    start({ features: { workflowLocal: true, notificationsInAppOnly },
      runtime: { transportMode: 'loopback', canonicalEndpoint: 'https://runtime.example.test', expectedTenant: 'T', expectedRuntimeDeployment: 'R' },
      listeners: { workflow: { host: '127.0.0.1', port: 23140 }, aims: { port: 23141 }, gatewayInternal: { port: 23121 } },
      identity: { canonicalIssuer: 'https://console.example.test' }, publicOrigin: 'https://local.example.test' })
    for (const key of ['HZY0_LOCAL_ENTERPRISE', 'HZY0_NOTIFICATIONS_IN_APP_ONLY']) {
      if (notificationsInAppOnly === true) assert.equal(childEnv[key], 'true')
      else assert.equal(Object.hasOwn(childEnv, key), false)
    }
  }
})

test('hzy0 maps the Host Workflow switch to the explicit loopback configuration', async () => {
  const runner = readFileSync('deploy/test-env/local-enterprise/run-process.mjs', 'utf8')
  const enterpriseRunner = runner.slice(runner.indexOf('function startEnterprise('), runner.indexOf('function startConsole('))
  let childEnv
  const start = runInNewContext(`(${enterpriseRunner})`, {
    root: '/fixture', console: { error() {} },
    record: value => value, resolve: (...parts) => parts.join('/'),
    publicPolicyTrust: () => null,
    processEnvironment: () => ({ NODE_ENV: 'development' }),
    spawn: (_command, _args, options) => { childEnv = options.env }
  })
  const { resolveEnterpriseHostWorkflowConfig } = await import('../../../../enterprise/shared/host-workflow-config.mjs')
  const profile = workflowLocal => ({ features: { workflowLocal },
    listeners: { enterprise: { host: '127.0.0.1', port: 23120 }, workflow: { host: '127.0.0.1', port: 23140 }, gatewayInternal: { port: 23121 } },
    identity: { canonicalIssuer: 'https://console.example.test', policyBackend: 'runtime' }, publicOrigin: 'https://local.example.test' })
  start(profile(true), 'dev')
  assert.equal(childEnv.HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED, 'true')
  assert.equal(childEnv.HZY_ENTERPRISE_WORKFLOW_ORIGIN, 'http://127.0.0.1:23140')
  assert.equal(Object.hasOwn(childEnv, 'HZY_WORKFLOW_API_URL'), false)
  // Same Workflow base URL as the former HZY_WORKFLOW_API_URL override.
  assert.equal(resolveEnterpriseHostWorkflowConfig(childEnv).apiBaseUrl, 'http://127.0.0.1:23140/workflow')
  for (const workflowLocal of [false, undefined]) {
    start(profile(workflowLocal), 'dev')
    assert.equal(childEnv.HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED, 'false')
    assert.equal(Object.hasOwn(childEnv, 'HZY_ENTERPRISE_WORKFLOW_ORIGIN'), false)
    // Explicitly disabled: the bridge fails closed instead of using discovery.
    assert.deepEqual(resolveEnterpriseHostWorkflowConfig(childEnv), { mode: 'disabled' })
  }
})
