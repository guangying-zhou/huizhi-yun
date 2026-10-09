import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createSSRApp, computed, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { w3ContractCategories, w3SnapshotRows, w3StarLabel, w3OwnerLabel, historicalContract, effectiveAmountExceedsTotal } from '../app/utils/w3Presentation.ts'

const root = resolve(import.meta.dirname, '../..')
test('W3 presentation keeps missing values, currency facts, source dictionary and historical guards distinct', () => {
  assert.equal(w3SnapshotRows({ contract_count_direct: null })[0].value, null)
  assert.equal(w3SnapshotRows({ contract_count_direct: 0 })[0].value, 0)
  assert.equal(w3SnapshotRows({ contract_count_direct: 2 }, { contract_count_direct: 3 })[0].different, true)
  assert.equal(w3SnapshotRows({ remaining_uninvoiced_amount: '12.00' })[0].tracked, false)
  assert.deepEqual([1, 2, 3, 4, 5, 6, null].map(w3StarLabel), ['2 星', '3 星', '3.5 星', '4 星', '4.5 星', '5 星', '—'])
  assert.equal(w3OwnerLabel('system:unassigned', '伪目录用户'), '待匹配')
  assert.equal(w3OwnerLabel('person', '张三'), '张三')
  assert.equal(historicalContract({ origin_type: 'historical_import' }), true)
  assert.equal(effectiveAmountExceedsTotal({ effective_amount: '9007199254740993.01', amount_tax_inclusive: '9007199254740993.00' }), true)
  assert.equal(effectiveAmountExceedsTotal({ effective_amount: null, amount_tax_inclusive: '0.00' }), false)
  assert.equal(Object.keys(w3ContractCategories).length, 9)
  for (const category of ['software_sales', 'software_development', 'tech_data_service', 'system_maintenance', 'saas', 'platform_operation', 'hardware_integration', 'purchase', 'other']) assert.ok(w3ContractCategories[category])
})

test('all W3 Host page SFCs compile and explicitly import shared header and empty state', () => {
  for (const file of ['enterprise/app/components/AltocCustomersPage.vue', 'enterprise/app/components/AltocContractsPage.vue', 'finance/app/components/host/FinanceListPage.vue', 'finance/app/components/host/BankAccountDetails.vue', 'enterprise/app/components/W3CustomerOverview.vue', 'enterprise/app/components/W3MigrationSnapshot.vue', 'enterprise/app/components/W3SourceInfo.vue']) {
    const path = resolve(root, file), source = readFileSync(path, 'utf8')
    const { descriptor, errors } = parse(source, { filename: path })
    assert.deepEqual(errors, [])
    if (file.endsWith('AltocContractsPage.vue')) {
      assert.match(source, /id: 'contract_amount', header: '合同金额'/)
      assert.match(source, /money\(contractListAmount\(row.original\).value, row.original.currency_code\)/)
      assert.match(source, /path: '\/finance\/legal-entities'/)
      const { descriptor } = parse(source)
      const template = descriptor.template.content
      assert.match(template, /<section[^>]*detailTab === 'source'[\s\S]*?<W3SourceInfo[\s\S]*?<\/section>/, 'source info belongs to the separate source/relations tab')
      assert.match(template, /<section[^>]*detailTab === 'performance'[\s\S]*?<UTable[\s\S]*?<\/section>/, 'business details remain in the performance tab')
    }
    if (file.endsWith('W3CustomerOverview.vue')) {
      assert.match(source, /customer\.hasHiddenChildren === true/)
      assert.match(source, /部分下属不可见/)
      assert.doesNotMatch(source, /hiddenChildCount/)
    }
    assert.doesNotThrow(() => compileScript(descriptor, { id: file, inlineTemplate: true }))
    for (const component of ['ContentPageHeader', 'CommonEmptyState']) if (source.includes(`<${component}`)) assert.match(source, new RegExp(`import ${component} from`), file)
  }
})

const vueFilePattern = /\.vue$/
async function loadComponent(file) {
  const path = resolve(root, file), source = readFileSync(path, 'utf8')
  const script = compileScript(parse(source, { filename: path }).descriptor, { id: file, inlineTemplate: true }).content
  const output = await build({ stdin: { contents: script, sourcefile: path, resolveDir: dirname(path), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false, external: ['vue'], plugins: [{ name: 'sfc', setup(builder) {
    builder.onLoad({ filter: vueFilePattern }, async ({ path: child }) => ({ contents: compileScript(parse(readFileSync(child, 'utf8'), { filename: child }).descriptor, { id: child, inlineTemplate: true }).content, loader: 'ts', resolveDir: dirname(child) }))
  } }] })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.default
}
test('synthetic migration snapshot/source components render NULL, differences and reviewed source fields', async () => {
  const previous = globalThis.computed
  globalThis.computed = computed
  try {
    const snapshot = await loadComponent('enterprise/app/components/W3MigrationSnapshot.vue')
    const badge = defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) })
    const app = createSSRApp(snapshot, { snapshot: { snapshot_at: '2024-01-31', source_note: '缓存口径', contract_count_direct: null, contract_amount_direct: '20.00', remaining_uninvoiced_amount: '5.00', private: 'MUST-NOT-LEAK' }, current: { contract_amount_direct: '30.00' }, currency: 'CNY' })
    app.component('UBadge', badge)
    const html = await renderToString(app)
    assert.match(html, /2024-01-31/)
    assert.match(html, /与现值不同/)
    assert.match(html, /一期未跟踪/)
    assert.match(html, /—/)
    assert.ok(!html.includes('MUST-NOT-LEAK'))
    const source = await loadComponent('enterprise/app/components/W3SourceInfo.vue')
    const text = await renderToString(createSSRApp(source, { source: { system: 'wizbiz', table: 'wb_contract', pk: '7', batchCode: 'W1', importedAt: '2024-01-31', row_json: 'MUST-NOT-LEAK' } }))
    assert.match(text, /wb_contract/)
    assert.ok(!text.includes('MUST-NOT-LEAK'))
  } finally { globalThis.computed = previous }
})
