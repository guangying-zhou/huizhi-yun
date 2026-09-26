import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deriveBusinessApiSurface, routeFromFile } from '../composition/business-api-surface.mjs'
import { isBusinessApiPath, isBusinessApiReady } from '../composition/business-api-readiness.mjs'
import { businessApiPrefixes, businessApiRoutes } from '../composition/business-api-routes.generated.mjs'
import { generatedPath, renderBusinessApiRoutes } from '../scripts/generate-business-api-readiness.mjs'

const surface = deriveBusinessApiSurface()
const sample = route => route.split('/').map(segment =>
  segment.startsWith('**') ? 'rest/path' : segment.startsWith(':') ? (/id$/i.test(segment) ? '123' : 'sample-code') : segment).join('/')

test('generated readiness surface stays in sync with the registered route files', () => {
  assert.equal(
    readFileSync(generatedPath, 'utf8'),
    renderBusinessApiRoutes(surface),
    'Business API routes changed; run `pnpm --dir enterprise generate:api-readiness`'
  )
})

test('every registered Host route passes readiness instead of reporting the module unavailable', () => {
  assert.ok(surface.routes.length > 0)
  const blocked = surface.routes
    .filter(({ method, route }) => isBusinessApiPath(sample(route)) && !isBusinessApiReady(method, sample(route)))
    .map(({ method, route, file }) => `${method} ${route} (${file})`)
  assert.deepEqual(blocked, [], `Registered routes rejected by the readiness boundary:\n${blocked.join('\n')}`)
})

test('readiness covers every module prefix that owns registered routes', () => {
  for (const { route } of surface.routes) {
    assert.ok(isBusinessApiPath(sample(route)), `${route} is not behind the readiness boundary`)
  }
  assert.deepEqual([...businessApiPrefixes], surface.prefixes)
})

test('unknown and not-yet-migrated module endpoints stay denied', () => {
  for (const path of [
    '/aims/api/v1/not-migrated',
    '/aims/api/v1/projects/123/not-migrated',
    '/assets/api/v1/overview',
    '/assets/api/v1/technology-bases/7',
    '/api/workflow-proxy/tasks/123/delegate',
    '/altoc/api/v1/contracts',
    '/aims/api'
  ]) {
    assert.ok(isBusinessApiPath(path), `${path} must sit behind the boundary`)
    assert.equal(isBusinessApiReady('GET', path), false, `${path} must not be reported ready`)
  }
})

test('readiness binds a method to its own handler and never widens a prefix', () => {
  // A registered GET list must not make an unregistered DELETE on the same path look ready.
  assert.equal(isBusinessApiReady('GET', '/aims/api/v1/work-items'), true)
  assert.equal(isBusinessApiReady('DELETE', '/aims/api/v1/work-items'), false)
  assert.equal(isBusinessApiReady('GET', '/aims/api/v1/projects'), true)
  assert.equal(isBusinessApiReady('PATCH', '/aims/api/v1/projects'), false)
  // Path traversal and nested extensions of a ready route are not themselves ready.
  assert.equal(isBusinessApiReady('GET', '/aims/api/v1/projects/../secrets'), false)
  assert.equal(isBusinessApiReady('GET', '/aims/api/v1/projects/123/extra'), false)
})

test('routes outside a business module prefix bypass the readiness boundary', () => {
  for (const path of ['/api/auth/session', '/shell/aims', '/login', '/']) {
    assert.equal(isBusinessApiPath(path), false)
  }
})

test('file route derivation follows Nitro method, index and parameter conventions', () => {
  assert.deepEqual(routeFromFile('aims/api/v1/work-items/index.get.ts'), { method: 'GET', route: '/aims/api/v1/work-items' })
  assert.deepEqual(routeFromFile('aims/api/v1/work-items/[id].put.ts'), { method: 'PUT', route: '/aims/api/v1/work-items/:id' })
  assert.deepEqual(routeFromFile('assets/api/v1/products/[...rest].ts'), { method: 'ALL', route: '/assets/api/v1/products/**:rest' })
})

test('the pages the Host registers are served by a ready endpoint', () => {
  // Regression for the readiness drift that left shipped Aims and Assets pages on 503.
  for (const [method, path] of [
    ['POST', '/aims/api/v1/projects'],
    ['GET', '/aims/api/v1/work-items'],
    ['GET', '/aims/api/v1/work-items/123'],
    ['POST', '/aims/api/v1/work-items/123/start'],
    ['POST', '/aims/api/v1/work-items/123/completion'],
    ['GET', '/aims/api/v1/timesheet'],
    ['GET', '/aims/api/v1/weekly-reports'],
    ['GET', '/aims/api/v1/projects/123/members'],
    ['GET', '/assets/api/v1/digital-assets'],
    ['GET', '/assets/api/v1/digital-assets/123']
  ]) {
    assert.equal(isBusinessApiReady(method, path), true, `${method} ${path} must be served, not reported unavailable`)
  }
  assert.ok(businessApiRoutes.length >= surface.routes.length)
})
