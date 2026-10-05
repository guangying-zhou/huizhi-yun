import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

interface ManifestRole {
  code: string
  suggestedPermissions: string[]
}

function manifestRoles() {
  const content = readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')
  const manifest = JSON.parse(content) as { recommendedRoles: ManifestRole[] }
  return manifest.recommendedRoles
}

function permissions(code: string) {
  const role = manifestRoles().find(item => item.code === code)
  assert.ok(role, `${code} role must exist`)
  return role.suggestedPermissions
}

function platformSeed() {
  return readFileSync(
    new URL('../../platform/docs/sql/HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql', import.meta.url),
    'utf8'
  )
}

function mappedAppRoles(systemRoleCode: string) {
  const pattern = new RegExp(`\\('${systemRoleCode}', '([^']+)'`, 'g')
  return Array.from(platformSeed().matchAll(pattern), match => match[1])
}

function assertNoSensitiveActions(roleCode: string) {
  for (const permission of permissions(roleCode)) {
    assert.equal(permission.endsWith(':approve'), false, `${roleCode} should not include ${permission}`)
    assert.equal(permission.endsWith(':confirm'), false, `${roleCode} should not include ${permission}`)
    assert.equal(permission.endsWith(':admin'), false, `${roleCode} should not include ${permission}`)
  }
}

describe('Finance recommended role split', () => {
  test('declares focused finance operation roles', () => {
    for (const role of [
      'finance:expense_submitter',
      'finance:ar_accountant',
      'finance:ap_accountant',
      'finance:cashier',
      'finance:accountant',
      'finance:reconciliation_operator',
      'finance:invoice_approver',
      'finance:expense_approver',
      'finance:manager',
      'finance:report_viewer',
      'finance:admin'
    ]) {
      assert.ok(permissions(role).length > 0, `${role} should have suggested permissions`)
    }
  })

  test('daily accounting roles do not include approval, confirmation or admin actions', () => {
    for (const role of ['finance:expense_submitter', 'finance:ar_accountant', 'finance:ap_accountant', 'finance:accountant']) {
      assertNoSensitiveActions(role)
    }
  })

  test('confirmation duties are isolated from accounting and approval duties', () => {
    assert.ok(permissions('finance:cashier').includes('finance:receipts:confirm'))
    assert.ok(permissions('finance:cashier').includes('finance:expenses:confirm'))
    assert.equal(permissions('finance:cashier').includes('finance:expenses:approve'), false)
    assert.equal(permissions('finance:cashier').includes('finance:reconciliation:confirm'), false)

    assert.ok(permissions('finance:reconciliation_operator').includes('finance:reconciliation:confirm'))
    assert.equal(permissions('finance:reconciliation_operator').includes('finance:expenses:approve'), false)
    assert.equal(permissions('finance:reconciliation_operator').includes('finance:expenses:confirm'), false)
  })

  test('invoice issuance is explicit and separate from Workflow approval', () => {
    assert.ok(permissions('finance:ar_accountant').includes('finance:invoices:issue'))
    assert.equal(permissions('finance:invoice_approver').includes('finance:invoices:issue'), false)
    assert.equal(permissions('finance:manager').includes('finance:invoices:issue'), false)
    assert.ok(permissions('finance:admin').includes('finance:invoices:issue'))
  })

  test('finance manager is management scope but not an implicit approver or cashier', () => {
    const manager = permissions('finance:manager')

    assert.ok(manager.includes('finance:project_accounting:admin'))
    assert.ok(manager.includes('finance:reports:export'))
    assert.equal(manager.includes('finance:invoices:approve'), false)
    assert.equal(manager.includes('finance:expenses:approve'), false)
    assert.equal(manager.includes('finance:expenses:confirm'), false)
    assert.equal(manager.includes('finance:receipts:confirm'), false)
    assert.equal(manager.includes('finance:reconciliation:confirm'), false)
  })

  test('finance admin explicitly carries sensitive confirmation and approval actions', () => {
    const admin = permissions('finance:admin')

    for (const permission of [
      'finance:dashboard:export',
      'finance:invoices:approve',
      'finance:invoices:issue',
      'finance:receipts:confirm',
      'finance:expenses:approve',
      'finance:expenses:confirm',
      'finance:reconciliation:confirm',
      'finance:reports:export'
    ]) {
      assert.ok(admin.includes(permission), `finance:admin should include ${permission}`)
    }
  })

  test('platform default finance roles avoid cashier and reconciliation confirmation grants', () => {
    const director = mappedAppRoles('finance_director')
    const accountant = mappedAppRoles('finance_accountant')

    for (const role of ['finance:manager', 'finance:invoice_approver', 'finance:expense_approver', 'finance:report_viewer']) {
      assert.ok(director.includes(role), `finance_director should include ${role}`)
    }
    for (const role of ['finance:cashier', 'finance:reconciliation_operator', 'finance:admin']) {
      assert.equal(director.includes(role), false, `finance_director should not include ${role}`)
    }

    for (const role of ['finance:accountant', 'finance:ar_accountant', 'finance:ap_accountant']) {
      assert.ok(accountant.includes(role), `finance_accountant should include ${role}`)
    }
    for (const role of [
      'finance:cashier',
      'finance:reconciliation_operator',
      'finance:invoice_approver',
      'finance:expense_approver',
      'finance:manager',
      'finance:admin'
    ]) {
      assert.equal(accountant.includes(role), false, `finance_accountant should not include ${role}`)
    }
  })
})
