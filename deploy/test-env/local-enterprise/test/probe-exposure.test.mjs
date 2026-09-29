import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveBusinessApiSurface } from '../../../../enterprise/composition/business-api-surface.mjs'
import { enterpriseHostRoutes } from '../../enterprise-host-routes.mjs'
import { assess, concretePath, nonLoopbackIpv4, routePlan } from '../probe-exposure.mjs'

test('route inventory covers every registered page and API without sending write methods', () => {
  const surface = deriveBusinessApiSurface()
  const { pages, apis } = routePlan(surface, enterpriseHostRoutes)
  assert.equal(pages.length, Object.values(enterpriseHostRoutes).flat().length)
  assert.equal(apis.length, surface.routes.length)
  assert.ok(pages.every(row => row.probeMethod === 'HEAD'))
  assert.ok(apis.every(row => ['GET', 'HEAD', 'OPTIONS'].includes(row.probeMethod)))
  assert.ok(apis.filter(row => !['GET', 'HEAD'].includes(row.registeredMethod)).every(row => row.probeMethod === 'OPTIONS'))
  assert.ok([...pages, ...apis].every(row => !row.path.includes(':') && !row.path.includes('**')))
  assert.throws(() => routePlan({ routes: surface.routes.slice(1) }, enterpriseHostRoutes), /registration drift/)
})

test('probe classification identifies exposed listeners and HTML masquerading as API JSON', () => {
  assert.equal(assess({ group: 'LE-A05 tcp', target: 'loopback', reachable: true }), 'designed')
  assert.equal(assess({ group: 'LE-A05 tcp', target: 'non-loopback', reachable: true }), 'EXPOSED')
  assert.equal(assess({ group: 'LE-A05 path', status: 403 }), 'denied')
  assert.equal(assess({ group: 'LE-A06 public', status: 302, accessRedirect: true }), 'outer-protected')
  assert.equal(assess({ group: 'LE-A06 public', status: 302, accessRedirect: false }), 'REVIEW')
  assert.equal(assess({ group: 'LE-A11 api', status: 200, contentType: 'text/html' }), 'HTML-AS-API')
  assert.equal(assess({ group: 'LE-A11 negative', status: 308, expected: [308] }), 'passed')
  assert.equal(concretePath('/codocs/documents/:uuid'), '/codocs/documents/00000000-0000-4000-8000-000000000000')
  assert.equal(nonLoopbackIpv4({ lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }], en: [{ family: 'IPv4', internal: false, address: '192.0.2.1' }] }), '192.0.2.1')
})
