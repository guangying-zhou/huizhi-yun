import test from 'node:test'
import assert from 'node:assert/strict'
import { modulePath as aimsPath } from '../../aims/layer/modulePath.mjs'
import { modulePath as assetsPath } from '../../assets/layer/modulePath.mjs'
for (const [module, path] of [['aims', aimsPath], ['assets', assetsPath]]) {
  test(`${module} preserves standalone paths and prefixes Host only once`, () => {
    assert.equal(path(module, false, '/api/v1/products'), '/api/v1/products')
    assert.equal(path(module, true, '/api/v1/products'), `/${module}/api/v1/products`)
    assert.equal(path(module, true, `/${module}/products`), `/${module}/products`)
    assert.throws(() => path(module, true, module === 'aims' ? '/assets/products' : '/aims/products'), /Cross-module/)
    assert.throws(() => path(module, true, '//evil.example'), /local module/)
  })
}
