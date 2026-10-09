import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parseManifestDefaultScopes } from '../server/utils/appManifestDefaultScopes.ts'
import { parseManifestPermissionString } from '../server/utils/appManifestPermission.ts'

const permissions = [
  { appCode: 'finance', resourceCode: 'expenses', action: 'view' },
  { appCode: 'finance', resourceCode: 'expenses', action: 'edit' },
  { appCode: 'finance', resourceCode: 'dashboard', action: 'view' }
]
const supported = ['tenant:global', 'subject:self']

test('default templates expand only to exact declared permissions and distinguish omission from clearing', () => {
  assert.equal(parseManifestDefaultScopes({}, permissions, supported), undefined)
  assert.deepEqual(parseManifestDefaultScopes({ defaultScopes: [] }, permissions, supported), [])
  const all = parseManifestDefaultScopes({ defaultScopes: ['tenant:global'] }, permissions, supported)!
  assert.equal(all.length, 3)
  assert.deepEqual(all.map(({ appCode, resourceCode, action }) => ({ appCode, resourceCode, action })), permissions)
  assert.ok(all.every(row => row.scopeType === 'tenant' && row.scopeValue === 'global'))
  const own = parseManifestDefaultScopes({ defaultScopes: [{ scope: 'subject:self', resourceCode: 'expenses' }] }, permissions, supported)!
  assert.deepEqual(own.map(row => row.action), ['view', 'edit'])
  assert.ok(own.every(row => row.resourceCode === 'expenses' && row.scopeType === 'subject'))
  assert.equal(parseManifestDefaultScopes({ defaultScopes: ['tenant:global', 'tenant:global'] }, permissions, supported)!.length, 3)
})

test('default scopes reject unknown templates, undeclared resources/actions and malformed broad authority', () => {
  for (const entry of [null, 'tenant:global', ['tenant:unknown'], ['tenant:*'], ['department:tree'], [{ scope: 'tenant:global', resourceCode: 'invoices' }], [{ scope: 'tenant:global', resourceCode: 'expenses', action: 'approve' }], [{ scope: 'tenant:global', resourceCode: '*' }], [{ scope: 'tenant:global', action: 'view' }], [{ scope: 'tenant:global', appCode: 'people' }]]) {
    assert.throws(() => parseManifestDefaultScopes({ defaultScopes: entry }, permissions, supported), { statusCode: 400 })
  }
  assert.throws(() => parseManifestDefaultScopes({ defaultScopes: ['tenant:global'] }, permissions, ['subject:self']), { statusCode: 400 })
})

test('approved Finance role matrix declares global admins, expenses-only self and no viewer default', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../finance/app.manifest.json', import.meta.url), 'utf8'))
  for (const role of manifest.recommendedRoles) {
    const permissions = role.suggestedPermissions.map((value: string, index: number) => parseManifestPermissionString(value, 'finance', role.code, index))
    const scopes = parseManifestDefaultScopes(role, permissions, manifest.supportedScopes)
    if (['finance:admin', 'finance:manager'].includes(role.code)) {
      assert.equal(scopes!.length, permissions.length)
      assert.ok(scopes!.every(row => row.scopeType === 'tenant' && row.scopeValue === 'global'))
    } else if (role.code === 'finance:expense_submitter') {
      assert.deepEqual(scopes!.map(row => row.resourceCode), ['expenses', 'expenses'])
      assert.ok(scopes!.every(row => row.scopeValue === 'self'))
    } else if (role.code === 'finance:viewer') assert.deepEqual(scopes, [])
    else assert.equal(scopes, undefined, role.code)
  }
})

test('Console v0.2.x recommended roles pass the import scope validator without broadening reporter permissions', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../console/app.manifest.json', import.meta.url), 'utf8'))
  for (const role of manifest.recommendedRoles) {
    const granted = role.suggestedPermissions.map((value: string, index: number) => parseManifestPermissionString(value, 'console', role.code, index))
    const scopes = parseManifestDefaultScopes(role, granted, manifest.supportedScopes)
    if (role.code === 'console:feedback_reporter') {
      assert.deepEqual(scopes, ['view', 'submit'].map(action => ({ appCode: 'console', resourceCode: 'feedback', action, scopeType: 'subject', scopeValue: 'self' })))
      // Reproduce v0.2.4: the same defaults fail when the vocabulary omits self.
      assert.throws(() => parseManifestDefaultScopes(role, granted, ['tenant:global']), { statusCode: 400 })
      assert.throws(() => parseManifestDefaultScopes({ ...role, defaultScopes: [{ scope: 'subject:self', resourceCode: 'feedback', action: 'admin' }] }, granted, manifest.supportedScopes), { statusCode: 400 })
    } else if (role.code === 'console:feedback_manager') {
      assert.equal(scopes!.length, granted.length)
      assert.ok(scopes!.every(row => row.scopeType === 'tenant' && row.scopeValue === 'global'))
    }
  }
})
