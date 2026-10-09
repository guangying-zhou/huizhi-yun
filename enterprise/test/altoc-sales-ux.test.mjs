import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { baseParse } from '@vue/compiler-dom'
import ts from 'typescript'
import * as enums from '../../altoc/app/types/altoc.ts'

const read = name => readFileSync(new URL(`../app/components/${name}.vue`, import.meta.url), 'utf8')
const pages = ['AltocSalesPage', 'AltocSalesSupport', 'AltocCustomersPage', 'AltocQuotationsPage', 'AltocContractsPage', 'AltocTendersPage', 'AltocServiceTicketsPage', 'AltocRenewalsPage']
test('Altoc components have no runtime show/custom directives on component roots; dialogs use explicit state', () => {
  for (const name of pages) {
    const { descriptor, errors } = parse(read(name))
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: name })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: name + '.vue', id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    const walk = (node) => {
      if (node.type === 1 && (/^[A-Z]/.test(node.tag) || node.tag.includes('-'))) {
        for (const p of node.props) if (p.type === 7) assert.ok(['bind', 'on', 'model', 'if', 'else', 'else-if', 'for', 'slot', 'once', 'memo', 'pre'].includes(p.name), `${name}: runtime v-${p.name} on ${node.tag}`)
        if (['UModal', 'USlideover'].includes(node.tag)) assert.ok(node.props.some(p => p.type === 7 && p.name === 'model' && p.arg?.content === 'open'), `${name}: unbound dialog`)
      }
      for (const child of node.children || []) walk(child)
    }
    walk(baseParse(descriptor.template.content))
  }
  const sales = read('AltocSalesPage')
  assert.match(sales, /v-for="a in availableActions"/)
  assert.match(sales, /@click="begin\(a\)"/)
  assert.match(sales, /editor\.value = true/)
})
function actualSalesFunctions(resource = 'lead', action = 'create') {
  const script = parse(read('AltocSalesPage')).descriptor.scriptSetup.content
  const ast = ts.createSourceFile('sales.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const functions = ast.statements.filter(s => ts.isFunctionDeclaration(s) && ['options', 'required'].includes(s.name?.text)).map(n => n.getText(ast)).join('\n')
  const code = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('props', 'action', 'stages', ...Object.keys(enums), code + ';return {options,required}')({ resource }, { value: action }, { value: [] }, ...Object.values(enums))
}
test('Lead/opportunity fixed enumerations render Chinese and use existing owning status/reason labels', () => {
  const { options } = actualSalesFunctions()
  for (const [field, values] of Object.entries({ budget_status: ['unknown', 'applying', 'approved', 'allocated'], project_type: ['tob', 'tog', 'renewal', 'upsell', 'channel'], procurement_mode: ['direct', 'competitive_consultation', 'open_tender', 'framework', 'other'], risk_level: ['high', 'medium', 'low'], forecast_category: ['pipeline', 'best_case', 'commit'] })) {
    for (const value of values) assert.match(options(field).find(o => o.value === value)?.label || '', /[\u4e00-\u9fff]/, `${field}:${value}`)
  }
  for (const value of ['following', 'pending_assign']) assert.match(enums.LEAD_STATUS_OPTIONS.find(o => o.value === value)?.label || '', /[\u4e00-\u9fff]/)
  assert.match(read('AltocSalesPage'), /Object\.fromEntries\(\[\.\.\.LEAD_STATUS_OPTIONS, \.\.\.OPPORTUNITY_STATUS_OPTIONS\]/)
})
test('Client required rules and visible form markers use the same predicate; empty states follow selected section', () => {
  const { required } = actualSalesFunctions()
  for (const k of ['name', 'org_name', 'owner_uid', 'source_type', 'need_summary', 'next_action', 'next_action_due_at']) assert.equal(required(k), true, k)
  assert.equal(required('remark'), false)
  const sales = read('AltocSalesPage')
  assert.match(sales, /:required="required\(k\)"/)
  assert.match(sales, /<span\s+v-if="required\(k\)"[^>]*>\*<\/span>/)
  assert.match(sales, /fields\.value\.filter\(k => required\(k\)/)
  const support = read('AltocSalesSupport')
  for (const title of ['暂无跟进记录', '暂无联系人关系', '暂无阶段变更', '暂无文档引用']) assert.ok(support.includes(title))
  assert.match(support, /:title="emptyState\.title"/)
  assert.match(support, /:description="emptyState\.description"/)
})
