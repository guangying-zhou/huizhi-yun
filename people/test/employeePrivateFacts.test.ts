import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { parseEmployeeArchiveCsv } from '../server/utils/employeeArchiveCsv.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('People private employee facts', () => {
  test('parses the legacy OA CSV without treating literal NULL as data', () => {
    const items = parseEmployeeArchiveCsv([
      '\uFEFFemployee_id,name,id_number,date_of_birth,education,major,school,graduation,hiredate,mobile_number,ding_id,operate_time',
      '101,测试员工,110101199001011234,1990-01-01,1,软件工程,"测试大学,本部",2012-06-30 00:00:00,2020-07-01,NULL,ding-user-1,2026-09-01 12:00:00'
    ].join('\r\n'))

    assert.equal(items.length, 1)
    assert.deepEqual(items[0], {
      row_number: 2,
      name: '测试员工',
      ding_id: 'ding-user-1',
      hire_date: '2020-07-01',
      source_biz_id: '101',
      source_updated_at: '2026-09-01 12:00:00',
      id_number: '110101199001011234',
      birth_date: '1990-01-01',
      education_level: '1',
      major: '软件工程',
      graduation_school: '测试大学,本部',
      graduation_date: '2012-06-30'
    })
  })

  test('requires employee admin before reading the sensitive multipart body', () => {
    const route = source('../server/api/admin/employee-archive-import.post.ts')
    assert.ok(route.indexOf('assertPeoplePermission(event, \'employees\', \'admin\')') < route.indexOf('readMultipartFormData(event)'))
    assert.ok(route.indexOf('getHeader(event, \'content-length\')') < route.indexOf('readMultipartFormData(event)'))
    assert.match(route, /EMPLOYEE_ARCHIVE_MAX_BYTES/)
    assert.match(route, /dry_run: dryRun/)
  })

  test('keeps extended HR profiles out of generic employee reads and requires HR management permission', () => {
    const middleware = source('../server/middleware/tenant-runtime.ts')
    const runtime = source('../../data-runtime/internal/apps/people/employee_private_facts.go')
    const adapter = source('../../data-runtime/internal/apps/people/adapter.go')
    const page = source('../app/pages/employees/[uid].vue')

    assert.match(middleware, /private-profile[\s\S]{0,180}return 'edit'/)
    assert.match(middleware, /private-profile[\s\S]{0,240}action: 'edit'/)
    assert.match(middleware, /employee-private-profiles:import[\s\S]{0,120}action: 'admin'/)
    assert.doesNotMatch(adapter, /Path:\s*"employee-private-facts"/)
    assert.match(runtime, /field == "id_number"[\s\S]{0,100}maskEmployeeIDNumber/)
    assert.match(runtime, /source != "dingtalk"/)
    assert.match(page, /employee\.value\.onboard_date_source !== 'dingtalk'/)
    assert.match(page, /ensurePeoplePermission\('employees', 'edit'\)/)
    assert.match(page, /人力资源管理人员可见/)
    assert.match(page, /钉钉有值时以钉钉为准/)
    assert.match(page, /graduation_date\.length === 7 \? 'month' : 'date'/)
  })

  test('unlocks legacy employees whose onboard date is actually empty', () => {
    const migration = source('../docs/migrations/20260904_employee_private_facts.sql')
    assert.match(migration, /SET `onboard_date_source` = NULL/)
    assert.match(migration, /`onboard_date` IS NULL OR `onboard_date` = '1970-01-01'/)
  })
})
