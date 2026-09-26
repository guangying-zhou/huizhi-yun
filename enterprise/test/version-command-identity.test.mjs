import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('standalone and Enterprise version-create routes share the owning command identity', () => {
  const standalone = source('aims/server/api/v1/products/[productCode]/versions/index.post.ts')
  const enterprise = source('enterprise/server/routes/aims/api/v1/products/[productCode]/versions/index.post.ts')
  const handler = source('aims/server/utils/productVersionRuntime.ts')
  const adapter = source('data-runtime/internal/apps/aims/product_center_versions.go')

  for (const route of [standalone, enterprise]) {
    assert.match(route, /handleProductVersionCollection\(event, 'create'/)
  }
  assert.match(enterprise, /from ['"]\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/aims\/server\/utils\/productVersionRuntime['"]/)
  assert.match(handler, /productCommandKey\(getHeader\(event, 'Idempotency-Key'\)\)/)
  assert.match(handler, /bridge\.call\(code, action, body, key \|\| undefined\)/)
  assert.match(handler, /idempotencyKey: key/)
  assert.match(adapter, /Action: "product_versions:create", IdempotencyKey: key/)
})
