import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collabDeploymentCode } from '../../deploy/self-hosted/collab-deployment.mjs'

export const G7_SOURCE = 'seed:g7-prod-service-grants'
export const G7_DOMAINS = Object.freeze(['aims', 'assets', 'codocs', 'altoc', 'console'])
const readiness = JSON.parse(readFileSync(new URL('../../deploy/test-env/enterprise-readiness.template.json', import.meta.url)))

function grant(client, app, deployment, audience, scope, source = G7_SOURCE, roleCodes) {
  const parts = scope.split(':')
  const action = scope === 'codocs.write' ? 'write' : parts.pop()
  const resource = scope === 'codocs.write' ? 'codocs' : parts.join(':')
  assert.ok(action && resource && /^[a-z0-9_.:-]+$/.test(scope))
  return { client, app, deployment, audience, scope, resource: ['data-runtime', 'tenant-runtime'].includes(audience) ? `${audience}:${resource}` : resource, action, source, ...(roleCodes ? { roleCodes } : {}) }
}

// These six physical rows predate G-7. Their per-row OSS restrictions and
// source are historical facts; only missing binding fields may be filled.
function codocsOssGrant(deployment, audience, resource, action, scope) {
  return { client: 'codocs.runtime', app: 'codocs', deployment, audience, scope,
    resource, action, source: G7_SOURCE, preserveExistingScope: true }
}

// Standalone Collab reaches the Codocs Runtime as `collab.runtime`. The two
// capabilities are exactly what collab/src/utils/v2-snapshots.ts requests
// (READ_CAPABILITY / PUBLISH_CAPABILITY) and what the Runtime route table in
// data-runtime/internal/server/codocs_collaboration_snapshots.go demands; they
// are declared by the codocs manifest, never invented here. Audience is
// `data-runtime` only: Collab never calls a tenant-runtime adapter.
export const COLLAB_CLIENT = 'collab.runtime'
export const COLLAB_CAPABILITIES = Object.freeze(['codocs:collaboration-snapshots:read', 'codocs:collaboration-snapshots:publish'])
const codocsManifest = JSON.parse(readFileSync(new URL('../../codocs/app.manifest.json', import.meta.url)))
for (const capability of COLLAB_CAPABILITIES) {
  const [app, resource, action] = capability.split(':')
  assert.ok(app === codocsManifest.appCode && codocsManifest.resources.some(item => item.code === resource && item.actions.includes(action)),
    `COLLAB_CAPABILITY_UNDECLARED:${capability}`)
}

// `collab` is optional so pre-collaboration G-7 plans keep their reviewHash.
export function validateG7Bindings(input) {
  assert.match(input.tenant || '', /^[A-Z][0-9]{6}$/)
  const keys = ['enterprise', 'workflow', 'aims', 'codocs', 'console', ...(input.deployments?.collab === undefined ? [] : ['collab'])]
  for (const key of keys) {
    assert.match(input.deployments?.[key] || '', /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/)
    const expected = key === 'enterprise' ? `${input.tenant}-prod-enterprise` : key === 'collab' ? collabDeploymentCode(input.tenant) : `${input.tenant}-${key}`
    assert.equal(input.deployments[key], expected, `${key} must use the reviewed production deployment code`)
  }
  assert.deepEqual(Object.keys(input.deployments).sort(), [...keys].sort(), 'unknown deployment binding')
  assert.equal(new Set(Object.values(input.deployments)).size, keys.length)
  return input
}

// Collab-only bindings for console/scripts/collab-prod-registration.mjs. A full
// G-7 binding object is accepted as well and validated as one.
export function validateCollabBindings(input) {
  assert.match(input?.tenant || '', /^[A-Z][0-9]{6}$/)
  if (Object.keys(input.deployments || {}).some(key => key !== 'collab')) return validateG7Bindings(input) && input
  // Defaults to the Platform-registered `${tenant}-collab` (G-9 g9-collab-deployment.mjs);
  // an explicit value must equal it, so drift from the registration is rejected.
  const bindings = Object.keys(input.deployments || {}).length ? input : { ...input, deployments: { collab: collabDeploymentCode(input.tenant) } }
  assert.deepEqual(Object.keys(bindings.deployments), ['collab'], 'collab deployment binding required')
  assert.equal(bindings.deployments.collab, collabDeploymentCode(bindings.tenant), 'collab must use the reviewed production deployment code')
  return bindings
}

export function collabGrantItems(input) {
  const bindings = validateCollabBindings(input)
  return COLLAB_CAPABILITIES.map(scope => grant(COLLAB_CLIENT, 'collab', bindings.deployments.collab, 'data-runtime', scope))
}

export function g7CollabGrants(bindings) {
  validateG7Bindings(bindings)
  return bindings.deployments.collab === undefined ? [] : collabGrantItems(bindings)
}

export function g7ExpectedGrants(bindings) {
  validateG7Bindings(bindings)
  const e = bindings.deployments.enterprise
  const w = bindings.deployments.workflow
  const a = bindings.deployments.aims
  const c = bindings.deployments.codocs
  const items = [
    ...G7_DOMAINS.map(domain => grant('enterprise.runtime', 'enterprise', e, 'data-runtime', `${domain}:enterprise-host:execute`)),
    grant('enterprise.runtime', 'enterprise', e, 'data-runtime', 'console:policy-bundle:read'),
    grant('enterprise.runtime', 'enterprise', e, 'console', 'console:authorization-role-holders:read', G7_SOURCE, ['project_director']),
    grant('enterprise.runtime', 'enterprise', e, 'workflow', 'workflow:proxy'),
    grant('enterprise.runtime', 'enterprise', e, 'notifications', 'notifications:publish'),
    ...readiness.externalServicePolicies.flatMap(policy => policy.capabilities.map(scope => grant('enterprise.runtime', 'enterprise', e, policy.audience, scope))),
    ...['data-runtime', 'tenant-runtime'].map(audience => grant('workflow.runtime', 'workflow', w, audience, 'workflow:integration_operation:execute')),
    ...['data-runtime', 'tenant-runtime'].flatMap(audience => ['aims:integration_operation:execute', 'aims:milestone-rollover:execute'].map(scope => grant('aims.runtime', 'aims', a, audience, scope))),
    grant('aims.runtime', 'aims', a, 'codocs', 'codocs:company-weekly-summary:publish'),
    // Codocs' existing Runtime call uses codocs.write; v1.54 created this physical grant.
    grant('codocs.runtime', 'codocs', c, 'data-runtime', 'codocs.write'),
    ...[['integration_config', 'view'], ['credential_vault', 'resolve']].flatMap(([resource, action]) => [
      codocsOssGrant(c, 'data-runtime', resource, action, `${resource}:${action}`),
      ...['data-runtime', 'tenant-runtime'].map(audience => codocsOssGrant(c, audience,
        `${audience}:${resource}`, action, `${audience}:${resource}:${action}`))
    ]),
    ...g7CollabGrants(bindings)
  ]
  assert.equal(items.length, 34 + (bindings.deployments.collab === undefined ? 0 : 2))
  assert.equal(new Set(items.map(item => `${item.client}|${item.resource}|${item.action}`)).size, items.length)
  assert.equal(items.filter(item => item.client === 'enterprise.runtime').length, 20)
  assert.ok(!items.some(item => item.scope === 'aims:notifications-due:execute'))
  return items
}

export function g7ScopeJson(item, tenant, prior = {}) {
  if (item.preserveExistingScope && Object.keys(prior).length > 0) {
    const next = { ...prior }
    for (const [key, value] of Object.entries({ tenantCode: tenant, deploymentCode: item.deployment,
      audience: item.audience, semanticScope: item.scope })) {
      if (next[key] === undefined || next[key] === null || next[key] === '') next[key] = value
    }
    return next
  }
  return { ...prior, source: item.source, tenantCode: tenant, deploymentCode: item.deployment,
    audience: item.audience, semanticScope: item.scope, ...(item.roleCodes ? { roleCodes: item.roleCodes } : {}) }
}
