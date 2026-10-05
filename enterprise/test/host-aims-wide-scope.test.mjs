import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { auditHostAimsScopes } from '../scripts/audit-host-aims-scopes.mjs'

// All registered Host route roots, including composed handlers. No file or
// route exemption: the analysis follows symbol aliases/reexports, calls,
// auto-imported functions and literal dynamic imports. Legacy shared branches
// are skipped only when the Host call's actual typed bridge proves them dead.
test('all Host route transitive calls reject Aims wide scopes', () => {
  const audit = auditHostAimsScopes()
  assert.ok(audit.routes >= 400)
  assert.deepEqual(audit.unresolved, [])
  assert.deepEqual(audit.results, [])
})

test('a new scope through an imported alias is detected without a baseline exemption', () => {
  const file = resolve(import.meta.dirname, '../server/utils/enterpriseCodocsProjectDocument.ts')
  const source = readFileSync(file, 'utf8')
  const audit = auditHostAimsScopes({
    routeFilter: route => route.route === '/aims/api/v1/codocs/documents/:uuid/content',
    overrides: { [file]: source.replace('  setHeader(event,', '  await leaked(event)\n  setHeader(event,') + '\nfunction leaked(event: unknown) { return requestServiceAccessToken({scope: `aims.read`}) }\n' }
  })
  assert.ok(audit.results.some(row => row.scope === 'aims.read' && row.chain.some(edge => edge.includes('enterpriseCodocsProjectDocument.ts'))))
})

test('namespace imports and literal dynamic imports cannot conceal a physical wide scope', () => {
  const route = resolve(import.meta.dirname, '../server/routes/aims/api/v1/codocs/documents/[uuid]/content.get.ts')
  const helper = resolve(import.meta.dirname, '../server/utils/enterpriseCodocsProjectDocument.ts')
  const routeSource = `import * as owning from '~~/server/utils/enterpriseCodocsProjectDocument'; export default () => owning.leakedTest()`
  for (const source of [routeSource, `export default async () => (await import('~~/server/utils/enterpriseCodocsProjectDocument')).leakedTest()`]) {
    const audit = auditHostAimsScopes({
      routeFilter: r => r.route === '/aims/api/v1/codocs/documents/:uuid/content',
      overrides: { [route]: source, [helper]: `export function leakedTest() { return requestServiceAccessToken({ scope: 'data-runtime:aims:read' }) }` }
    })
    assert.ok(audit.results.some(r => r.scope === 'data-runtime:aims:read'))
  }
})

test('one safe call cannot hide a later legacy call to the same helper', () => {
  const route = resolve(import.meta.dirname, '../server/routes/aims/api/v1/codocs/documents/[uuid]/content.get.ts')
  const helper = resolve(import.meta.dirname, '../server/utils/enterpriseCodocsProjectDocument.ts')
  const audit = auditHostAimsScopes({
    routeFilter: r => r.route === '/aims/api/v1/codocs/documents/:uuid/content',
    overrides: {
      [route]: `import { leakedTest as call } from '~~/server/utils/enterpriseCodocsProjectDocument'; export default async () => { await call({}); return call() }`,
      [helper]: `export function leakedTest(bridge) { const scope = bridge ? 'aims:enterprise-host:execute' : 'aims.read'; return requestServiceAccessToken({scope}) }`
    }
  })
  assert.ok(audit.results.some(r => r.scope === 'aims.read'))
})
