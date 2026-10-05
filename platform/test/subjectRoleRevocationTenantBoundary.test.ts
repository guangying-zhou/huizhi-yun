import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('tenant-admin subject role revocation boundary', () => {
  test('requires middleware-selected tenant context before loading an assignment', () => {
    const content = source('server/api/platform/tenant-admin/subject-roles/[id].delete.ts')

    assert.match(content, /const tenantCode = String\(event\.context\.platformTenantCode \|\| ''\)\.trim\(\)/)
    assert.match(content, /message: 'tenant context is missing'/)
    assert.match(content, /WHERE id = \?\s+AND tenant_code = \?\s+LIMIT 1/)
    assert.match(content, /\[id, tenantCode\]/)
  })

  test('scopes the revocation update and response to the same tenant context', () => {
    const content = source('server/api/platform/tenant-admin/subject-roles/[id].delete.ts')

    assert.match(content, /SET status = 'revoked',[\s\S]*WHERE id = \?\s+AND tenant_code = \?/)
    assert.match(content, /tenantCode,\n\s*subjectId: result\.assignment\.subject_id/)
  })
})
