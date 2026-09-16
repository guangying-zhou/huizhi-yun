import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import type { H3Event } from 'h3'
import { requireTenantGatewaySchedulerRequest } from '../server/utils/tenantGatewayTrust'

test('policy sync signature binds path, tenant, deployment, environment and freshness', async () => {
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const previous = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => ({ security: { cloudflareInternalToken: 'key' } })
  const path = '/api/internal/policy-bundle/sync'
  const issuedAt = String(Date.now())
  const headers: Record<string, string> = {
    'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'key', 'x-hzy-scheduler': 'tenant-gateway',
    'x-request-id': 'sync-1', 'x-hzy-tenant': 'tenant-a', 'x-hzy-deployment': 'console-a',
    'x-hzy-app-code': 'console', 'x-hzy-environment': 'test', 'x-hzy-data-runtime-url': 'https://runtime.test',
    'x-forwarded-host': 'tenant.test', 'x-hzy-scheduler-issued-at': issuedAt
  }
  headers['x-hzy-scheduler-signature'] = createHmac('sha256', 'key').update([
    'POST', path, 'sync-1', 'tenant-a', 'console-a', 'console', 'test', 'https://runtime.test', 'tenant.test', issuedAt
  ].join('\n')).digest('hex')
  const event = (changes = {}) => ({ node: { req: { headers: { ...headers, ...changes } } }, context: {} }) as unknown as H3Event
  try {
    assert.equal((await requireTenantGatewaySchedulerRequest(event(), 'console', path)).tenant, 'tenant-a')
    for (const [key, value] of Object.entries({
      'x-hzy-gateway-token': 'wrong', 'x-hzy-tenant': 'tenant-b', 'x-hzy-deployment': 'console-b',
      'x-hzy-app-code': 'people', 'x-hzy-environment': 'prod', 'x-hzy-scheduler-issued-at': '1'
    })) await assert.rejects(requireTenantGatewaySchedulerRequest(event({ [key]: value }), 'console', path))
    await assert.rejects(requireTenantGatewaySchedulerRequest(event(), 'console'))
  } finally {
    if (previous) globals.useRuntimeConfig = previous
    else delete globals.useRuntimeConfig
  }
})
