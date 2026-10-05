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

describe('Altoc recommended role split', () => {
  test('sales, contract management, approval and admin roles remain separated', () => {
    assert.equal(permissions('altoc:sales').includes('altoc:contract:admin'), false)
    assert.equal(permissions('altoc:sales').includes('altoc:contract:approve'), false)
    assert.equal(permissions('altoc:sales').includes('altoc:settings:admin'), false)

    assert.equal(permissions('altoc:contract_manager').includes('altoc:contract:edit'), true)
    assert.equal(permissions('altoc:contract_manager').includes('altoc:receivable:confirm'), true)
    assert.equal(permissions('altoc:contract_manager').includes('altoc:contract:approve'), false)
    assert.equal(permissions('altoc:contract_manager').includes('altoc:settings:admin'), false)

    assert.equal(permissions('altoc:contract_approver').includes('altoc:quotation:approve'), true)
    assert.equal(permissions('altoc:contract_approver').includes('altoc:contract:approve'), true)
    assert.equal(permissions('altoc:contract_approver').some(permission => permission.endsWith(':admin')), false)

    assert.equal(permissions('altoc:admin').includes('altoc:settings:admin'), true)
    assert.equal(permissions('altoc:admin').includes('altoc:contract:finance-summary:sync'), true)
  })

  test('platform seed no longer grants sales director altoc admin', () => {
    const seed = readFileSync(
      new URL('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql', import.meta.url),
      'utf8'
    )

    assert.match(seed, /\('sales_director', 'altoc:sales', 10\)/)
    assert.match(seed, /\('sales_director', 'altoc:contract_manager', 20\)/)
    assert.match(seed, /\('sales_director', 'altoc:contract_approver', 30\)/)
    assert.doesNotMatch(seed, /\('sales_director', 'altoc:admin',/)
    assert.match(seed, /\('system_admin', 'altoc:admin', 50\)/)
  })
})
