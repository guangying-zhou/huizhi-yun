import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const assignments = readFileSync(
  new URL('../app/pages/assignments.vue', import.meta.url),
  'utf8'
)
const employees = readFileSync(
  new URL('../app/pages/employees/index.vue', import.meta.url),
  'utf8'
)
const employeeDetail = readFileSync(
  new URL('../app/pages/employees/[uid].vue', import.meta.url),
  'utf8'
)
const tenantRuntimeMiddleware = readFileSync(
  new URL('../server/middleware/tenant-runtime.ts', import.meta.url),
  'utf8'
)

test('新增任职变更先校验权限，再选择员工并自动打开调整表单', () => {
  assert.match(assignments, /ensurePeoplePermission\('assignments', 'edit'\)/)
  assert.match(assignments, /query:\s*\{\s*select:\s*'assignment'\s*\}/)
  assert.match(assignments, /@click="openNewAssignment"/)

  assert.match(employees, /route\.query\.select === 'assignment'/)
  assert.match(employees, /query:\s*\{\s*action:\s*'assignment'\s*\}/)
  assert.match(employees, /点击员工后将自动打开任职调整表单/)

  assert.match(employeeDetail, /route\.query\.action !== 'assignment'/)
  assert.match(employeeDetail, /await openAssignmentAdjustment\(\)/)
  assert.match(employeeDetail, /delete nextQuery\.action/)
})

test('任职调整使用单事务 action，不再由页面编排多次写入或直接停用 Console 用户', () => {
  assert.match(employeeDetail, /\$fetch\('\/api\/v1\/assignments:change'/)
  assert.match(employeeDetail, /source_biz_id:\s*assignmentSourceBizId\.value/)
  assert.doesNotMatch(employeeDetail, /\$fetch\('\/api\/v1\/assignments',/)
  assert.doesNotMatch(employeeDetail, /closeCurrentAssignments/)
  assert.doesNotMatch(employeeDetail, /directory-users\/\$\{[^}]+}\/disable/)
  assert.match(tenantRuntimeMiddleware, /context\.suffix === '\/assignments:change'[\s\S]{0,100}return 'assignments'/)
  assert.match(tenantRuntimeMiddleware, /suffix === '\/assignments:change'[\s\S]{0,100}resource: 'assignments'/)
  assert.match(tenantRuntimeMiddleware, /const needsStandardCosts = [^\n]*isAssignmentChangeContext\(context\)/)
})

test('调级以启用的职级字典为事实源，并按职级编码关联当前标准成本', () => {
  assert.match(employeeDetail, /useFetch<ApiResponse<ListResponse<Rank>>>\('\/api\/v1\/ranks'/)
  assert.match(employeeDetail, /const enabledRanks = computed/)
  assert.match(employeeDetail, /item\.enabled !== false && item\.enabled !== 0/)
  assert.match(employeeDetail, /const latestRankRateByCode = computed/)
  assert.match(employeeDetail, /selectedRank = computed/)
  assert.match(employeeDetail, /selectedRankRate = computed/)
  assert.match(employeeDetail, /该职级尚未维护标准成本/)
  assert.doesNotMatch(employeeDetail, /function rankSeriesFromCode/)
})
