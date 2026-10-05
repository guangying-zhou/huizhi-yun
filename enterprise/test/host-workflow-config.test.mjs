import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HostWorkflowConfigError,
  parseLoopbackHttpOrigin,
  resolveEnterpriseHostWorkflowConfig
} from '../shared/host-workflow-config.mjs'

const enabled = origin => ({ HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED: 'true', HZY_ENTERPRISE_WORKFLOW_ORIGIN: origin })

test('Host Workflow is off by default and keeps the managed-cloud discovery path', () => {
  assert.deepEqual(resolveEnterpriseHostWorkflowConfig({}), { mode: 'discovery' })
  assert.deepEqual(resolveEnterpriseHostWorkflowConfig({ HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED: '' }), { mode: 'discovery' })
  assert.deepEqual(resolveEnterpriseHostWorkflowConfig({ HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED: 'false' }), { mode: 'disabled' })
  // Legacy hzy0 variables no longer switch anything on their own.
  assert.deepEqual(resolveEnterpriseHostWorkflowConfig({ HZY0_LOCAL_ENTERPRISE: 'true', HZY_WORKFLOW_API_URL: 'http://127.0.0.1:23140/workflow' }), { mode: 'discovery' })
})

test('Host Workflow accepts only an exact loopback HTTP origin with an explicit port', () => {
  assert.deepEqual(resolveEnterpriseHostWorkflowConfig(enabled('http://127.0.0.1:23140')),
    { mode: 'loopback', origin: 'http://127.0.0.1:23140', apiBaseUrl: 'http://127.0.0.1:23140/workflow' })
  assert.equal(resolveEnterpriseHostWorkflowConfig(enabled(' http://127.0.0.1:3020/ ')).apiBaseUrl, 'http://127.0.0.1:3020/workflow')
  assert.equal(resolveEnterpriseHostWorkflowConfig(enabled('http://[::1]:23140')).origin, 'http://[::1]:23140')
  for (const origin of [
    'https://127.0.0.1:23140', 'http://localhost:23140', 'http://10.0.0.8:23140', 'http://0.0.0.0:23140',
    'http://127.0.0.2:23140', 'http://127.1:23140', 'http://2130706433:23140', 'http://127.0.0.1',
    'http://127.0.0.1:80', 'http://user@127.0.0.1:23140', 'http://user:pass@127.0.0.1:23140',
    'http://127.0.0.1:23140/workflow', 'http://127.0.0.1:23140/workflow/', 'http://127.0.0.1:23140?x=1',
    'http://127.0.0.1:23140?', 'http://127.0.0.1:23140#frag', 'HTTP://127.0.0.1:23140', '//127.0.0.1:23140',
    'http://127.0.0.1:99999', 'workflow.huizhi.yun', 'https://workflow.huizhi.yun'
  ]) {
    assert.throws(() => resolveEnterpriseHostWorkflowConfig(enabled(origin)), HostWorkflowConfigError, origin)
  }
})

test('Host Workflow refuses ambiguous switches instead of guessing', () => {
  assert.throws(() => resolveEnterpriseHostWorkflowConfig({ HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED: 'true' }), /requires HZY_ENTERPRISE_WORKFLOW_ORIGIN/)
  for (const value of ['1', 'TRUE', 'yes', 'on']) {
    assert.throws(() => resolveEnterpriseHostWorkflowConfig({ HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED: value, HZY_ENTERPRISE_WORKFLOW_ORIGIN: 'http://127.0.0.1:23140' }), HostWorkflowConfigError, value)
  }
  for (const value of [undefined, 'false']) {
    assert.throws(() => resolveEnterpriseHostWorkflowConfig({ HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED: value, HZY_ENTERPRISE_WORKFLOW_ORIGIN: 'http://127.0.0.1:23140' }), /requires HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED=true/)
  }
  // Errors name the variable but never echo the configured value.
  assert.throws(() => parseLoopbackHttpOrigin('http://secret-user:secret-pass@10.0.0.8:1'), error => !String(error.message).includes('secret'))
})

test('Host Workflow wiring reads only the explicit configuration', () => {
  const nuxtConfig = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
  assert.match(nuxtConfig, /const hostWorkflow = resolveEnterpriseHostWorkflowConfig\(process\.env\)/)
  assert.match(nuxtConfig, /hostWorkflowEnabled: hostWorkflow\.mode === 'loopback'/)
  assert.match(nuxtConfig, /hostWorkflow\.mode === 'loopback' \? \{ workflowApiUrl: hostWorkflow\.apiBaseUrl \}/)
  const proxy = readFileSync(new URL('../server/utils/enterpriseWorkflowProxy.ts', import.meta.url), 'utf8')
  const plugin = readFileSync(new URL('../server/plugins/host-workflow-config.ts', import.meta.url), 'utf8')
  for (const source of [nuxtConfig, proxy, plugin]) {
    assert.doesNotMatch(source, /HZY_WORKFLOW_API_URL|hostWorkflowEnabled: process\.env\.HZY0/)
  }
  assert.doesNotMatch(proxy, /HZY0_|23140/)
  assert.match(plugin, /resolveEnterpriseHostWorkflowConfig\(process\.env\)/)
})

test('the historical test-tenant OIDC callback fallback is limited to test builds', () => {
  const nuxtConfig = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
  assert.match(nuxtConfig, /const testPilotFallback = pilot && \['', 'test'\]\.includes\(String\(process\.env\.HZY_PLATFORM_ENVIRONMENT \|\| ''\)\.trim\(\)\.toLowerCase\(\)\)/)
  assert.match(nuxtConfig, /\(testPilotFallback \? 'https:\/\/hzy-test\.huizhi\.yun\/enterprise\/api\/auth\/oidc-callback' : ''\)/)
  assert.match(nuxtConfig, /\(testPilotFallback \? 'https:\/\/hzy-test\.huizhi\.yun\/enterprise\/login' : ''\)/)
  assert.doesNotMatch(nuxtConfig, /\(pilot \? 'https:\/\/hzy-test/)
})
