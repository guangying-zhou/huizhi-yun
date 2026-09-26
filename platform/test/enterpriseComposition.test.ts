import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { enterpriseCompositionModules } from '../server/utils/enterpriseComposition.ts'

const fixture = () => JSON.parse(readFileSync(new URL('../../enterprise/app.manifest.json', import.meta.url), 'utf8'))
test('generated enterprise catalog preserves exact module definitions and namespaces', () => {
  const manifest = fixture()
  const result = enterpriseCompositionModules('enterprise', manifest)
  assert.deepEqual(result.map(item => item.appCode), ['aims', 'assets', 'codocs'])
  for (const item of result) assert.deepEqual(item.manifest, manifest.composition.modules.find((entry: { appCode: string }) => entry.appCode === item.appCode).manifest)
  assert.deepEqual(enterpriseCompositionModules('assets', { appCode: 'assets', resources: [] }), [])
})
test('composition rejects wrong host, duplicate modules, nested compositions and tampered catalog', () => {
  assert.throws(() => enterpriseCompositionModules('assets', fixture()))
  const mutations = [
    (m: ReturnType<typeof fixture>) => { m.composition.modules.push(m.composition.modules[0]) },
    (m: ReturnType<typeof fixture>) => { m.composition.modules[0].manifest.composition = {} },
    (m: ReturnType<typeof fixture>) => { m.composition.modules[0].manifest.resources[0].actions.push('admin') },
    (m: ReturnType<typeof fixture>) => { m.composition.permissionCatalog.resources.pop() },
    (m: ReturnType<typeof fixture>) => { m.composition.permissionCatalog.roles.pop() },
    (m: ReturnType<typeof fixture>) => { m.composition.permissionCatalog.permissionCodes.pop() },
    (m: ReturnType<typeof fixture>) => { m.composition.permissionCatalogHash = '0'.repeat(64) },
    (m: ReturnType<typeof fixture>) => { m.resources.push({ code: 'products', actions: ['admin'] }) },
    (m: ReturnType<typeof fixture>) => { m.composition.modules[0].appCode = 'platform' },
    (m: ReturnType<typeof fixture>) => { m.composition.registrationMode = 'flatten' }
  ]
  for (const mutate of mutations) {
    const manifest = fixture()
    mutate(manifest)
    assert.throws(() => enterpriseCompositionModules('enterprise', manifest), { statusCode: 400 })
  }
})
