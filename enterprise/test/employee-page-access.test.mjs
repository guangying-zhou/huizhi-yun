import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import aims from '../../aims/layer/entry.mjs'

const source = readFileSync(new URL('../app/utils/employee-page-access.ts', import.meta.url), 'utf8')
const { employeePagePermission } = await import(`data:text/javascript;base64,${Buffer.from(ts.transpile(source, { module: ts.ModuleKind.ESNext })).toString('base64')}`)

test('employee page discovery uses exact manifest actions, not role labels or admin implications', () => {
  for (const [path, resource, action] of [['/codocs/mydocs', 'documents', 'view'], ['/codocs/mydocs/recycle', 'documents', 'view'], ['/codocs/departments/records', 'departments', 'view'], ['/codocs/company/rules', 'company', 'view'], ['/aims/admin/projects/1/edit', 'admin', 'admin'], ['/aims/admin/weekly-reporting-settings', 'weekly_reports', 'configure'], ['/aims/work-items', 'work_items', 'view'], ['/aims/weekly-reports', 'weekly_reports', 'view']]) {
    assert.deepEqual(employeePagePermission(path), { resource, action })
  }
  assert.deepEqual(employeePagePermission('/aims/timesheet'), { resource: 'timesheet', action: 'view', anyActions: ['view', 'submit'] })
  for (const path of ['/codocs/documents/shared-uuid', '/codocs/s/public-token', '/aims/projects/1/documents', '/finance/receipts']) assert.equal(employeePagePermission(path), null)
})
test('Aims list entry preflight follows the existing navigation actions including submit-only timesheet access', () => {
  for (const entry of aims.navigation.filter(entry => ['/aims/projects', '/aims/project-documents', '/aims/admin/projects', '/aims/admin/weekly-reporting-settings', '/aims/work-items', '/aims/timesheet', '/aims/weekly-reports'].includes(entry.to))) {
    const required = employeePagePermission(entry.to)
    if (entry.permissionRefs) {
      assert.equal(entry.mode, 'any')
      assert.deepEqual(entry.permissionRefs, required.anyActions.map(action => ({ resource: required.resource, action })))
    } else assert.deepEqual(required, entry.permission)
  }
})

test('failed project ACL preflight blocks child rendering and retains a safe return entry', () => {
  const layout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
  assert.match(layout, /v-else-if="projectContext.error.value"/)
  assert.match(layout, /返回项目总览\s*<\/UButton>/)
  assert.match(layout, /v-if="employeePageDenied \|\| projectEntryDenied"/)
  assert.ok(layout.indexOf('projectContext.error.value') < layout.indexOf('<slot v-else'))
})

test('the global Host 403 page provides safe copy and retains workbench navigation', () => {
  const source = readFileSync(new URL('../app/error.vue', import.meta.url), 'utf8')
  assert.match(source, /无权限访问此页面/)
  assert.match(source, /请联系管理员/)
  assert.match(source, /clearError\(\{ redirect: '\/enterprise' \}\)/)
  assert.ok(!source.includes('error.message'))
})

test('retired Host entries show 410 guidance without internal errors', () => {
  const source = readFileSync(new URL('../app/error.vue', import.meta.url), 'utf8')
  assert.match(source, /statusCode.*410/)
  assert.match(source, /此入口已下线/)
  assert.match(source, /旧入口已停止使用/)
})
