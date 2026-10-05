import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createSSRApp, defineComponent, h, ref, computed } from 'vue'
import { renderToString } from '@vue/server-renderer'

const root = new URL('../../', import.meta.url)
async function page(path) {
  const result = await build({
    entryPoints: [new URL(path, root).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], define: { 'import.meta.client': 'false' },
    plugins: [{ name: 'shared-portal-sfc', setup(builder) {
      builder.onLoad({ filter: /\.vue$/ }, ({ path }) => {
        const { descriptor, errors } = parse(readFileSync(path, 'utf8'), { filename: path })
        assert.deepEqual(errors, [])
        if (descriptor.script || descriptor.scriptSetup) {
          return { contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content, loader: 'ts' }
        }
        const template = compileTemplate({ source: descriptor.template.content, filename: path, id: path })
        assert.deepEqual(template.errors, [])
        return { contents: `${template.code}\nexport default { render }`, loader: 'ts' }
      })
    } }]
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.default
}

const day = { workDate: '2026-09-01', dayOfWeek: 2, dayType: 'public_holiday', isWorkday: false, holidayName: '测试假日', source: 'manual' }
const summary = { yearMonth: '2026-09', workdayCount: 22, standardWorkHours: 176, source: 'generated' }
function appFor(component, props) {
  const app = createSSRApp(component, props)
  const box = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.header?.(), slots.body?.(), slots.default?.()]) })
  for (const name of ['UDashboardPanel', 'UCard', 'UBadge', 'UButtonGroup', 'USkeleton']) app.component(name, box)
  for (const name of ['UInput', 'USelect', 'USwitch']) app.component(name, defineComponent({ setup: () => () => h('div', { 'data-edit': name }) }))
  app.component('UButton', defineComponent({ props: ['to', 'label', 'icon'], setup: props => () => h('a', { 'href': props.to, 'data-icon': props.icon }, props.label) }))
  for (const name of ['CommonEmptyState', 'UAlert', 'ContentPageHeader']) app.component(name, defineComponent({ props: ['title', 'description'], setup: props => () => h('p', [props.title, props.description]) }))
  return app
}

test('shared calendar renders monthly/calendar details and keeps edits exclusively in Console mode', async () => {
  const previous = { ref: globalThis.ref, computed: globalThis.computed }
  globalThis.computed = computed
  try {
    const component = await page('foundation/app/components/WorkCalendarOverview.vue')
    globalThis.ref = ref
    const props = { year: 2026, month: 9, months: [summary], days: [day] }
    const calendar = await renderToString(appFor(component, props))
    assert.match(calendar, /测试假日/)
    assert.match(calendar, /176/)
    assert.match(calendar, /min-w-\[560px\]/)
    globalThis.ref = value => ref(value === 'calendar' ? 'list' : value)
    const readonly = await renderToString(appFor(component, props))
    assert.match(readonly, /在控制台编辑/)
    assert.match(readonly, /href="\/console\/work-calendar"/)
    assert.doesNotMatch(readonly, /data-edit|i-lucide-save/)
    const editable = await renderToString(appFor(component, { ...props, readOnly: false, canEdit: true, dayDrafts: { [day.workDate]: day }, isDirty: () => true }))
    for (const control of ['USelect', 'USwitch', 'UInput']) assert.match(editable, new RegExp('data-edit="' + control + '"'))
    assert.match(editable, /i-lucide-save/)
    assert.doesNotMatch(editable, /在控制台编辑/)
  } finally { Object.assign(globalThis, previous) }
})
