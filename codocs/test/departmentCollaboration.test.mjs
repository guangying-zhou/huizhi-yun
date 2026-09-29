import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  collaborationCloseKind,
  departmentCollaborationDisabledStatus,
  departmentCollaborationFailureText,
  departmentCollaborationView,
  hostCollaborationTicketRequest,
  versionHistoryRequests
} from '../layer/departmentCollaboration.mjs'

const base = {
  enabled: true, canEdit: true, converted: false, requested: false, phase: 'idle', failure: '',
  connecting: false, connected: false, synced: false, scope: null, hasError: false, closeKind: null, collaborators: 0
}
const view = change => departmentCollaborationView({ ...base, ...change })

test('nothing is offered outside a hosted, enabled department document', () => {
  assert.deepEqual(view({ enabled: false }), { entry: 'hidden', status: null, notice: null })
})

test('a user without the server-side writer hint only reads the latest published version', () => {
  const result = view({ canEdit: false, converted: true })
  assert.equal(result.entry, 'hidden')
  assert.equal(result.status.label, '只读查看')
  assert.equal(result.notice, null)
  // Read-only members get no session even if the page were driven as requested.
  assert.equal(view({ canEdit: false, requested: true, connected: true, synced: true }).entry, 'hidden')
  assert.notEqual(view({ canEdit: false, requested: true, connected: true, synced: true }).status.label, '协同中')
})

test('a writer sees the collaboration entry, with a conversion warning until the document is converted', () => {
  const first = view({})
  assert.equal(first.entry, 'start')
  assert.match(first.status.description, /转为协作格式/)
  const converted = view({ converted: true })
  assert.equal(converted.entry, 'start')
  assert.equal(converted.status.label, '可协作编辑')
})

test('conversion, connecting, syncing and active states', () => {
  assert.deepEqual([view({ requested: true, phase: 'converting' }).entry, view({ requested: true, phase: 'converting' }).status.label], ['busy', '正在转换'])
  assert.deepEqual([view({ requested: true, connecting: true }).entry, view({ requested: true, connecting: true }).status.label], ['busy', '协同连接中'])
  assert.equal(view({ requested: true, connected: true, synced: false }).status.label, '同步中')
  const active = view({ requested: true, connected: true, synced: true, scope: 'read-write', collaborators: 2 })
  assert.deepEqual([active.entry, active.status.tone, active.status.label], ['hidden', 'success', '协同中'])
  assert.match(active.status.description, /2 位成员/)
  assert.equal(view({ requested: true, connected: true, synced: true, scope: 'readonly' }).status.label, '仅可查看')
})

test('failures offer a retry with the reason instead of a silent fallback', () => {
  const failed = view({ requested: true, phase: 'failed', failure: '文档近期有人在旧版协作中编辑，请等待几分钟后再试' })
  assert.deepEqual([failed.entry, failed.status.tone, failed.status.description], ['retry', 'warning', '文档近期有人在旧版协作中编辑，请等待几分钟后再试'])
  const errored = view({ requested: true, hasError: true, failure: '当前协作人数已达上限，请稍后再试' })
  assert.deepEqual([errored.entry, errored.status.description], ['retry', '当前协作人数已达上限，请稍后再试'])
  assert.equal(view({ requested: true }).entry, 'retry', 'a dropped connection can be retried')
})

test('revoked access and a closed room end collaboration with a notice and no retry', () => {
  const revoked = view({ requested: true, connected: false, closeKind: 'revoked', canEdit: true })
  assert.equal(revoked.entry, 'hidden')
  assert.equal(revoked.notice.tone, 'warning')
  assert.match(revoked.notice.title, /失去编辑权限/)
  assert.match(revoked.notice.description, /复制/)
  const closed = view({ requested: true, closeKind: 'closed' })
  assert.equal(closed.entry, 'hidden')
  assert.match(closed.notice.title, /已关闭/)
  assert.match(closed.notice.description, /只读、回收、移交/)
})

test('Collab 4403 closes map to a permanent revoked or closed state; other closes reconnect', () => {
  assert.equal(collaborationCloseKind({ code: 4403, reason: 'collaboration_access_revoked' }), 'revoked')
  assert.equal(collaborationCloseKind({ code: 4403, reason: 'collaboration_session_closed' }), 'closed')
  assert.equal(collaborationCloseKind({ code: 4403, reason: '' }), 'revoked', 'an unknown 4403 reason still stops reconnecting')
  for (const other of [null, undefined, {}, { code: 1006 }, { code: 1000, reason: 'collaboration_access_revoked' }, new Event('close')]) {
    assert.equal(collaborationCloseKind(other), null)
  }
})

test('each scene asks its own Host endpoint; department requests carry only the department code', () => {
  assert.deepEqual(hostCollaborationTicketRequest('private', 'doc-1', ''), { path: '/api/documents/doc-1/collaboration', query: undefined })
  assert.deepEqual(hostCollaborationTicketRequest('department', 'doc-1', 'D1'), { path: '/api/departments/documents/doc-1/collaboration', query: { dept_code: 'D1' } })
})

test('failure texts explain the stable Host and Runtime codes', () => {
  for (const code of ['department_writer_required', 'department_document_write_denied', 'collaboration_writer_limit_reached', 'department_document_not_convertible', 'document_v1_collaboration_active', 'snapshot_generation_conflict']) {
    assert.notEqual(departmentCollaborationFailureText({ data: { code } }), departmentCollaborationFailureText({}), code)
    assert.equal(departmentCollaborationFailureText({ data: { data: { code } } }), departmentCollaborationFailureText({ data: { code } }))
  }
  assert.match(departmentCollaborationFailureText({ statusCode: 403 }), /权限/)
  assert.match(departmentCollaborationFailureText({ statusCode: 413 }), /10 MiB/)
  assert.equal(departmentCollaborationFailureText({ statusCode: 500, data: { code: 'constructor' } }), '暂时无法进入协作编辑，请稍后重试')
})

test('the document page wires the department scene through the shared pieces only', () => {
  const page = readFileSync(new URL('../app/pages/documents/[uuid].vue', import.meta.url), 'utf8')
  const composable = readFileSync(new URL('../app/composables/useCollaboration.ts', import.meta.url), 'utf8')
  // Own switch, own read route and ticket endpoint, explicit conversion click.
  assert.match(page, /public\.codocsDepartmentCollaborationV2 === true/)
  assert.match(page, /\/api\/departments\/documents\/\$\{documentId\.value\}`/)
  assert.match(page, /hostCollaborationTicketRequest\(isDepartmentDoc\.value \? 'department' : 'private'/)
  assert.match(page, /collaboration\/convert/)
  assert.match(page, /department_collaboration\?\.can_edit === true/)
  // The session starts only after the user's request, and never after Collab withdrew access.
  assert.match(page, /departmentRequested\.value\s*&& departmentPhase\.value === 'ready' && !collaboration\.closeKind\.value/)
  assert.match(page, /data-test="department-collaboration-entry"/)
  assert.match(page, /data-test="department-collaboration-notice"/)
  assert.match(page, /<UAlert/)
  // Reading never converts: the convert call lives only in the click handler.
  assert.equal(page.match(/collaboration\/convert/g).length, 1)
  assert.match(page, /const startDepartmentCollaboration = async/)
  // No native browser dialogs in the new UI.
  assert.doesNotMatch(page, /window\.(?:confirm|alert|prompt)\(/)
  assert.match(composable, /collaborationCloseKind\(event\)/)
  assert.match(composable, /closeKind/)
})

test('version history: department documents get a read-only history on their own endpoints', () => {
  const department = versionHistoryRequests('department', 'doc-1', 'D1')
  assert.equal(department.readOnly, true)
  assert.deepEqual(department.list, { path: '/api/departments/documents/doc-1/versions', query: { dept_code: 'D1' } })
  assert.deepEqual(department.view(7), { path: '/api/departments/documents/doc-1/versions/7', query: { dept_code: 'D1' } })
  const personal = versionHistoryRequests('private', 'doc-1', '')
  assert.equal(personal.readOnly, false)
  assert.deepEqual(personal.list, { path: '/api/documents/doc-1/versions', query: undefined })
  assert.deepEqual(personal.view(7), { path: '/api/documents/doc-1/versions/7', query: undefined })
})

test('department scene never enters personal share verification and keeps personal paths', () => {
  const source = readFileSync(new URL('../app/pages/documents/[uuid].vue', import.meta.url), 'utf8')
  assert.match(source, /const isDepartmentScene = computed\(\(\) => isDepartmentRead\.value \|\| \(hosted && docState\.value\.doc_type === 'department'\)\)/)
  // Flags off: dedicated read-only status, evaluated before any share-verification status.
  const status = source.slice(source.indexOf('const collaborationStatus = computed'))
  const disabledAt = status.indexOf('departmentCollaborationDisabledStatus()')
  assert.ok(disabledAt > 0 && disabledAt < status.indexOf('label: \'共享状态待核验\''))
  assert.match(status, /isDepartmentScene\.value && !hostedDepartmentCollaborationV2/)
  // Banner, retry button, generic unavailable status and connection label skip department docs.
  assert.match(source, /hosted && !isDepartmentScene\.value && !shareMembersLoaded\.value && isDocumentOwner\.value\) \{/)
  assert.match(source, /v-if="hosted && !isDepartmentScene && !shareMembersLoaded && isDocumentOwner && !docState\.readonly_flag"/)
  assert.match(source, /hosted && !isDepartmentScene\.value && !isPrivateUnsharedDoc\.value && !shouldLoadFromCollaboration\.value/)
  assert.match(source, /!isPrivateUnsharedDoc && !isDepartmentScene && !docState\.readonly_flag/)
  // The personal shares list is never requested for department reads.
  assert.match(source, /!isDocumentOwner\.value \|\| isDepartmentScene\.value\) \{\s*shareMembers\.value = \[\]/)
  // Personal verification (banner text and retry) is unchanged for personal documents.
  assert.match(source, /共享状态待核验/)
  assert.match(source, /@click="fetchShareMembers\(\)"/)
})

test('flags-off department status is a clear read-only notice', () => {
  assert.deepEqual(departmentCollaborationDisabledStatus(), { tone: 'neutral', label: '只读查看', description: '部门文档在线协作未开启，当前仅可查看' })
})
