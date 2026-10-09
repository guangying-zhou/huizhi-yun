import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { effectScope, nextTick, reactive, ref, watch } from 'vue'
import {
  canonicalProductPerspective,
  getProductPerspectives,
  hostProductPerspectives,
  normalizeProductRequestQuery,
  productNavTo,
  productNavItemMatches,
  resolveProductPerspective
} from '../app/config/productNavigation.ts'

const perspectives = getProductPerspectives('P-001')
const base = '/products/P-001'

test('Enterprise Host product navigation contains only registered page families', () => {
  const hosted = hostProductPerspectives(perspectives)
  assert.deepEqual(hosted.map(item => item.key), ['overview', 'rd', 'gtm'])
  const paths = hosted.flatMap(item => [item.path, ...item.items.flatMap(child => [child.path, ...(child.extraPaths || [])])])
  for (const unavailable of ['/objectives', '/settings', '/feature-version-matrix', '/release-comparison', '/views']) {
    assert.equal(paths.some(path => path.includes(unavailable)), false, unavailable)
  }
  for (const available of ['/requests', '/versions', '/structure', '/features', '/components', '/adoption', '/cycles', '/execution-coordination', '/planning']) {
    assert.equal(paths.some(path => path.endsWith(available)), true, available)
  }
})

describe('product workspace navigation', () => {
  test('组织为三个工作视角，而不是平铺的功能页签', () => {
    assert.deepEqual(perspectives.map(item => item.key), ['overview', 'rd', 'gtm', 'ops', 'settings'])
    assert.deepEqual(
      perspectives.filter(item => item.items.length > 0).map(item => item.label),
      ['产品与研发', '销售与交付', '经营与管理']
    )
    // 每个视角的二级入口保持在可扫描范围内，低频入口收敛到「更多」。
    for (const perspective of perspectives) {
      assert.ok(perspective.items.length <= 7, `${perspective.label} 二级入口过多`)
    }
  })

  test('产品与研发仅显示需求池、版本计划、产品结构，并默认进入需求池', () => {
    const rd = perspectives.find(item => item.key === 'rd')!
    assert.equal(rd.path, `${base}/requests`)
    assert.deepEqual(rd.items.map(item => item.label), ['需求池', '版本计划', '产品结构'])
    assert.deepEqual(rd.more, [])
    assert.equal(rd.items[0]?.path, `${base}/requests`)
    assert.equal(rd.items[2]?.path, `${base}/structure`)
  })

  test('旧页面及其详情准确归入三项工作入口，不匹配相似前缀', () => {
    const rd = perspectives.find(item => item.key === 'rd')!
    const entryFor = (path: string) => rd.items.filter(item => productNavItemMatches(`${base}/${path}`, item)).map(item => item.label)
    for (const path of ['requests']) assert.deepEqual(entryFor(path), ['需求池'])
    for (const path of ['versions', 'versions/5/plan', 'execution-coordination', 'feature-version-matrix', 'release-comparison', 'views/2', 'planning', 'planning-items/9/handoff', 'cycles/3/roadmap']) {
      assert.deepEqual(entryFor(path), ['版本计划'], path)
    }
    for (const path of ['structure', 'features', 'features/9/lifecycle', 'components']) {
      assert.deepEqual(entryFor(path), ['产品结构'], path)
    }
    for (const path of ['planning-other', 'requests-other', 'features-old', 'models']) assert.deepEqual(entryFor(path), [])
  })

  test('评分模型归入设置并保持设置没有二级页签', () => {
    const settings = perspectives.find(item => item.key === 'settings')!
    assert.deepEqual(settings.items, [])
    assert.deepEqual(settings.more, [])
    for (const path of ['models', 'models/3']) {
      assert.equal(canonicalProductPerspective(perspectives, `${base}/${path}`), 'settings')
      assert.equal(resolveProductPerspective(perspectives, `${base}/${path}`, 'rd'), 'settings')
    }
  })

  test('每个视角声明面向岗位与优先呈现内容', () => {
    for (const perspective of perspectives) {
      assert.ok(perspective.audience.length > 0, `${perspective.label} 缺少面向岗位`)
      assert.ok(perspective.summary.length > 0, `${perspective.label} 缺少呈现内容`)
    }
  })

  test('视角入口指向已存在的产品页面路由', () => {
    const routes = new Set<string>()
    for (const perspective of perspectives) {
      routes.add(perspective.path)
      for (const path of perspective.extraPaths || []) routes.add(path)
      for (const item of [...perspective.items, ...perspective.more]) routes.add(item.path)
    }
    for (const route of routes) {
      assert.ok(route === base || route.startsWith(`${base}/`), `${route} 不在产品工作台下`)
      // 页签必须对应真实页面文件，避免留下打不开的入口。
      const rest = route.slice(base.length).replace(/^\//, '')
      const pages = rest
        ? [`../app/pages/products/[productCode]/${rest}.vue`, `../app/pages/products/[productCode]/${rest}/index.vue`]
        : ['../app/pages/products/[productCode]/index.vue']
      assert.ok(
        pages.some(page => existsSync(new URL(page, import.meta.url))),
        `${route} 没有对应页面文件`
      )
    }
    // 概览与设置不再依赖详情页里的按钮墙。
    assert.equal(perspectives[0]?.path, base)
    assert.equal(perspectives.at(-1)?.path, `${base}/settings`)
  })

  test('跨视角复用的页面有确定归属，并只在需要时带 view 参数', () => {
    assert.equal(canonicalProductPerspective(perspectives, `${base}/versions`), 'rd')
    assert.equal(canonicalProductPerspective(perspectives, `${base}/adoption`), 'gtm')
    assert.equal(canonicalProductPerspective(perspectives, `${base}/objectives`), 'ops')

    assert.deepEqual(productNavTo(perspectives, 'rd', `${base}/versions`), { path: `${base}/versions` })
    assert.deepEqual(productNavTo(perspectives, 'gtm', `${base}/versions`), { path: `${base}/versions`, query: { view: 'gtm' } })
    assert.deepEqual(productNavTo(perspectives, 'ops', `${base}/adoption`), { path: `${base}/adoption`, query: { view: 'ops' } })
  })

  test('子路由沿用父入口的视角高亮', () => {
    assert.equal(resolveProductPerspective(perspectives, `${base}/features/9/lifecycle`, undefined), 'rd')
    assert.equal(resolveProductPerspective(perspectives, `${base}/planning-items/9`, undefined), 'rd')
    assert.equal(resolveProductPerspective(perspectives, `${base}/cycles/3/roadmap`, undefined), 'rd')
    assert.equal(resolveProductPerspective(perspectives, `${base}/settings`, undefined), 'settings')
    assert.equal(resolveProductPerspective(perspectives, base, undefined), 'overview')
    // 前缀相近的两个页面不能互相吞掉。
    assert.equal(canonicalProductPerspective(perspectives, `${base}/cost`), 'ops')
    assert.equal(canonicalProductPerspective(perspectives, `${base}/cost-rules`), 'ops')
  })

  test('显式 view 只在该视角确实包含当前页面时生效', () => {
    assert.equal(resolveProductPerspective(perspectives, `${base}/versions`, 'gtm'), 'gtm')
    assert.equal(resolveProductPerspective(perspectives, `${base}/versions`, ['gtm']), 'gtm')
    // 过期或伪造的 view 回落到页面归属视角，不产生错误高亮。
    assert.equal(resolveProductPerspective(perspectives, `${base}/versions`, 'ops'), 'rd')
    assert.equal(resolveProductPerspective(perspectives, `${base}/objectives`, 'gtm'), 'ops')
    assert.equal(resolveProductPerspective(perspectives, `${base}/features`, 'not-a-view'), 'rd')
    assert.equal(resolveProductPerspective(perspectives, `${base}/feature-version-matrix`, 'gtm'), 'gtm')
    assert.equal(resolveProductPerspective(perspectives, `${base}/release-comparison`, 'gtm'), 'gtm')
    assert.equal(resolveProductPerspective(perspectives, `${base}/views/2`, 'gtm'), 'rd')
  })

  test('产品编码进入链接前完成编码', () => {
    const encoded = getProductPerspectives('P/001 A')
    for (const perspective of encoded) {
      assert.ok(perspective.path.startsWith('/products/P%2F001%20A'), perspective.path)
    }
  })

  test('产品概览不再罗列同等权重的入口按钮', () => {
    const overview = readFileSync(new URL('../app/pages/products/[productCode]/index.vue', import.meta.url), 'utf8')
    assert.ok(!overview.includes('返回产品'), '概览页不应保留返回按钮')
    assert.ok(overview.includes('工作视角'), '概览页应按工作视角组织入口')
    // 空间维护能力移交设置页，概览只做只读呈现。
    assert.ok(!overview.includes('ProductsMemberList'), '成员管理应在设置页')
    assert.ok(!overview.includes('ProductsWorkspaceLifecycle'), '归档与恢复应在设置页')
  })
})

test('需求模块旧链接规范化保留创建和列表上下文，并且现代 moduleId 优先', () => {
  const legacy = { componentId: '42', create: 'true', includeDescendants: 'true', keyword: '合同', page: '2' }
  assert.deepEqual(normalizeProductRequestQuery(legacy), { moduleId: '42', create: 'true', includeDescendants: 'true', keyword: '合同', page: '2' })
  assert.equal(legacy.componentId, '42', '不直接修改路由对象')
  assert.deepEqual(normalizeProductRequestQuery({ componentId: '42', moduleId: '9', create: 'true' }), { moduleId: '9', create: 'true' })
  assert.deepEqual(normalizeProductRequestQuery({ componentId: '42', moduleId: '' }), { moduleId: '' }, '显式清空规范筛选不能被旧值复活')
  assert.equal(normalizeProductRequestQuery({ moduleId: '9', create: 'true' }), null, '规范链接不重复重定向')
  assert.equal(normalizeProductRequestQuery({ unassigned: 'true' }), null)
})

test('规范模块链接经过真实 useListPage 初始化、换模块及重置后仍一致', async () => {
  const route = reactive({ query: normalizeProductRequestQuery({ componentId: '42', create: 'true', includeDescendants: 'true' }) as Record<string, unknown> })
  const replacements: Record<string, unknown>[] = []
  const source = readFileSync(new URL('../../foundation/app/composables/useListPage.ts', import.meta.url), 'utf8')
  const script = stripTypeScriptTypes(source).replace('export function useListPage', 'function useListPage')
  const createList = runInNewContext(`${script}; useListPage`, {
    ref, watch, useRoute: () => route, useRouter: () => ({ replace: ({ query }: { query: Record<string, unknown> }) => { replacements.push(query) } })
  })
  const scope = effectScope()
  try {
    const moduleId = ref('')
    const includeDescendants = ref(false)
    const list = scope.run(() => createList({ filters: { moduleId, includeDescendants }, defaults: { moduleId: '', includeDescendants: false } }))!
    assert.equal(moduleId.value, '42', '旧链接在默认空筛选初始化后仍保留模块，可直接用于新增需求预填')
    assert.equal(includeDescendants.value, true)
    route.query = { moduleId: '9', create: 'true' }
    await nextTick()
    assert.equal(moduleId.value, '9', '同一页面改模块时不能沿用上次模块')
    assert.equal(includeDescendants.value, false)
    list.resetFilters()
    await nextTick()
    assert.equal(moduleId.value, '')
    assert.equal(Object.hasOwn(replacements.at(-1)!, 'moduleId'), false)
    assert.equal(Object.hasOwn(replacements.at(-1)!, 'componentId'), false, '重置后旧别名不得复活模块')
  } finally {
    scope.stop()
  }
})

test('需求模块名称仅接受对应模块的短显示提示，不能串名或进入服务端筛选', () => {
  const source = readFileSync(new URL('../app/pages/products/[productCode]/requests.vue', import.meta.url), 'utf8')
  const helper = source.slice(source.indexOf('function moduleDisplayHint('), source.indexOf('const moduleName = computed'))
  const display = runInNewContext(`${stripTypeScriptTypes(helper)}; moduleDisplayHint`)
  assert.equal(display({ moduleNameId: '2', moduleName: '租户与订阅' }, '2'), '租户与订阅')
  assert.equal(display({ moduleNameId: '2', moduleName: '租户与订阅' }, '3'), '')
  assert.equal(display({ moduleNameId: '2', moduleName: '租户与订阅' }, ''), '')
  assert.equal(display({ moduleName: '缺少上下文' }, '2'), '')
  assert.equal(display({ moduleNameId: '2', moduleName: '名'.repeat(256) }, '2'), '')
  assert.equal(display({ moduleNameId: '2', moduleName: '名称\n说明' }, '2'), '')
  assert.equal(display({ moduleNameId: '0', moduleName: '非法编号' }, '0'), '')
  const requestQuery = source.slice(source.indexOf('const query = computed'), source.indexOf('const { data, status'))
  assert.ok(!requestQuery.includes('moduleName'), '显示提示不能进入服务端筛选')
  assert.ok(source.includes('pickedModule.value.name\n  : moduleDisplayHint'), 'Picker 返回的实际名称优先于 URL 提示')
  assert.ok(!source.includes('v-html'), '名称按 Vue 文本插值转义')
})
