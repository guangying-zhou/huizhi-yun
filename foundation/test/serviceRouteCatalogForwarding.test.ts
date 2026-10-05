import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { forwardedServiceRouteCatalogHeader } from '../server/utils/serviceRouteCatalog.ts'
import { trustedServiceRequestHeaders } from '../server/utils/serviceOidc.ts'

const originalRuntimeConfig = (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig
afterEach(() => {
  if (originalRuntimeConfig === undefined) delete (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig
  else (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig = originalRuntimeConfig
})

const TOKEN = 'gateway-shared-secret'
const CATALOG = JSON.stringify({ console: { origin: 'http://127.0.0.1:31001', deploymentCode: 'C000001-console', basePath: '/console/' } })

function eventWith(headers: Record<string, string>) {
  ;(globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig = () => ({ hzy: { tenantGateway: { internalToken: TOKEN } } })
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return { context: {}, node: { req: { headers: lower } }, headers: new Headers(lower) } as never
}
const trusted = { 'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': TOKEN, 'x-hzy-tenant': 'C000001', 'x-hzy-app-code': 'enterprise' }

describe('service route catalog forwarding to Console', () => {
  test('a trusted Gateway request passes the catalog on byte-for-byte', () => {
    assert.deepEqual(forwardedServiceRouteCatalogHeader(eventWith({ ...trusted, 'x-hzy-service-routes': CATALOG })), { 'x-hzy-service-routes': CATALOG })
  })

  test('no catalog header means nothing is added', () => {
    assert.deepEqual(forwardedServiceRouteCatalogHeader(eventWith(trusted)), {})
  })

  test('a request that did not pass the trusted Gateway check never forwards the catalog (forged or missing token)', () => {
    assert.deepEqual(forwardedServiceRouteCatalogHeader(eventWith({ ...trusted, 'x-hzy-gateway-token': 'forged', 'x-hzy-service-routes': CATALOG })), {})
    assert.deepEqual(forwardedServiceRouteCatalogHeader(eventWith({ 'x-hzy-service-routes': CATALOG })), {})
    assert.deepEqual(forwardedServiceRouteCatalogHeader(eventWith({ ...trusted, 'x-hzy-gateway': 'other', 'x-hzy-service-routes': CATALOG })), {})
  })

  test('an invalid, non-object or oversized catalog on a trusted request is refused with 503', () => {
    for (const bad of ['not json', '[]', 'null', '"text"', '', JSON.stringify({ pad: 'x'.repeat(16_400) })]) {
      assert.throws(() => forwardedServiceRouteCatalogHeader(eventWith({ ...trusted, 'x-hzy-service-routes': bad })), (error: unknown) => (error as { statusCode?: number }).statusCode === 503, `refuses ${bad.slice(0, 12)}`)
    }
  })

  test('the service-token path (trustedServiceRequestHeaders) keeps forwarding it through the same helper', () => {
    const headers = trustedServiceRequestHeaders(eventWith({ ...trusted, 'x-hzy-service-routes': CATALOG }))
    assert.equal(headers['x-hzy-service-routes'], CATALOG)
  })

  test('every builder that calls Console with the source app gateway context uses the shared helper', () => {
    const read = (file: string) => readFileSync(new URL(`../server/utils/${file}`, import.meta.url), 'utf8')
    for (const file of ['consoleOidc.ts', 'consoleSessionBridge.ts', 'consoleRuntime.ts', 'subjectEligibility.ts', 'platformBundleAuthorization.ts']) {
      const source = read(file)
      assert.match(source, /from '\.\/serviceRouteCatalog'/, `${file} imports the helper`)
      assert.match(source, /forwardedServiceRouteCatalogHeader\(event\)/, `${file} calls the helper`)
    }
    assert.match(read('serviceOidc.ts'), /from '\.\/serviceRouteCatalog'/)
    assert.doesNotMatch(read('serviceOidc.ts'), /JSON\.parse\(catalog\)/, 'the catalog validation lives in one place')
  })
})
