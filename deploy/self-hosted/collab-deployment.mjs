// Single source for the standalone Collab deployment identity in the production
// Platform (user decision 2026-09-29: register `${tenant}-collab` as a formal
// deployment record). Consumed by the G-9 Platform registration, the Gateway
// config validator, and the G-7 / collab.runtime grant plans, so the code and
// the route can only be changed in one place. Pure: no I/O beyond the manifest.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const COLLAB_APP_CODE = 'collab'
// Collab has its own app.manifest.json and platform_applications row (v2.32
// monorepo cutover); nothing is invented for it, the registry just points at it.
export const COLLAB_MANIFEST_PATH = 'collab/app.manifest.json'
export const COLLAB_RELEASE_TAG_PREFIX = 'collab/'
export const COLLAB_DEPLOYMENT_ROUTE = Object.freeze({ basePath: '/collab/', apiBase: '/api/v1/collab', routeSource: 'platform_override' })
// What the Gateway lets through to loopback Collab (websocket only).
export const COLLAB_GATEWAY_PATHS = Object.freeze(['/codocs/ws', '/collab/*'])

export function collabDeploymentCode(tenant) {
  assert.match(String(tenant || ''), /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/, 'COLLAB_TENANT_INVALID')
  return `${tenant}-collab`
}

export function readCollabManifest() {
  return JSON.parse(readFileSync(fileURLToPath(new URL('../../collab/app.manifest.json', import.meta.url)), 'utf8'))
}

// The registered route must equal the manifest entry, so the manifest stays the
// technical source of truth and the Platform row cannot drift from it.
export function assertCollabRouteMatchesManifest(manifest = readCollabManifest()) {
  assert.equal(manifest.appCode, COLLAB_APP_CODE, 'COLLAB_MANIFEST_APP_CODE')
  assert.equal(manifest.entry?.web, COLLAB_DEPLOYMENT_ROUTE.basePath, 'COLLAB_ROUTE_BASE_PATH_DRIFT')
  assert.equal(manifest.entry?.apiBase, COLLAB_DEPLOYMENT_ROUTE.apiBase, 'COLLAB_ROUTE_API_BASE_DRIFT')
  return true
}

/**
 * Compare every place that names the Collab deployment. Each source is optional
 * (undefined = not supplied / not enabled); a supplied value must equal the
 * registered `${tenant}-collab`. Returns the drift list; throws when non-empty
 * unless `strict` is false.
 */
export function checkCollabDeploymentAgreement({ tenant, sources }, { strict = true } = {}) {
  const expected = collabDeploymentCode(tenant)
  const drift = Object.entries(sources || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== expected)
    .map(([name, value]) => ({ source: name, expected, actual: String(value) }))
  if (strict) assert.deepEqual(drift, [], `COLLAB_DEPLOYMENT_DRIFT:${drift.map(item => item.source).join(',')}`)
  return { expected, drift }
}
