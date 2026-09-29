#!/usr/bin/env node
// Candidate only. No network request is made unless invoked with an explicit
// owner-only configuration. Logs contain status/scope only, never credentials.
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { COLLAB_CAPABILITIES, COLLAB_CLIENT, g7ExpectedGrants, validateG7Bindings } from '../../console/scripts/g7-prod-grant-catalog.mjs'

const oldScopes = JSON.parse(readFileSync(new URL('../../console/docs/sql/Console-v2.28-enterprise-host-precise-scopes.json', import.meta.url))).scopes

export function prodProbeMatrix(bindings) {
  const positives = g7ExpectedGrants(bindings)
    .filter(item => item.client !== 'enterprise.runtime' || item.scope.endsWith(':enterprise-host:execute'))
    .map(({ client, app, deployment, audience, scope }) => ({ client, app, deployment, audience, scope, expected: 200 }))
  // Host, Workflow, Aims and Codocs Runtime, plus the existing Console policy read.
  positives.push({ client: 'console.runtime', app: 'console', deployment: bindings.deployments.console,
    audience: 'data-runtime', scope: 'console:policy-bundle:read', expected: 200 })
  positives.push({ client: 'enterprise.runtime', app: 'enterprise', deployment: bindings.deployments.enterprise,
    audience: 'console', scope: 'console:authorization-role-holders:read', expected: 200 })
  // 21 base + the two exact collab.runtime grants when a collab deployment is bound.
  assert.equal(positives.length, 21 + (bindings.deployments.collab === undefined ? 0 : 2))
  return [...positives, { client: 'aims.runtime', app: 'aims', deployment: bindings.deployments.aims,
    audience: 'data-runtime', scope: 'aims:notifications-due:execute', expected: 403 }]
}

// Standalone Collab: deny by audience, source, tenant, deployment, capability and
// client. Collab holds neither the Host delegation nor any tenant-runtime scope.
export function collabNegativeProbeMatrix(bindings) {
  const deployment = bindings.deployments.collab
  if (deployment === undefined) return []
  const base = { client: COLLAB_CLIENT, app: 'collab', deployment, audience: 'data-runtime', expected: 403 }
  return [
    ...COLLAB_CAPABILITIES.flatMap(scope => [
      ...['console', 'tenant-runtime'].map(audience => ({ case: `collab-wrong-audience-${audience}`, ...base, audience, scope })),
      { case: 'collab-wrong-source-app', ...base, app: 'codocs', scope },
      { case: 'collab-wrong-deployment', ...base, deployment: `${deployment}-other`, scope },
      { case: 'collab-wrong-tenant', ...base, tenant: 'C999999', scope },
      { case: 'enterprise-cannot-hold-collab-scope', client: 'enterprise.runtime', app: 'enterprise', deployment: bindings.deployments.enterprise, audience: 'data-runtime', scope, expected: 403 }
    ]),
    { case: 'collab-missing-capability', ...base, scope: 'codocs:collaboration-snapshots:admin' },
    { case: 'collab-host-delegation-denied', ...base, scope: 'codocs:enterprise-host:execute' },
    { case: 'collab-company-summary-denied', ...base, audience: 'codocs', scope: 'codocs:company-weekly-summary:publish' }
  ]
}

export function negativeProbeMatrix(bindings) {
  return [
    { case: 'missing-capability', client: 'enterprise.runtime', app: 'enterprise', deployment: bindings.deployments.enterprise, audience: 'data-runtime', scope: 'aims:scope-never-granted:execute', expected: 403 },
    { case: 'wrong-audience', client: 'workflow.runtime', app: 'workflow', deployment: bindings.deployments.workflow, audience: 'console', scope: 'workflow:integration_operation:execute', expected: 403 },
    { case: 'wrong-source-app', client: 'enterprise.runtime', app: 'aims', deployment: bindings.deployments.enterprise, audience: 'data-runtime', scope: 'aims:enterprise-host:execute', expected: 403 },
    { case: 'wrong-tenant', client: 'workflow.runtime', app: 'workflow', tenant: 'C999999', deployment: bindings.deployments.workflow, audience: 'data-runtime', scope: 'workflow:integration_operation:execute', expected: 403 },
    { case: 'wrong-deployment', client: 'workflow.runtime', app: 'workflow', deployment: `${bindings.deployments.workflow}-other`, audience: 'data-runtime', scope: 'workflow:integration_operation:execute', expected: 403 },
    { case: 'summary-missing-capability', client: 'aims.runtime', app: 'aims', deployment: bindings.deployments.aims, audience: 'codocs', scope: 'codocs:company-weekly-summary:missing', expected: 403 },
    { case: 'summary-wrong-audience', client: 'aims.runtime', app: 'aims', deployment: bindings.deployments.aims, audience: 'data-runtime', scope: 'codocs:company-weekly-summary:publish', expected: 403 },
    { case: 'summary-wrong-source', client: 'enterprise.runtime', app: 'enterprise', deployment: bindings.deployments.enterprise, audience: 'codocs', scope: 'codocs:company-weekly-summary:publish', expected: 403 },
    { case: 'summary-wrong-deployment', client: 'aims.runtime', app: 'aims', deployment: `${bindings.deployments.aims}-other`, audience: 'codocs', scope: 'codocs:company-weekly-summary:publish', expected: 403 },
    ...['integration_config:view', 'credential_vault:resolve'].flatMap(scope => [
      { case: 'codocs-oss-wrong-audience', client: 'codocs.runtime', app: 'codocs', deployment: bindings.deployments.codocs, audience: 'console', scope, expected: 403 },
      { case: 'codocs-oss-wrong-source', client: 'codocs.runtime', app: 'aims', deployment: bindings.deployments.codocs, audience: 'data-runtime', scope, expected: 403 },
      { case: 'codocs-oss-wrong-deployment', client: 'codocs.runtime', app: 'codocs', deployment: `${bindings.deployments.codocs}-other`, audience: 'data-runtime', scope, expected: 403 }
    ]),
    ...oldScopes.flatMap(scope => ['data-runtime', 'tenant-runtime'].map(audience => ({ case: 'v2.28-revoked', client: 'enterprise.runtime', app: 'enterprise', deployment: bindings.deployments.enterprise, audience, scope, expected: 403 }))),
    ...collabNegativeProbeMatrix(bindings)
  ]
}

export function assertServiceTokenClaims(token, item, tenant, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = String(token).split('.')
  assert.equal(parts.length, 3, 'PROBE_JWT_SHAPE')
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  assert.equal(claims.token_use, 'service')
  assert.equal(claims.aud, item.audience)
  assert.equal(claims.scope, item.scope)
  assert.equal(claims.source_app, item.app)
  assert.equal(claims.tenant, tenant)
  assert.equal(claims.deployment, item.deployment)
  assert.ok(Number(claims.exp) > nowSeconds, 'PROBE_TOKEN_EXPIRED')
  return true
}

export async function runProdProbe(request, bindings, log = console.log, expiredRequest) {
  validateG7Bindings(bindings)
  assert.equal(typeof expiredRequest, 'function', 'PROBE_EXPIRED_TOKEN_REQUEST_REQUIRED')
  const positiveMatrix = prodProbeMatrix(bindings)
  const positives = positiveMatrix.filter(item => item.expected === 200).length
  const items = [...positiveMatrix, ...negativeProbeMatrix(bindings)]
  for (const item of items) {
    const response = await request(item)
    log(JSON.stringify({ case: item.case || 'positive', client: item.client, audience: item.audience, scope: item.scope,
      status: response.status, expected: item.expected }))
    assert.equal(response.status, item.expected, 'PROBE_STATUS_MISMATCH')
    if (response.status === 200) {
      const body = await response.json()
      assertServiceTokenClaims(body.access_token, item, bindings.tenant)
    }
  }
  const expired = await expiredRequest()
  log(JSON.stringify({ case: 'expired-token', status: expired.status, expected: 401 }))
  assert.equal(expired.status, 401, 'PROBE_EXPIRED_TOKEN_ACCEPTED')
  return { positives, denied: items.length - positives, expired: 1 }
}

function protectedJson(path) {
  const stat = statSync(path)
  assert.equal(stat.uid, process.getuid())
  assert.equal(stat.mode & 0o077, 0, 'PROBE_CONFIG_PERMISSIONS')
  return JSON.parse(readFileSync(path, 'utf8'))
}

function protectedText(path) {
  const file = resolve(path)
  const stat = statSync(file)
  assert.equal(stat.uid, process.getuid())
  assert.equal(stat.mode & 0o077, 0, 'PROBE_CREDENTIAL_PERMISSIONS')
  const value = readFileSync(file, 'utf8').trim()
  assert.ok(value, 'PROBE_CREDENTIAL_MISSING')
  return value
}

async function main() {
  assert.equal(process.argv[2], '--config')
  const config = protectedJson(resolve(process.argv[3]))
  const bindings = validateG7Bindings(config.bindings)
  assert.match(config.tokenEndpoint || '', /^https:\/\/[^/]+\/oauth\/token$/)
  assert.match(config.expiredTokenProbe?.url || '', /^https:\/\/[^/]+\//)
  for (const client of ['enterprise.runtime', 'workflow.runtime', 'aims.runtime', 'codocs.runtime', 'console.runtime',
    ...(bindings.deployments.collab === undefined ? [] : [COLLAB_CLIENT])])
    assert.ok(config.clientSecretFiles?.[client], 'PROBE_CREDENTIAL_FILE_MISSING')
  const secrets = Object.fromEntries(Object.entries(config.clientSecretFiles).map(([client, path]) =>
    [client, protectedText(path)]))
  const request = item => fetch(config.tokenEndpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${item.client}:${secrets[item.client]}`).toString('base64')}` },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: item.client, app_code: item.app,
      audience: item.audience, scope: item.scope, tenant_code: item.tenant || bindings.tenant,
      deployment_code: item.deployment, source_binding: 'service-client-policy' })
  })
  await runProdProbe(request, bindings, console.log, () => fetch(config.expiredTokenProbe.url, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${protectedText(config.expiredTokenProbe.tokenFile)}` }
  }))
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch(error => {
  console.error(`PROBE_STOPPED:${String(error?.message || error).replace(/[A-Za-z0-9._~-]{40,}/g, '[redacted]').slice(0, 120)}`)
  process.exitCode = 1
})
