import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runCheck } from '../check-collab-deployment.mjs'
import {
  COLLAB_APP_CODE, COLLAB_DEPLOYMENT_ROUTE, COLLAB_GATEWAY_PATHS, COLLAB_MANIFEST_PATH, COLLAB_RELEASE_TAG_PREFIX,
  assertCollabRouteMatchesManifest, checkCollabDeploymentAgreement, collabDeploymentCode, readCollabManifest
} from '../collab-deployment.mjs'
import { collabGrantItems, g7ExpectedGrants, validateCollabBindings, validateG7Bindings } from '../../../console/scripts/g7-prod-grant-catalog.mjs'
import { validateConfig } from '../gateway/config.mjs'
import { rawConfig } from '../gateway/test/fixtures.mjs'

const base = dirname(dirname(fileURLToPath(import.meta.url)))
const repo = join(base, '../..')

test('registered route and manifest handling come from collab/app.manifest.json', () => {
  assert.equal(COLLAB_APP_CODE, readCollabManifest().appCode)
  assert.equal(COLLAB_MANIFEST_PATH, `${COLLAB_APP_CODE}/app.manifest.json`)
  assert.equal(COLLAB_RELEASE_TAG_PREFIX, `${COLLAB_APP_CODE}/`)
  assert.ok(assertCollabRouteMatchesManifest())
  assert.deepEqual([...COLLAB_GATEWAY_PATHS], ['/codocs/ws', '/collab/*'])
  assert.throws(() => assertCollabRouteMatchesManifest({ appCode: 'collab', entry: { web: '/collab/', apiBase: '/api/v1/other' } }), /COLLAB_ROUTE_API_BASE_DRIFT/)
  assert.throws(() => assertCollabRouteMatchesManifest({ appCode: 'collab', entry: { web: '/x/', apiBase: COLLAB_DEPLOYMENT_ROUTE.apiBase } }), /COLLAB_ROUTE_BASE_PATH_DRIFT/)
})

test('G-7 and collab.runtime bindings default to and enforce the registered code', () => {
  assert.equal(collabDeploymentCode('C000001'), 'C000001-collab')
  assert.deepEqual(validateCollabBindings({ tenant: 'C000001' }).deployments, { collab: 'C000001-collab' })
  assert.deepEqual(collabGrantItems({ tenant: 'C000001' }).map(item => item.deployment), ['C000001-collab', 'C000001-collab'])
  const full = { tenant: 'C000001', deployments: { enterprise: 'C000001-prod-enterprise', workflow: 'C000001-workflow', aims: 'C000001-aims', codocs: 'C000001-codocs', console: 'C000001-console' } }
  assert.equal(g7ExpectedGrants(validateG7Bindings(full)).length, 34)
  const withCollab = { ...full, deployments: { ...full.deployments, collab: collabDeploymentCode('C000001') } }
  assert.equal(g7ExpectedGrants(withCollab).length, 36)
  assert.throws(() => g7ExpectedGrants({ ...full, deployments: { ...full.deployments, collab: 'C000001-collab-2' } }), /reviewed production deployment code/)
})

test('gateway config accepts only the registered collab code and the example carries a placeholder for it', async () => {
  const example = JSON.parse(await readFile(join(base, 'gateway/gateway.config.example.json'), 'utf8'))
  assert.match(example.apps.collab.deploymentCode, /^REPLACE_/)
  const ok = rawConfig({ apps: { console: { origin: 'http://127.0.0.1:1', deploymentCode: 'T900001-sh-console' }, collab: { origin: 'http://127.0.0.1:31007', deploymentCode: 'T900001-collab' } } })
  assert.equal(validateConfig(ok).apps.collab.deploymentCode, 'T900001-collab')
  ok.apps.collab.deploymentCode = 'T900001-collab-x'
  assert.throws(() => validateConfig(ok), /apps\.collab\.deploymentCode/)
})

test('drift across platform, gateway, G-7, collab registration and runtime binding is detected', () => {
  const files = {
    '/gw.json': { site: { tenantCode: 'C000001' }, apps: { collab: { origin: 'http://127.0.0.1:31007', deploymentCode: 'C000001-collab' } } },
    '/g7.json': { bindings: { tenant: 'C000001', deployments: { collab: 'C000001-collab' } } },
    '/collab.json': { bindings: { tenant: 'C000001' } }
  }
  const read = path => files[path]
  const good = runCheck({ tenant: 'C000001', platform: 'C000001-collab', gateway: '/gw.json', g7: '/g7.json', 'collab-registration': '/collab.json', 'runtime-binding': 'C000001-collab' }, read)
  assert.deepEqual([good.ok, good.drift.length, good.expected], [true, 0, 'C000001-collab'])
  for (const [name, values, mutate] of [
    ['runtimeBinding', { 'runtime-binding': 'C000001-prod-collab' }],
    ['platform', { platform: 'C000001-collab-old' }],
    ['gateway', {}, () => { files['/gw.json'].apps.collab.deploymentCode = 'C000002-collab' }],
    ['g7', {}, () => { files['/g7.json'].bindings.deployments.collab = 'C000001-collab2' }],
    ['collabRegistrationTenant', {}, () => { files['/collab.json'].bindings.tenant = 'C000002' }]
  ]) {
    mutate?.()
    const result = runCheck({ tenant: 'C000001', gateway: '/gw.json', g7: '/g7.json', 'collab-registration': '/collab.json', ...values }, read)
    assert.equal(result.ok, false, name)
    assert.ok(result.drift.some(item => item.source === name), name)
    files['/gw.json'].apps.collab.deploymentCode = 'C000001-collab'
    files['/g7.json'].bindings.deployments.collab = 'C000001-collab'
    files['/collab.json'].bindings.tenant = 'C000001'
  }
  // An unpinned gateway is legal but reported.
  files['/gw.json'].apps.collab = { origin: 'http://127.0.0.1:31007' }
  const unpinned = runCheck({ tenant: 'C000001', gateway: '/gw.json' }, read)
  assert.equal(unpinned.ok, true)
  assert.match(unpinned.notes[0], /not pinned/)
  assert.throws(() => checkCollabDeploymentAgreement({ tenant: 'C000001', sources: { platform: 'x' } }), /COLLAB_DEPLOYMENT_DRIFT:platform/)
})

test('docs point to the registration tool and the runtime env template stays consistent', async () => {
  const readme = await readFile(join(base, 'platform-bootstrap/README.md'), 'utf8')
  assert.match(readme, /g9-collab-deployment\.mjs/)
  assert.match(readme, /check-collab-deployment\.mjs/)
  const gatewayReadme = await readFile(join(base, 'gateway/README.md'), 'utf8')
  assert.match(gatewayReadme, /\$\{tenant\}-collab|<tenant>-collab/)
  assert.ok((await readFile(join(repo, 'platform/scripts/g9-collab-deployment.mjs'), 'utf8')).includes('collab-deployment.mjs'))
})
