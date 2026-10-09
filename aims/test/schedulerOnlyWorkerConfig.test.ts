import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { schedulerWorkerConfig } from '../deploy/cloudflare/scheduler-worker-config.mjs'
import { isAimsSchedulerOnlyWake } from '../server/utils/schedulerOnlyIngress'

test('production and staging Aims drain Workers have no public ingress or own cron', () => {
  for (const [environment, worker] of [['production', 'hzy-aims'], ['staging', 'hzy-test-aims']] as const) {
    const config = schedulerWorkerConfig(environment)
    assert.equal(config.name, worker)
    assert.equal(config.workers_dev, false)
    assert.equal(config.preview_urls, false)
    assert.equal('routes' in config, false)
    assert.equal('route' in config, false)
    assert.equal('triggers' in config, false)
    assert.equal('assets' in config, false)
    assert.equal(config.vars.HZY_AIMS_SERVICE_CLIENT_ID, 'aims.runtime')
    assert.equal('NUXT_HZY_SCHEDULER_ONLY' in config.vars, false)
    assert.equal('HZY_AIMS_SCHEDULER_ONLY' in config.vars, false)
    assert.ok(config.services.some(service => service.binding === 'HZY_CONSOLE_SERVICE'))
  }
  const source = readFileSync(new URL('../server/api/internal/integration-operations/drain.post.ts', import.meta.url), 'utf8')
  assert.match(source, /requireTenantGatewaySchedulerRequest\(event, 'aims'\)/)
  const builder = readFileSync(new URL('../../deploy/build-pilot-artifacts.mjs', import.meta.url), 'utf8')
  assert.match(builder, /\['enterprise', 'console', 'workflow', 'aims'\]/)
  assert.match(builder, /schedulerWorkerConfig\(environment\)/)
  assert.match(builder, /wrangler\.aims-scheduler\.production\.jsonc/)
  assert.match(builder, /wrangler\.aims-scheduler\.staging\.jsonc/)
  assert.match(builder, /HZY_AIMS_SCHEDULER_ONLY: 'true'/)
  const middleware = readFileSync(new URL('../server/middleware/00-scheduler-only.ts', import.meta.url), 'utf8')
  assert.match(middleware, /useRuntimeConfig\(event\)\.hzy\.schedulerOnly/)
  assert.match(middleware, /isAimsSchedulerOnlyWake/)
  for (const pathname of ['/aims/', '/aims/projects', '/aims/api/v1/projects', '/api/v1/projects', '/_nuxt/asset.js']) {
    assert.equal(isAimsSchedulerOnlyWake('GET', pathname), false, pathname)
    assert.equal(isAimsSchedulerOnlyWake('POST', pathname), false, pathname)
  }
  assert.equal(isAimsSchedulerOnlyWake('GET', '/api/internal/integration-operations/drain'), false)
  assert.equal(isAimsSchedulerOnlyWake('POST', '/api/internal/integration-operations/drain'), true)
  assert.equal(isAimsSchedulerOnlyWake('POST', '/aims/api/internal/integration-operations/drain'), true)
})
