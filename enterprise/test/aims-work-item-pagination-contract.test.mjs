import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { optionalReadPagination } from '../../foundation/shared/utils/optionalReadPagination.ts'

const projectBff = readFileSync(new URL('../server/utils/enterpriseAimsProjectWorkspace.ts', import.meta.url), 'utf8')
const myBff = readFileSync(new URL('../server/utils/enterpriseAimsTimesheet.ts', import.meta.url), 'utf8')
const projectRuntime = readFileSync(new URL('../../data-runtime/internal/server/enterprise_project_workspace.go', import.meta.url), 'utf8')
const myRuntime = readFileSync(new URL('../../data-runtime/internal/server/enterprise_project_timesheet.go', import.meta.url), 'utf8')

test('work item Host reads validate bounded pages and keep exact delegated keys', () => {
  for (const invalid of [{ page: '0' }, { page: '2x' }, { pageSize: '101' }, { page: ['1', '2'] }]) {
    assert.throws(() => optionalReadPagination(invalid))
  }
  assert.deepEqual(optionalReadPagination({ page: '2', pageSize: '100' }), { page: '2', pageSize: '100' })
  // 缺省分页不能被合成为 undefined 键，否则不带分页的里程碑读取整表 400。
  assert.doesNotMatch(projectBff, /pageSize: rawQuery\.pageSize \?\? rawQuery\.page_size/)
  assert.match(projectBff, /optionalReadPagination\(pagination\)/)
  assert.match(projectBff, /'quickFilter'/)
  assert.match(projectBff, /'severity'/)
  assert.match(projectBff, /'version_id'/)
  assert.match(projectRuntime, /"versionId", "version_id", "quickFilter"/)
  assert.match(myBff, /optionalReadPagination\(getQuery\(event\)\)/)
  assert.match(myRuntime, /"status", "page", "pageSize"/)
})
