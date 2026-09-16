import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

type ManifestRole = {
  code: string
  suggestedPermissions?: string[]
}

const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')) as {
  recommendedRoles: ManifestRole[]
}

function role(code: string) {
  const found = manifest.recommendedRoles.find(item => item.code === code)
  assert.ok(found, `missing recommended role ${code}`)
  return found
}

function permissions(code: string) {
  return role(code).suggestedPermissions || []
}

describe('Codocs recommended role split', () => {
  test('editor role does not include export or company asset maintenance duties', () => {
    assert.equal(permissions('codocs:editor').includes('codocs:documents:export'), false)
    assert.equal(permissions('codocs:editor').includes('codocs:company:edit'), false)
    assert.equal(permissions('codocs:editor').includes('codocs:reviews:submit'), true)
  })

  test('records manager, publisher, space admin and admin roles remain separated', () => {
    assert.equal(permissions('codocs:records_manager').includes('codocs:reviews:archive'), true)
    assert.equal(permissions('codocs:records_manager').includes('codocs:documents:export'), true)
    assert.equal(permissions('codocs:records_manager').includes('codocs:projects:export'), true)
    assert.equal(permissions('codocs:records_manager').some(permission => permission.endsWith(':admin')), false)
    assert.equal(permissions('codocs:records_manager').includes('codocs:company:publish'), false)
    assert.equal(permissions('codocs:records_manager').includes('codocs:reviews:approve'), false)

    assert.equal(permissions('codocs:publisher').includes('codocs:company:publish'), true)
    assert.equal(permissions('codocs:publisher').includes('codocs:reviews:approve'), true)
    assert.equal(permissions('codocs:publisher').some(permission => permission.endsWith(':admin')), false)

    assert.equal(permissions('codocs:space_admin').includes('codocs:documents:admin'), true)
    assert.equal(permissions('codocs:space_admin').includes('codocs:admin:admin'), false)
    assert.equal(permissions('codocs:space_admin').includes('codocs:reviews:approve'), false)

    assert.equal(permissions('codocs:admin').includes('codocs:admin:admin'), true)
    assert.equal(permissions('codocs:admin').includes('codocs:documents:delete'), true)
    assert.equal(permissions('codocs:admin').includes('codocs:projects:export'), true)
  })

  test('platform seed no longer grants records manager codocs admin', () => {
    const seed = readFileSync(
      new URL('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /\('records_manager', 'codocs:records_manager', 10\)/)
    assert.match(seed, /\('records_manager', 'workflow:approver', 20\)/)
    assert.doesNotMatch(seed, /\('records_manager', 'codocs:admin',/)
    assert.match(seed, /\('system_admin', 'codocs:admin', 30\)/)
  })

  test('platform seed keeps department manager out of Codocs publishing duties', () => {
    const seed = readFileSync(
      new URL('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql', import.meta.url),
      'utf8'
    )

    assert.doesNotMatch(seed, /\('department_manager', 'codocs:publisher',/)
  })
})
