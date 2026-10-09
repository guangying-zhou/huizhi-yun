import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

function callsIn(node) {
  const calls = []
  const seen = new WeakSet()
  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (value.type === 'CallExpression') calls.push(value)
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit)
      else visit(child)
    }
  }
  visit(node)
  return calls
}
const manifest = JSON.parse(readFileSync(new URL('../../altoc/app.manifest.json', import.meta.url), 'utf8'))
for (const [component, resource] of [['AltocCustomersPage', 'customer'], ['AltocQuotationsPage', 'quotation'], ['AltocContractsPage', 'contract']]) {
  test(`${component} explicitly loads Host permissions and uses the manifest resource/action pair; standard list compiles`, () => {
    const source = readFileSync(new URL(`../app/components/${component}.vue`, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: component })
    const compiled = compileTemplate({ source: descriptor.template.content, filename: `${component}.vue`, id: component, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(compiled.errors, [])
    const calls = callsIn(script.scriptSetupAst)
    const permissionCalls = calls.filter(c => c.callee.type === 'Identifier' && c.callee.name === 'hasPermission')
    assert.deepEqual(permissionCalls.map(c => c.arguments.map(a => a.value)), component === 'AltocContractsPage' ? [[resource, 'edit'], [resource, 'close']] : component === 'AltocCustomersPage' ? [[resource, 'edit'], [resource, 'view']] : [[resource, 'edit']])
    for (const call of permissionCalls) assert.ok(manifest.resources.find(r => r.code === call.arguments[0].value).actions.includes(call.arguments[1].value))
    const mounted = calls.find(c => c.callee.type === 'Identifier' && c.callee.name === 'onMounted')
    assert.ok(mounted, 'Host does not run the standalone permission middleware')
    assert.ok(callsIn(mounted.arguments[0]).some(c => c.callee.type === 'Identifier' && c.callee.name === 'loadPermissions'), 'loaded-first guards cannot lazily initiate the request')
    assert.match(source, /loaded\.value && !permissionError\.value && hasPermission/)
    assert.ok(source.includes('error: permissionError'))
    assert.ok(source.includes('权限信息加载失败'))
    assert.ok(source.includes('loadPermissions({ force: true })'))
    assert.ok(source.includes('v-if="permissionError"'))
    const search = calls.find(c => c.callee.type === 'Identifier' && c.callee.name === 'useDebouncedSearch')
    assert.ok(search)
    assert.match(source, component === 'AltocCustomersPage' ? /onChange: \(\) => \{\s*if \(!restoringList\) page\.value = 1\s*\}/ : component === 'AltocContractsPage' ? /onChange: \(\) => \{\s*if \(!restoringQuery\) page\.value = 1\s*\}/ : /onChange: \(\) => \{\s*page\.value = 1\s*\}/)
    assert.ok(source.includes('debounced.value.trim()'))
    assert.equal(source.includes('search.value.trim()'), false)
    assert.match(source, component === 'AltocCustomersPage' ? /watch\(\[id, listQuery, view, scopeKey, accessStatus/ : component === 'AltocContractsPage' ? /watch\(\[id, listQuery, cacheScope, accessStatus\]/ : /watch\(\[id, page, debounced,/)
    const template = descriptor.template.content
    for (const fact of ['ContentPageHeader', 'breadcrumb=', 'description=', '#actions', 'v-model="search"', '@keyup.enter="flush"', '<UTable', ':loading="pending || (!loaded && !permissionError)"', '#empty', 'CommonEmptyState', 'v-if="canEdit"', 'UPagination', 'v-model:page="page"', ':total="total"', '共 {{ total }} 条']) assert.ok(template.includes(fact), fact)
    assert.ok(template.includes(':items-per-page="20"') || template.includes(':items-per-page="pageSize"'))
    if (component === 'AltocContractsPage') {
      assert.match(template, /#empty>[\s\S]*?<CommonEmptyState[\s\S]*?hasListFilters[\s\S]*?v-else-if="!pending && canEdit"/)
      assert.match(template, /:to="\{ path: `\/altoc\/contracts\/\$\{row.original.id\}`, query: route.query \}"/)
    } else assert.match(template, /<template #empty>[\s\S]*?<CommonEmptyState[\s\S]*?:description="canEdit \?[\s\S]*?<UButton\s+v-if="canEdit"/)
    const list = template.slice(template.indexOf('!detail'), template.indexOf('v-else-if="' + ({ customer: 'customer', quotation: 'quote', contract: 'contract' })[resource] + '"'))
    assert.equal(list.includes('<table'), false)
  })
}
