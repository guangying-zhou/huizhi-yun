import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { localCodocsSchedulerSignature } from '../server/utils/localCodocsSchedulerSignature'
import { schedulerRequestHeaders } from '../../deploy/cloudflare/tenant-gateway/src/index.js'

test('local Codocs signature envelope matches Gateway scheduler byte for byte', async () => {
  const secret = 'local-scheduler-test-secret-0123456789'
  const requestId = 'local-codocs-contract-1'
  const issuedAt = '1790620000000'
  const path = '/codocs/api/v1/service/company-weekly-summaries/2026-W40:publish'
  const origin = 'http://127.0.0.1:23130'
  const tenant = {
    tenantCode: 'C000001', environment: 'test', deploymentCode: 'C000001-test-codocs',
    apps: { codocs: { deploymentCode: 'C000001-test-codocs' } },
    dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev', audience: 'data-runtime' }
  }
  const gateway = await schedulerRequestHeaders({ HZY_TENANT_GATEWAY_INTERNAL_TOKEN: secret, HZY_CODOCS_ORIGIN: origin }, tenant,
    'hzy0.isme.dev', 'codocs', requestId, issuedAt, '', path)
  const local = await localCodocsSchedulerSignature({ secret, requestId, issuedAt, path, origin })
  assert.deepEqual([...local.entries()], [...gateway.entries()])
})

test('Aims server never imports deploy Gateway source into its Node build', () => {
  const source = readFileSync(new URL('../../aims/server/utils/localCodocsSchedulerHeaders.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /deploy\/cloudflare\/tenant-gateway/)
})
