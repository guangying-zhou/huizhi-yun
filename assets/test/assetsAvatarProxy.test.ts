import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

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

describe('Assets avatar OSS proxy boundary', () => {
  test('avatar proxy normalizes query path before reading OSS', () => {
    const content = source('server/api/oss/avatar.ts')

    assert.match(content, /function normalizeAvatarObjectPath/)
    assert.match(content, /rawPath\.startsWith\('\/'\)/)
    assert.match(content, /rawPath\.includes\('\\\\'\)/)
    assert.match(content, /segment === '\.\.'/)
    assert.match(content, /AVATAR_SEGMENT_PATTERN\.test\(segment\)/)
    assert.match(content, /ALLOWED_AVATAR_EXTENSIONS\.has\(extension\)/)
    assert.match(content, /const normalizedAvatarPath = normalizeAvatarObjectPath\(query\.path\)/)
    assert.match(content, /const objectPath = `avatars\/\$\{normalizedAvatarPath\}`/)
    assert.match(content, /contentType\.toLowerCase\(\)\.startsWith\('image\/'\)/)
    assert.match(content, /X-Content-Type-Options/)
    assertBefore(content, 'normalizeAvatarObjectPath(query.path)', 'await client.get(objectPath)')
  })
})
