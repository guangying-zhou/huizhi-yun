import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getAuthorizationSimulationPermissionRestriction,
  isAuthorizationSimulationPermissionRestricted
} from '../server/utils/authorizationSimulationRestrictions.ts'

test('authorization simulation restrictions：允许普通读取', () => {
  assert.equal(isAuthorizationSimulationPermissionRestricted('directory_users', 'view'), false)
  assert.equal(isAuthorizationSimulationPermissionRestricted('credential_vault', 'view'), false)
  assert.equal(isAuthorizationSimulationPermissionRestricted('system_settings', 'view'), false)
  assert.equal(isAuthorizationSimulationPermissionRestricted('system_settings', 'edit'), false)
})

test('authorization simulation restrictions：拦截 Console 高危资源写入', () => {
  const credentialRestriction = getAuthorizationSimulationPermissionRestriction('credential_vault', 'edit')
  assert.equal(credentialRestriction?.resourceCode, 'credential_vault')
  assert.equal(credentialRestriction?.action, 'edit')

  const userRestriction = getAuthorizationSimulationPermissionRestriction('directory_users', 'admin')
  assert.equal(userRestriction?.resourceCode, 'directory_users')
  assert.equal(userRestriction?.action, 'admin')

  const runtimeRestriction = getAuthorizationSimulationPermissionRestriction('system_settings', 'admin')
  assert.equal(runtimeRestriction?.resourceCode, 'system_settings')
  assert.equal(runtimeRestriction?.action, 'admin')
})

test('authorization simulation restrictions：拦截通用敏感动作', () => {
  assert.equal(isAuthorizationSimulationPermissionRestricted('runtime_apps', 'deploy'), true)
  assert.equal(isAuthorizationSimulationPermissionRestricted('reports', 'export'), true)
  assert.equal(isAuthorizationSimulationPermissionRestricted('payments', 'pay'), true)
  assert.equal(isAuthorizationSimulationPermissionRestricted('settlements', 'reconcile'), true)
})

test('authorization simulation restrictions：不误伤普通业务编辑', () => {
  assert.equal(isAuthorizationSimulationPermissionRestricted('directory_projects', 'edit'), false)
  assert.equal(isAuthorizationSimulationPermissionRestricted('work_calendar', 'edit'), false)
  assert.equal(isAuthorizationSimulationPermissionRestricted('org_profile', 'edit'), false)
})
