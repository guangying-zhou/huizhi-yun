import test from 'node:test'
import assert from 'node:assert/strict'
import { fixRouteTable, fixHandler } from '../fix-platform-application-routes.mjs'

test('hotfix changes only the four application route namespaces', () => {
  const source = ['ops', 'admin', 'tenant-admin', '_handlers'].flatMap(scope =>
    ['', '', '', '/regenerate-secret'].map(suffix => `route: '/api/platform/${scope}/applications/:id${suffix}'`)).join('\n')
    + "\nroute: '/api/platform/ops/deployments/:id'"
  const result = fixRouteTable(source)
  assert.equal((result.match(/applications\/:appCode/g) || []).length, 16)
  assert.ok(result.includes("deployments/:id'"))
  assert.throws(() => fixRouteTable(result))
  assert.throws(() => fixRouteTable(source.replace('regenerate-secret', 'unexpected') + "\nroute: '/api/platform/ops/applications/:id'"))
})
test('compiled numeric ID parser keeps validation and only changes parameter name', () => {
  const source = 'const raw = getRouterParam(event, "id"); const id = Number(raw);'
  assert.equal(fixHandler(source), 'const raw = getRouterParam(event, "appCode"); const id = Number(raw);')
  assert.throws(() => fixHandler(source + source))
})
