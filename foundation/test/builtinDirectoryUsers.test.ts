import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getBuiltinDirectoryUser,
  splitBuiltinDirectoryUids
} from '../server/utils/builtinDirectoryUsers.ts'

test('内置目录身份：system 在本地解析，不转发 Console Directory', () => {
  const user = getBuiltinDirectoryUser('system')

  assert.equal(user?.uid, 'system')
  assert.equal(user?.realName, '系统')
})

test('内置目录身份：批量解析拆分 system 和真实用户 uid', () => {
  const result = splitBuiltinDirectoryUids(['system', 'u1', 'system', '', 'u2'])

  assert.deepEqual(result.builtinUsers.map(user => user.uid), ['system'])
  assert.deepEqual(result.externalUids, ['u1', 'u2'])
})

// WizBiz migration W2, prerequisite 2: the unassigned-owner marker.
test('内置目录身份：system:unassigned 本地解析为“未分配”，不转发 Console Directory', async () => {
  const { UNASSIGNED_OWNER_UID, UNASSIGNED_OWNER_LABEL, isReservedDirectorySubject } = await import('../shared/utils/reservedDirectorySubject.ts')
  const user = getBuiltinDirectoryUser(UNASSIGNED_OWNER_UID)
  assert.equal(user?.uid, 'system:unassigned')
  assert.equal(user?.realName, UNASSIGNED_OWNER_LABEL)
  assert.equal(user?.displayName, '未分配')
  assert.equal(user?.status, 0, 'not a usable account: selectors skip status 0')

  const result = splitBuiltinDirectoryUids(['u1', 'system:unassigned', 'System:Unassigned', 'u2'])
  assert.deepEqual(result.externalUids, ['u1', 'u2'], 'the marker never reaches Console')
  assert.ok(result.builtinUsers.every(entry => entry.uid === 'system:unassigned'))

  for (const uid of ['system', 'system:unassigned', 'SYSTEM:x', 'client:aims.runtime', ' client:x ']) assert.equal(isReservedDirectorySubject(uid), true, uid)
  for (const uid of ['zhang.san', 'systematic', 'clientele', '', null, undefined]) assert.equal(isReservedDirectorySubject(uid), false, String(uid))
})

test('保留主体不能登录、不能被授权、不进入人员选择器', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  // Not a session subject: a verified context carrying a reserved uid yields no uid (401).
  const identity = read('../server/utils/authIdentity.ts')
  assert.match(identity, /return isReservedDirectorySubject\(uid\) \? '' : uid/)
  // Not an authorization subject: both loaders refuse before any lookup,
  // including the local-development shortcut.
  const authorization = read('../server/utils/platformBundleAuthorization.ts')
  const snapshot = authorization.slice(authorization.indexOf('export async function loadAuthorizationSnapshotFromConsoleRuntime('))
  assert.ok(snapshot.indexOf('rejectReservedAuthorizationSubject(uid)') > 0)
  assert.ok(snapshot.indexOf('rejectReservedAuthorizationSubject(uid)') < snapshot.indexOf('shouldUseLocalDevAuthorization('))
  const scoped = authorization.slice(authorization.indexOf('export async function loadScopedAuthorizationFromConsoleRuntime('))
  assert.ok(scoped.indexOf('rejectReservedAuthorizationSubject(uid)') > 0)
  assert.ok(scoped.indexOf('rejectReservedAuthorizationSubject(uid)') < scoped.indexOf('getConsoleRuntimeConfig('))
  assert.match(authorization, /statusCode: 403, message: '该主体不能被授权'/)
  // Not selectable and never submitted, but shown as the current value.
  const selector = read('../app/components/UserTreeSelector.vue')
  assert.match(selector, /if \(isReservedDirectorySubject\(u\.uid\)\) continue/)
  assert.match(selector, /const selectable = uids\.filter\(uid => !isReservedDirectorySubject\(uid\) && availableUserMap\.value\.has\(uid\)\)/)
  assert.match(selector, /realName: uid === UNASSIGNED_OWNER_UID \? UNASSIGNED_OWNER_LABEL : uid/)
  assert.match(selector, /if \(!isActiveDirectoryUser\(u.status\)\) continue/)
})
