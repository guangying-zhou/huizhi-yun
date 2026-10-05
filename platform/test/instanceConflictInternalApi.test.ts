import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('instance conflict internal API', () => {
  test('is restricted to Platform internal callers and delegates to the shared explainer', () => {
    const content = source('server/api/platform/internal/authorization/instance-conflict-explain.post.ts')

    assert.match(content, /platformAccessScope !== 'internal'/)
    assert.match(content, /internal access required/)
    assert.match(content, /explainInstanceConflicts\(\{/)
    assert.match(content, /tenantCode: requireString\(body\.tenantCode, 'tenantCode'\)/)
    assert.match(content, /uid: requireString\(body\.uid, 'uid'\)/)
    assert.match(content, /appCode: requireString\(body\.appCode, 'appCode'\)/)
    assert.match(content, /resourceCode: requireString\(body\.resourceCode, 'resourceCode'\)/)
    assert.match(content, /action: requireString\(body\.action, 'action'\)/)
  })

  test('accepts object context and same-actor principals through POST body', () => {
    const content = source('server/api/platform/internal/authorization/instance-conflict-explain.post.ts')

    assert.match(content, /object: objectValue\(body\.object\)/)
    assert.match(content, /principals: principalValue\(body\.principals\)/)
    assert.match(content, /includeBaseline: booleanValue\(body\.includeBaseline, true\)/)
  })
})
