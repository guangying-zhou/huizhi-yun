import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source + '\nexport { shouldForwardAimsRuntime, isAllowedNuxtApiV1Path }', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const exports: any = {}
runInNewContext(compiled, { exports, require: () => ({}), defineEventHandler: (handler: unknown) => handler })

test('product BFF routes reach scoped handlers instead of generic runtime forwarding', () => {
  for (const suffix of ['/products', '/products/P001', '/products/P001/versions/1', '/products/P001/planning-cycles', '/product-permissions', '/product-candidates']) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      assert.equal(exports.shouldForwardAimsRuntime({ suffix, method }), false)
      assert.equal(exports.isAllowedNuxtApiV1Path('/api/v1' + suffix, method), true)
      assert.equal(exports.isAllowedNuxtApiV1Path('/aims/api/v1' + suffix, method), true)
    }
  }
})

test('unrelated and similarly named routes retain fail-closed routing', () => {
  for (const suffix of ['/products-internal', '/product-permissions-extra', '/unknown']) {
    assert.equal(exports.isAllowedNuxtApiV1Path('/api/v1' + suffix, 'GET'), false)
  }
})
