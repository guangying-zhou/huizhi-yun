import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { collectBaselinePermissions } from '../server/utils/policyBundleBaseline.ts'

function permissionKeys(appCodes: string[]) {
  return collectBaselinePermissions(appCodes)
    .map(permission => `${permission.appCode}:${permission.resourceCode}:${permission.action}`)
    .sort()
}

describe('policy bundle baseline permissions', () => {
  test('does not grant Assets access to default users', () => {
    assert.deepEqual(permissionKeys(['assets']), [])
  })

  test('keeps employee self-service defaults for non-Assets apps', () => {
    assert.deepEqual(permissionKeys(['workflow', 'codocs', 'aims']), [
      'aims:aims_overview:view',
      'aims:notifications:view',
      'aims:projects:view',
      'aims:work_items:view',
      'codocs:company:view',
      'codocs:departments:create',
      'codocs:departments:edit',
      'codocs:departments:view',
      'codocs:documents:create',
      'codocs:documents:delete',
      'codocs:documents:edit',
      'codocs:documents:view',
      'codocs:info:view',
      'codocs:reviews:submit',
      'codocs:reviews:view',
      'workflow:workflow_instances:view',
      'workflow:workflow_tasks:edit',
      'workflow:workflow_tasks:view',
      'workflow:workflow_workspace:view'
    ])
  })
})
