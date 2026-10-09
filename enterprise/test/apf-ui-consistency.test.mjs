import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { apfEnumLabels, apfServerFieldErrors } from '../app/utils/apfFormPresentation.ts'
import { apfChoicePage, apfChoiceOptions, apfObjectSpecs } from '../app/utils/apfObjectChoices.ts'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('APF enum labels cover canonical People enums and owning Altoc closed validator values', () => {
  const values = new Set()
  for (const match of read('../../docs/Enterprise-APF-Domain-Design.sql').matchAll(/ENUM\(([^)]+)\)/g)) {
    for (const item of match[1].matchAll(/'([^']+)'/g)) values.add(item[1])
  }
  for (const name of ['altoc_tenders.go', 'altoc_renewals.go', 'altoc_sales_support.go', 'altoc_services.go', 'altoc_tickets.go']) {
    const source = read('../../data-runtime/internal/enterpriseapf/' + name)
    for (const match of source.matchAll(/"(?:status|tender_type|lost_reason_type|renewal_type|stage|risk_level|role|influence_level|attitude)":\s*\{([^}]+)\}/g)) {
      for (const item of match[1].matchAll(/"([^"]+)"/g)) values.add(item[1])
    }
    for (const match of source.matchAll(/containsSalesSupport\(\[\]string\{([^}]+)\}/g)) {
      for (const item of match[1].matchAll(/"([^"]+)"/g)) values.add(item[1])
    }
  }
  for (const match of read('../../altoc/docs/apf_m1_schema.sql').matchAll(/COMMENT '([a-z_]+(?:\/[a-z_]+)+)'/g)) {
    for (const value of match[1].split('/')) values.add(value)
  }
  assert.ok(values.size > 60)
  assert.deepEqual([...values].filter(value => !/[\u4e00-\u9fff]/.test(apfEnumLabels[value] || '')), [])
})

test('HTTP 400 fields are whitelisted and messages never render raw server details', () => {
  const raw = 'SQL password https://secret'
  assert.deepEqual(apfServerFieldErrors({ statusCode: 400, data: { data: { errors: [{ name: 'owner_uid', message: raw }, { name: 'unknown' }] } } }, ['name', 'owner_uid']), { owner_uid: '此字段未通过校验，请核对选项、格式及关联关系' })
  assert.deepEqual(Object.keys(apfServerFieldErrors({ statusCode: 400, data: { message: raw } }, ['name', 'owner_uid'])), ['name', 'owner_uid'])
  assert.equal(JSON.stringify(apfServerFieldErrors({ statusCode: 400, data: { message: raw } }, ['name'])).includes(raw), false)
  for (const statusCode of [403, 409, 503]) assert.deepEqual(apfServerFieldErrors({ statusCode }, ['name']), {})
})

test('search options retain owning IDs, Chinese display labels and quotation eligibility', () => {
  assert.equal(apfObjectSpecs['service-agreements'].resource, 'contract')
  assert.equal(apfObjectSpecs.projects.path, '/aims/api/v1/projects')
  const page = apfChoicePage({ data: { data: [{ rank_code: 'P01', rank_name: '工程师', rank_series: 'P', rank_level: 1 }], total: 41 } }, 'ranks')
  assert.equal(page.total, 41)
  assert.equal(apfChoiceOptions(page.rows, 'ranks')[0].value, 'P01')
  assert.match(apfChoiceOptions(page.rows, 'ranks')[0].label, /工程师/)
  assert.deepEqual(apfChoiceOptions([{ id: 1, status: 'approved' }, { id: 2, status: 'draft' }], 'quotes').map(v => v.disabled), [false, true])
  assert.throws(() => apfChoicePage({ data: 'HTML' }, 'positions'))
})

test('complete APF forms compile and reference selectors preserve required fields and field error surfaces', () => {
  const pages = ['APFUserSelect', 'APFDepartmentSelect', 'APFReferenceMultiSelect', 'AltocBusinessObjectSelect', 'PeopleFactsEditor', 'PeopleMasterPage', 'PeopleOnboardingPage', 'PeopleOffboardingPage', 'PeopleHRSourcePage', 'PeopleReadPage', 'AltocSalesPage', 'AltocSalesSupport', 'AltocTendersPage', 'AltocServiceAgreementsPage', 'AltocServiceTicketsPage', 'AltocRenewalsPage', 'AltocCustomersPage', 'AltocQuotationsPage', 'AltocContractsPage']
  for (const name of pages) {
    const { descriptor, errors } = parse(read('../app/components/' + name + '.vue'))
    assert.deepEqual(errors, [], name)
    const script = compileScript(descriptor, { id: name })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: name + '.vue', id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, [], name)
  }
  const facts = read('../app/components/PeopleFactsEditor.vue')
  for (const marker of ['APFUserSelect', 'APFDepartmentSelect', 'kind="positions"', ':required=', ':error=']) assert.ok(facts.includes(marker), marker)
  const offboard = read('../app/components/PeopleOffboardingPage.vue')
  for (const marker of ['kind="assignments"', ':employee-uid="draft.employeeUid"', 'APFUserSelect', ':error=']) assert.ok(offboard.includes(marker), marker)
  for (const page of ['AltocSalesPage', 'AltocSalesSupport', 'AltocTendersPage', 'AltocServiceAgreementsPage', 'AltocServiceTicketsPage', 'AltocRenewalsPage', 'AltocCustomersPage', 'AltocQuotationsPage', 'AltocContractsPage', 'PeopleMasterPage', 'PeopleOnboardingPage']) {
    const source = read('../app/components/' + page + '.vue')
    assert.ok(source.includes('apfServerFieldErrors'), page)
    assert.match(source, /:required=|\brequired\b/, page)
    assert.ok(source.includes(':error='), page)
  }
  assert.match(read('../app/components/APFUserSelect.vue'), /UserTreeSelector[\s\S]*selection-mode="single"/)
  assert.match(read('../app/components/APFDepartmentSelect.vue'), /搜索部门[\s\S]*DeptTreeSelector/)
  const contract = read('../app/components/AltocContractsPage.vue')
  assert.match(contract, /v-if="p.create"[\s\S]*v-else[\s\S]*kind="projects"/)
  assert.ok(contract.includes('APFReferenceMultiSelect'))
  assert.match(read('../app/components/APFReferenceMultiSelect.vue'), /values.join\(','\)/)
})

// Host components are not auto-registered (nuxt.config components.dirs lists
// only business-module directories), so every Host component tag must be imported.
test('Host components used by Host components and pages are explicitly imported', async () => {
  const { readdirSync } = await import('node:fs')
  const dir = new URL('../app/components/', import.meta.url)
  const names = readdirSync(dir).filter(f => f.endsWith('.vue')).map(f => f.slice(0, -4))
  const walk = url => readdirSync(url, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(new URL(`${e.name}/`, url)) : e.name.endsWith('.vue') ? [new URL(e.name, url)] : [])
  for (const file of [...walk(dir), ...walk(new URL('../app/pages/', import.meta.url))]) {
    const source = readFileSync(file, 'utf8')
    for (const name of names) {
      if (file.pathname.endsWith(`/${name}.vue`) || !new RegExp(`<${name}[\\s/>]`).test(source)) continue
      assert.match(source, new RegExp(`import ${name} from`), `${file.pathname} uses <${name}> without importing it`)
    }
  }
})

test('Object selector omits an empty search parameter (owning list readers reject search=)', () => {
  const source = readFileSync(new URL('../app/components/AltocBusinessObjectSelect.vue', import.meta.url), 'utf8')
  assert.match(source, /!\(debounced\.value \|\| props\.searchHint\) \? \{\}/)
  assert.doesNotMatch(source, /search: debounced\.value \|\| props\.searchHint \|\| ''/)
})
