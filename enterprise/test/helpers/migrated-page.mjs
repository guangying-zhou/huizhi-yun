import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 本文件在 enterprise/test/helpers/ 下，仓库根要上三层
const read = p => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')

const FRAMEWORK = new Set([
  'NuxtPage', 'NuxtLink', 'NuxtLayout', 'Teleport', 'Transition', 'TransitionGroup',
  'Suspense', 'KeepAlive', 'Component', 'ClientOnly', 'LazyHydrate'
])

/**
 * 迁移页的不变量。这些问题都不会在构建期报错，只会在浏览器里表现为
 * 空白组件、404 或跳错地方，所以必须由测试守住：
 *   1. 路由指向 Aims 原页面，且不再有同路径的 layerPage
 *   2. 无 `~` 别名 —— 宿主里 `~` 指向 enterprise/app，构建期解析失败
 *   3. 模板组件全部显式导入 —— 宿主不自动注册 aims 组件，漏了会静默渲染成未知元素
 *   4. 业务请求与页面跳转经 moduleUrl（或调用方注入的 urlFor）
 */
export function assertMigratedPage({ route, name, source }) {
  const entry = read('aims/layer/entry.mjs')
  const page = read(`aims/app/pages/${source}.vue`)
  const escaped = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  assert.match(entry, new RegExp(`page\\('${escaped(route)}', '${escaped(name)}', '${escaped(source)}'\\)`),
    `entry.mjs 未把 ${route} 注册为原页面 ${source}`)
  assert.doesNotMatch(entry, new RegExp(`layerPage\\('${escaped(route)}'`),
    `${route} 仍存在 layerPage 注册`)

  assert.doesNotMatch(page, /from '~~?\//, `${source} 仍有 ~ 别名导入`)

  const start = page.indexOf('<template>')
  const template = start >= 0 ? page.slice(start, page.lastIndexOf('</template>')) : ''
  for (const tag of new Set([...template.matchAll(/<([A-Z][A-Za-z]+)[\s/>]/g)].map(m => m[1]))) {
    if (tag.startsWith('U') || FRAMEWORK.has(tag)) continue
    assert.match(page, new RegExp(`import ${tag} from`), `${source} 模板用了 <${tag}> 但未显式导入`)
  }

  for (const m of page.matchAll(/(['`])(\/api\/[^'`]*)\1/g)) {
    const before = page.slice(Math.max(0, m.index - 12), m.index)
    assert.ok(before.includes('moduleUrl(') || before.includes('urlFor('),
      `${source} 存在未经 moduleUrl 的调用 ${m[2]}`)
  }
}
