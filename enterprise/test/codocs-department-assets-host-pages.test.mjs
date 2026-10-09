import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse, compileTemplate } from '@vue/compiler-sfc'

test('department asset Host pages and browser compile as complete Vue SFC templates', () => {
  for (const component of ['pages/departments/records', 'pages/departments/outsides', 'pages/departments/rules', 'components/department/AssetBrowser', 'components/published/AssetDocument']) {
    const filename = fileURLToPath(new URL(`../../codocs/app/${component}.vue`, import.meta.url))
    const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
    assert.deepEqual(errors, [], component)
    assert.ok(descriptor.template, component)
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: `codocs-dept-${component}` }).errors, [], component)
  }
})

test('three department asset navigation links are registered with departments:view', async () => {
  const { default: entry } = await import('../../codocs/layer/entry.mjs')
  const paths = new Set(entry.pages.map(page => page.path))
  for (const segment of ['records', 'outsides', 'rules']) {
    const item = entry.navigation.find(value => value.to === `/codocs/departments/${segment}`)
    assert.ok(item)
    assert.deepEqual(item.permission, { resource: 'departments', action: 'view' })
    assert.equal(item.group, 'department')
    assert.ok(paths.has(`/departments/${segment}`))
  }
  const filename = fileURLToPath(new URL('../../codocs/app/components/department/AssetBrowser.vue', import.meta.url))
  const source = readFileSync(filename, 'utf8')
  assert.match(source, /useCodocsModule\(/)
  assert.match(source, /moduleUrl\('\/api\/dept-assets\//)
})
