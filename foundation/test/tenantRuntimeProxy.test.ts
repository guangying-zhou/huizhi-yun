import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('tenantRuntimeProxy context', () => {
  test('exposes trusted request body to scope and query resolvers', () => {
    const content = source('server/utils/tenantRuntimeProxy.ts')

    assert.match(content, /body\?: Record<string, unknown>/)
    // 必须走 readRequestBodyCompat：h3 readBody 在 Cloudflare 上会让带 body 的
    // DELETE 永久挂起（Nitro 只缓冲 POST/PUT/PATCH）。
    assert.match(content, /const rawBody = method === 'GET' \? undefined : await readRequestBodyCompat\(event\)/)
    assert.doesNotMatch(content, /\bawait readBody\(event\)/)
    assert.match(content, /context\.body = includeCurrentUser \? \(body as Record<string, unknown>\) : bodyRecord/)
    assertBefore(content, 'context.body = includeCurrentUser', 'const query = options.resolveQuery')
    assertBefore(content, 'context.body = includeCurrentUser', 'const scope = options.resolveScope')
  })
})
