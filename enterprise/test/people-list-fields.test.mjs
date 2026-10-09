import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const source = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
test('Host positions list preserves the 09a owning fields and edit version without broadening permissions', () => {
  assert.match(source('enterprise/server/routes/enterprise/api/apf/people/positions/list.get.ts'), /enterpriseAPFUser\(event, 'people', 'list'\)/)
  const core = source('data-runtime/internal/enterpriseapf/service.go')
  assert.match(core, /people\.MasterColumns\("positions-list"\)/)
  assert.match(core, /people\.MasterRows\(rows, positionColumns\)/)
  assert.match(core, /row\["rowVersion"\].*row\["row_version"\]/)
  const page = source('enterprise/app/components/PeopleMasterPage.vue')
  for (const field of ['position_code', 'position_name', 'enabled', 'sort_order', 'row_version']) assert.ok(page.includes(field), field)
  assert.match(page, /expectedVersion: Number\(editing\.value\.row_version\)/)
  assert.match(page, /Number\(row\[key!\]\)/)
})
test('People list columns share existing Runtime whitelists for all six families', () => {
  const master = source('data-runtime/internal/apps/people/enterprise_master.go')
  const reads = source('data-runtime/internal/enterpriseapf/people.go')
  const onboarding = source('data-runtime/internal/apps/people/enterprise_onboarding_facts.go')
  for (const [pageName, core, fields] of [
    ['PeopleMasterPage', master, ['position_code', 'position_name', 'enabled', 'rank_code', 'rank_name', 'rank_series', 'rank_level', 'rate_code', 'rate_name', 'rank_salary', 'performance_salary_min', 'performance_salary_max', 'row_version']],
    ['PeopleReadPage', reads, ['employee_no', 'display_name', 'employment_status', 'dept_code', 'position_name', 'assignment_code', 'employee_uid', 'change_type', 'approval_status', 'row_version']],
    ['PeopleOnboardingPage', onboarding, ['onboarding_code', 'candidate_name', 'planned_onboard_date', 'status', 'object_version']]
  ]) {
    const page = source(`enterprise/app/components/${pageName}.vue`)
    for (const field of fields) {
      assert.ok(core.includes(`"${field}"`), `${pageName}: Runtime missing ${field}`)
      assert.ok(page.includes(field), `${pageName}: UI missing ${field}`)
    }
    const { descriptor, errors } = parse(page)
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: pageName })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: `${pageName}.vue`, id: pageName, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
  assert.match(reads, /if i.CostAllowed/)
  assert.match(reads, /peopleCostVisible/)
})

test('Employee and assignment edit drawers receive their non-sensitive existing values', () => {
  const core = source('data-runtime/internal/enterpriseapf/people.go')
  const editor = source('enterprise/app/components/PeopleFactsEditor.vue')
  for (const field of ['initials', 'work_location', 'remarks', 'row_version']) {
    assert.ok(core.includes(`"${field}"`), `read whitelist missing ${field}`)
    assert.ok(editor.includes(field), `editor missing ${field}`)
  }
  assert.equal(core.includes('"id_number"'), false)
  assert.match(core, /peopleCostVisible/)
})
