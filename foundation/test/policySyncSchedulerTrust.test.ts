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

test('Aims unified wake binds storage and generation against removal or tampering', async () => {
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const previous = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => ({ security: { cloudflareInternalToken: 'key' } })
  const issuedAt = String(Date.now())
  const headers: Record<string, string> = {
    'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'key', 'x-hzy-scheduler': 'tenant-gateway',
    'x-request-id': 'wake-1', 'x-hzy-tenant': 'tenant-a', 'x-hzy-deployment': 'aims-a',
    'x-hzy-app-code': 'aims', 'x-hzy-environment': 'test', 'x-hzy-data-runtime-url': 'https://runtime.test',
    'x-forwarded-host': 'tenant.test', 'x-hzy-scheduler-issued-at': issuedAt,
    'x-hzy-scheduler-storage': 'unified', 'x-hzy-scheduler-generation': '7'
  }
  headers['x-hzy-scheduler-signature'] = createHmac('sha256', 'key').update([
    'POST', '/api/internal/integration-operations/drain', 'wake-1', 'tenant-a', 'aims-a', 'aims',
    'test', 'https://runtime.test', 'tenant.test', 'enterprise-scheduler-v1', 'unified', '7', issuedAt
  ].join('\n')).digest('hex')
  const event = (changes = {}) => ({ node: { req: { headers: { ...headers, ...changes } } }, context: {} }) as unknown as H3Event
  try {
    const verified = await requireTenantGatewaySchedulerRequest(event(), 'aims')
    assert.equal(verified.schedulerStorage, 'unified')
    assert.equal(verified.schedulerGeneration, '7')
    for (const changes of [
      { 'x-hzy-scheduler-generation': '8' }, { 'x-hzy-scheduler-storage': 'legacy' },
      { 'x-hzy-scheduler-storage': '', 'x-hzy-scheduler-generation': '' },
      { 'x-hzy-scheduler-generation': '0' }, { 'x-hzy-tenant': 'tenant-b' }
    ]) await assert.rejects(requireTenantGatewaySchedulerRequest(event(changes), 'aims'))
  } finally {
    if (previous) globals.useRuntimeConfig = previous
    else delete globals.useRuntimeConfig
  }
})

test('Aims recovered wake binds storage and generation against removal or tampering', async () => {
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const previous = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => ({ security: { cloudflareInternalToken: 'key' } })
  const issuedAt = String(Date.now())
  const headers: Record<string, string> = {
    'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'key', 'x-hzy-scheduler': 'tenant-gateway',
    'x-request-id': 'wake-1', 'x-hzy-tenant': 'tenant-a', 'x-hzy-deployment': 'aims-a',
    'x-hzy-app-code': 'aims', 'x-hzy-environment': 'test', 'x-hzy-data-runtime-url': 'https://runtime.test',
    'x-forwarded-host': 'tenant.test', 'x-hzy-scheduler-issued-at': issuedAt,
    'x-hzy-scheduler-storage': 'recovered', 'x-hzy-scheduler-generation': '7'
  }
  headers['x-hzy-scheduler-signature'] = createHmac('sha256', 'key').update([
    'POST', '/api/internal/integration-operations/drain', 'wake-1', 'tenant-a', 'aims-a', 'aims',
    'test', 'https://runtime.test', 'tenant.test', 'enterprise-scheduler-v1', 'recovered', '7', issuedAt
  ].join('\n')).digest('hex')
  const event = (changes = {}) => ({ node: { req: { headers: { ...headers, ...changes } } }, context: {} }) as unknown as H3Event
  try {
    const verified = await requireTenantGatewaySchedulerRequest(event(), 'aims')
    assert.equal(verified.schedulerStorage, 'recovered')
    assert.equal(verified.schedulerGeneration, '7')
    for (const changes of [
      { 'x-hzy-scheduler-generation': '8' }, { 'x-hzy-scheduler-storage': 'legacy' },
      { 'x-hzy-scheduler-storage': '', 'x-hzy-scheduler-generation': '' },
      { 'x-hzy-scheduler-generation': '0' }, { 'x-hzy-tenant': 'tenant-b' }
    ]) await assert.rejects(requireTenantGatewaySchedulerRequest(event(changes), 'aims'))
  } finally {
    if (previous) globals.useRuntimeConfig = previous
    else delete globals.useRuntimeConfig
  }
})

test('Assets unified wake binds storage and generation, and other apps cannot carry a selection', async () => {
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const previous = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => ({ security: { cloudflareInternalToken: 'key' } })
  const issuedAt = String(Date.now())
  const sign = (app: string, deployment: string) => createHmac('sha256', 'key').update([
    'POST', '/api/internal/integration-operations/drain', 'wake-1', 'tenant-a', deployment, app,
    'test', 'https://runtime.test', 'tenant.test', 'enterprise-scheduler-v1', 'unified', '9', issuedAt
  ].join('\n')).digest('hex')
  const headers = (app: string, deployment: string): Record<string, string> => ({
    'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'key', 'x-hzy-scheduler': 'tenant-gateway',
    'x-request-id': 'wake-1', 'x-hzy-tenant': 'tenant-a', 'x-hzy-deployment': deployment,
    'x-hzy-app-code': app, 'x-hzy-environment': 'test', 'x-hzy-data-runtime-url': 'https://runtime.test',
    'x-forwarded-host': 'tenant.test', 'x-hzy-scheduler-issued-at': issuedAt,
    'x-hzy-scheduler-storage': 'unified', 'x-hzy-scheduler-generation': '9',
    'x-hzy-scheduler-signature': sign(app, deployment)
  })
  const event = (base: Record<string, string>, changes = {}) => ({ node: { req: { headers: { ...base, ...changes } } }, context: {} }) as unknown as H3Event
  try {
    const assets = headers('assets', 'assets-a')
    const verified = await requireTenantGatewaySchedulerRequest(event(assets), 'assets')
    assert.equal(verified.schedulerStorage, 'unified')
    assert.equal(verified.schedulerGeneration, '9')
    for (const changes of [
      { 'x-hzy-scheduler-generation': '10' }, { 'x-hzy-scheduler-storage': 'legacy' },
      { 'x-hzy-scheduler-storage': '', 'x-hzy-scheduler-generation': '' }, { 'x-hzy-tenant': 'tenant-b' }
    ]) await assert.rejects(requireTenantGatewaySchedulerRequest(event(assets, changes), 'assets'))
    // An Assets wake cannot be replayed at the Aims handler, and apps without a
    // unified scheduler cannot carry a storage selection at all.
    await assert.rejects(requireTenantGatewaySchedulerRequest(event(assets), 'aims'))
    const altoc = headers('altoc', 'altoc-a')
    await assert.rejects(requireTenantGatewaySchedulerRequest(event(altoc), 'altoc'))
  } finally {
    if (previous) globals.useRuntimeConfig = previous
    else delete globals.useRuntimeConfig
  }
})
