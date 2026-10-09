import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8')
function middlewareFunction(name: string) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0)
  const end = source.indexOf('\n}', start)
  const compiled = ts.transpileModule(source.slice(start, end + 2), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return vm.runInNewContext(`${compiled}\n${name}`) as (...args: unknown[]) => unknown
}

test('summary service route forwards GET only with its exact Assets capability', () => {
  const route = '/service/products/P1/version-summaries'
  const forward = middlewareFunction('isServiceContractRuntimePath')
  assert.equal(forward(route, 'GET'), true)
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal(forward(route, method), false)
  const requirement = middlewareFunction('serviceCapabilityRequirement')(route, 'GET')
  assert.deepEqual(JSON.parse(JSON.stringify(requirement)), { scope: 'aims:product-version-summary:read', allowedApps: ['assets'] })
  assert.equal(middlewareFunction('scopeFor')({ suffix: route, method: 'GET' }), 'aims.read aims:product-version-summary:read')
})
