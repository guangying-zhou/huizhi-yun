import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { parseManifestPermissionString } from '../server/utils/appManifestPermission.ts'

describe('parseManifestPermissionString', () => {
  test('parses app:resource:action permission strings', () => {
    assert.deepEqual(
      parseManifestPermissionString('altoc:dashboard:view', 'altoc', 'altoc:viewer', 0),
      { appCode: 'altoc', resourceCode: 'dashboard', action: 'view' }
    )
  })

  test('keeps colon-delimited sensitive action suffixes as part of action', () => {
    assert.deepEqual(
      parseManifestPermissionString('altoc:contract:finance-summary:sync', 'altoc', 'altoc:admin', 17),
      { appCode: 'altoc', resourceCode: 'contract', action: 'finance-summary:sync' }
    )
    assert.deepEqual(
      parseManifestPermissionString('altoc:service_ticket:delivery-result:sync', 'altoc', 'altoc:admin', 25),
      { appCode: 'altoc', resourceCode: 'service_ticket', action: 'delivery-result:sync' }
    )
  })

  test('rejects malformed permission strings', () => {
    assert.throws(() => parseManifestPermissionString('altoc:contract', 'altoc', 'altoc:admin', 0), /must use app:resource:action/)
    assert.throws(() => parseManifestPermissionString('altoc:contract:', 'altoc', 'altoc:admin', 0), /must use app:resource:action/)
    assert.throws(() => parseManifestPermissionString('altoc:contract::sync', 'altoc', 'altoc:admin', 0), /must use app:resource:action/)
  })

  test('rejects permissions for another app', () => {
    assert.throws(
      () => parseManifestPermissionString('aims:projects:view', 'altoc', 'altoc:admin', 0),
      /appCode mismatch: expected altoc, got aims/
    )
  })
})
