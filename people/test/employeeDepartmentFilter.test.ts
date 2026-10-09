import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { computed, ref } from 'vue'
import {
  resolveEmployeeDepartmentCodes,
  type EmployeeDepartmentNode
} from '../app/utils/employeeDepartmentCodes.ts'

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('People employee department filter', () => {
  test('unfiltered department codes do not depend on directory hydration', () => {
    const page = source('../app/pages/employees/index.vue')
    const body = page.split('const selectedDepartmentCodes = computed(() => {')[1]?.split('\n})')[0]
    assert.ok(body)
    const tree = ref<EmployeeDepartmentNode[]>([])
    const selection = ref('')
    const evaluate = new Function('selectedDeptCode', 'selectedCommitteeCode', 'departmentTree', 'resolveEmployeeDepartmentCodes', body)
    const codes = computed(() => evaluate(selection, ref(''), tree, resolveEmployeeDepartmentCodes))
    const initial = codes.value
    tree.value = [{ deptCode: 'HQ', orgType: 'department' }, { deptCode: 'BRANCH', orgType: 'department' }]
    assert.equal(codes.value, initial, 'same empty selection must retain computed identity')
    selection.value = 'HQ'
    assert.deepEqual(codes.value, ['HQ'])
  })
  test('loads the shared directory tree and includes formal descendant departments', () => {
    const page = source('../app/pages/employees/index.vue')

    assert.match(page, /useAccountDepartments\(\)/)
    assert.match(page, /import \{ resolveEmployeeDepartmentCodes \} from '~\/utils\/employeeDepartmentCodes'/)
    assert.match(page, /resolveEmployeeDepartmentCodes\(departmentTree\.value, selectedDeptCode\.value, true\)/)
    assert.match(page, /dept_codes: selectedDepartmentCodes\.value\.length > 0/)
    assert.match(page, /\/api\/v1\/employees:search/)
    assert.match(page, /method: 'POST'/)
    assert.match(page, /dept_codes:[\s\S]{0,100}selectedDepartmentCodes\.value/)
    assert.doesNotMatch(page, /selectedDepartmentCodes\.value\.join\(','\)/)
    assert.match(page, /watch\(\[status, selectedDeptCode\]/)
    assert.match(page, /page\.value = 1/)
  })

  test('resolves committee members from Directory and filters People by employee uid', () => {
    const page = source('../app/pages/employees/index.vue')

    assert.match(page, /selectedOrganization\.value\?\.orgType === 'committee'/)
    assert.match(page, /\$fetch<ApiResponse<DirectoryUsersResponse>>\('\/api\/directory\/users'/)
    assert.match(page, /dept_code: committeeCode/)
    assert.match(page, /employee_uids: selectedCommitteeCode\.value/)
    assert.match(page, /employee_uids:[\s\S]{0,180}committeeMemberUids\.value/)
    assert.match(page, /'__no_committee_members__'/)
  })

  test('renders the tree beside the desktop list and in a mobile slideover', () => {
    const page = source('../app/pages/employees/index.vue')
    const filter = source('../app/components/EmployeeDepartmentFilter.vue')

    assert.match(page, /<aside class="hidden w-64[^"]*lg:block">/)
    assert.match(page, /<EmployeeDepartmentFilter[\s\S]*:nodes="departmentTree"/)
    assert.match(page, /<USlideover[\s\S]*title="按部门查看员工"/)
    assert.match(page, /description="部门包含下级部门员工；委员会按成员显示"/)
    assert.match(filter, /label="全部部门"/)
    assert.match(filter, /选择部门时包含正式下级部门员工/)
    assert.match(filter, /<DeptTreeSelector/)
    assert.match(filter, /@select="emit\('select', \$event\)"/)
  })

  test('returns no department codes when no department is selected', () => {
    assert.deepEqual(resolveEmployeeDepartmentCodes([], ''), [])
  })

  test('includes a formal parent and all formal descendants recursively', () => {
    const tree: EmployeeDepartmentNode[] = [{
      deptCode: 'COMPANY',
      orgType: 'department',
      children: [{
        deptCode: 'HQ',
        orgType: 'department',
        children: [{
          deptCode: 'RD',
          orgType: 'department',
          children: [{ deptCode: 'RD-PLATFORM', orgType: 'department' }]
        }]
      }]
    }]

    assert.deepEqual(resolveEmployeeDepartmentCodes(tree, 'HQ'), ['HQ', 'RD', 'RD-PLATFORM'])
  })

  test('omits the filter for a single company root to avoid an unbounded query', () => {
    const tree: EmployeeDepartmentNode[] = [{
      deptCode: 'COMPANY',
      orgType: 'department',
      children: [{ deptCode: 'RD', orgType: 'department' }]
    }]

    assert.deepEqual(resolveEmployeeDepartmentCodes(tree, 'COMPANY', true), [])
  })

  test('skips committee and virtual child subtrees', () => {
    const tree: EmployeeDepartmentNode[] = [{
      deptCode: 'HQ',
      orgType: 'department',
      children: [
        {
          deptCode: 'COMMITTEE',
          orgType: 'committee',
          children: [{ deptCode: 'COMMITTEE-SECRETARY', orgType: 'department' }]
        },
        {
          deptCode: 'VIRTUAL',
          orgType: 'virtual',
          children: [{ deptCode: 'VIRTUAL-DELIVERY', orgType: 'department' }]
        },
        { deptCode: 'FINANCE', orgType: 'department' }
      ]
    }]

    assert.deepEqual(resolveEmployeeDepartmentCodes(tree, 'HQ'), ['HQ', 'FINANCE'])
  })

  test('treats missing orgType as a legacy formal department', () => {
    const tree: EmployeeDepartmentNode[] = [{
      deptCode: 'HQ',
      children: [{ deptCode: 'LEGACY-CHILD' }]
    }]

    assert.deepEqual(resolveEmployeeDepartmentCodes(tree, 'HQ'), ['HQ', 'LEGACY-CHILD'])
  })

  test('deduplicates repeated department codes while preserving tree order', () => {
    const tree: EmployeeDepartmentNode[] = [{
      deptCode: 'HQ',
      orgType: 'department',
      children: [
        { deptCode: 'RD', orgType: 'department' },
        { deptCode: 'RD', orgType: 'department' },
        { deptCode: 'HQ', orgType: 'department' }
      ]
    }]

    assert.deepEqual(resolveEmployeeDepartmentCodes(tree, 'HQ'), ['HQ', 'RD'])
  })

  test('falls back to the selected code for missing or non-formal nodes', () => {
    const tree: EmployeeDepartmentNode[] = [{
      deptCode: 'VIRTUAL',
      orgType: 'virtual',
      children: [{ deptCode: 'FORMAL-CHILD', orgType: 'department' }]
    }]

    assert.deepEqual(resolveEmployeeDepartmentCodes(tree, 'MISSING'), ['MISSING'])
    assert.deepEqual(resolveEmployeeDepartmentCodes(tree, 'VIRTUAL'), ['VIRTUAL'])
  })
})
