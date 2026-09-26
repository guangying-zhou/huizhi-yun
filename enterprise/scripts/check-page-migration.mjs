// 检查一个 Aims 页面迁入企业宿主还缺什么。只读，不修改任何文件。
//
// 三类问题只在构建或运行时才暴露，逐页试错代价太高：
//   1. `~` / `~~` 别名 —— 宿主构建里 `~` 指向 enterprise/app，解析不到 aims 的文件
//   2. 自动导入 —— aims 自动导入自己的 composables/utils/stores/components，宿主不会
//   3. 传递依赖 —— 上面两类拉进来的 store 自身还会发请求，且可能再带出新的自动导入
//
// 用法：node enterprise/scripts/check-page-migration.mjs <页面路径…>
//      node enterprise/scripts/check-page-migration.mjs --all   （所有 layerPage 对应的原页面）
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, relative, dirname, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = path => readFileSync(resolve(root, path), 'utf8')
const walk = dir => {
  const full = resolve(root, dir)
  if (!existsSync(full)) return []
  return readdirSync(full, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
}

// Nuxt 默认自动导入 composables/ 与 utils/；@pinia/nuxt 自动导入 stores/；
// components/ 下的组件按文件名注册。config/ 与 types/ 不在其中，本就需要显式导入。
function autoImportIndex() {
  const symbols = new Map()
  for (const dir of ['aims/app/composables', 'aims/app/utils', 'aims/app/stores']) {
    for (const file of walk(dir)) {
      if (!file.endsWith('.ts')) continue
      const source = read(file)
      for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) symbols.set(m[1], file)
      for (const m of source.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)) symbols.set(m[1], file)
    }
  }
  const components = new Map()
  for (const file of walk('aims/app/components')) {
    if (file.endsWith('.vue')) components.set(basename(file, '.vue'), file)
  }
  // Foundation 是两边共同的 Layer，其组件在宿主里同样自动注册，不需要显式导入。
  const foundationComponents = new Set()
  for (const file of walk('foundation/app/components')) {
    if (file.endsWith('.vue')) foundationComponents.add(basename(file, '.vue'))
  }
  return { symbols, components, foundationComponents }
}

// <NuxtPage/> 壳页面的功能在子路由里：pages/x.vue 的子页在 pages/x/ 目录下。
// 不跟进去，壳页会被误判成零缺口。
function childRoutes(file) {
  if (!file.endsWith('.vue')) return []
  const source = readFileSync(resolve(root, file), 'utf8')
  if (!/<NuxtPage\b/.test(source)) return []
  const dir = file.replace(/\.vue$/, '')
  return walk(dir).filter(f => f.endsWith('.vue'))
}

// Foundation 是共同 Layer，其 server/api 路由在两种模式下都挂在根路径，
// 不能加模块前缀；包进 moduleUrl 反而打不中。
function foundationRoutes() {
  const base = 'foundation/server/api'
  const set = new Set()
  for (const file of walk(base)) {
    const m = file.slice(base.length + 1).match(/^(.*)\.(get|post|put|patch|delete)\.ts$/)
    if (!m) continue
    set.add(`/api/${m[1].replace(/\/index$/, '').replace(/\[[^\]]+\]/g, ':id')}`)
  }
  return set
}

function hostRoutes() {
  // 扫整棵 aims/api 树：兼容路径（例如 /api/account/…）不在 /api/v1 下，
  // 只扫 v1 会把已提供的端点误报成缺失。
  const base = 'enterprise/server/routes/aims/api'
  const set = new Set()
  for (const file of walk(base)) {
    const m = file.slice(base.length + 1).match(/^(.*)\.(get|post|put|patch|delete)\.ts$/)
    if (!m) continue
    set.add(`${m[2].toUpperCase()} /api/${m[1].replace(/\/index$/, '').replace(/\[[^\]]+\]/g, ':id')}`)
  }
  return set
}

// 只取脚本段，避免模板里的字符串被当成导入或调用
// 框架内置与 Nuxt UI 前缀不需要显式导入
const FRAMEWORK_TAGS = new Set([
  'NuxtPage', 'NuxtLink', 'NuxtLayout', 'Teleport', 'Transition', 'TransitionGroup',
  'Suspense', 'KeepAlive', 'Component', 'ClientOnly', 'LazyHydrate'
])

const scriptOf = source => {
  const parts = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
  return parts.length ? parts.join('\n') : source
}
const templateOf = source => {
  const start = source.indexOf('<template>')
  const end = source.lastIndexOf('</template>')
  return start >= 0 && end > start ? source.slice(start, end) : ''
}

function analyse(file, index, seen) {
  if (seen.has(file)) return null
  seen.add(file)
  const source = read(file)
  const script = scriptOf(source)
  const template = templateOf(source)
  const imported = new Set()
  for (const m of script.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()
      if (name) imported.add(name.trim())
    }
  }
  for (const m of script.matchAll(/import\s+([A-Za-z0-9_]+)\s+from/g)) imported.add(m[1])
  // 本文件内定义的同名符号不算缺失
  const declared = new Set()
  for (const m of script.matchAll(/(?:function|const|let|class)\s+([A-Za-z0-9_]+)/g)) declared.add(m[1])

  const aliases = [...new Set([...script.matchAll(/from\s+'(~~?\/[^']*)'/g)].map(m => m[1]))]
  // 显式相对导入同样要进闭包：已改造的文件看起来"没有自动导入"，但依赖仍在
  const relatives = []
  for (const m of script.matchAll(/from\s+'(\.[^']*)'/g)) {
    for (const suffix of ['', '.ts', '.vue', '/index.ts']) {
      const candidate = resolve(dirname(resolve(root, file)), m[1] + suffix)
      if (existsSync(candidate) && !candidate.endsWith('/')) {
        const rel = relative(root, candidate)
        if (rel.startsWith('aims/app/') && extname(rel)) relatives.push(rel)
        break
      }
    }
  }
  const missingSymbols = []
  for (const [name, src] of index.symbols) {
    if (imported.has(name) || declared.has(name)) continue
    if (new RegExp(`\\b${name}\\s*\\(`).test(script)) missingSymbols.push({ name, src })
  }
  const usedComponents = []
  const unregisteredComponents = []
  for (const [name, src] of index.components) {
    if (!new RegExp(`<${name}[\\s/>]`).test(template)) continue
    usedComponents.push({ name, src })
    if (!imported.has(name)) unregisteredComponents.push({ name, src })
  }
  // 模板里出现、但仓库中根本没有对应组件文件、也没有显式导入的大写标签。
  // 之前只对照已存在的组件文件，找不到就当"不是组件"跳过，于是
  // <WorkItemSourceSectionViewer>（组件不存在，原应用同样渲染为空）被漏报。
  const unresolvedComponents = []
  for (const tag of new Set([...template.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map(m => m[1]))) {
    if (tag.startsWith('U') || FRAMEWORK_TAGS.has(tag)) continue
    if (index.components.has(tag) || imported.has(tag) || index.foundationComponents.has(tag)) continue
    unresolvedComponents.push(tag)
  }
  // 页面跳转同样要经 moduleUrl：宿主里业务路由在 /aims 前缀下，
  // 裸路径会跳到宿主根部而不是模块内（members.vue 的 navigateTo 即是一例）。
  const links = []
  for (const m of script.matchAll(/(?:navigateTo|router\.(?:push|replace))\(\s*(['`])(\/[^'`]*)\1/g)) {
    if (m[2].startsWith('/api/')) continue
    const before = script.slice(Math.max(0, m.index - 60), m.index)
    if (!/moduleUrl\(\s*$/.test(before)) links.push(m[2].replace(/\$\{[^}]*\}/g, ':id'))
  }

  // 调用方实际发送的 query 键。宿主与运行时的白名单必须按这个写，
  // 靠推测会让整页 400（已发生三次：lifecycleStatus / participating_only / filter+uid）。
  const queryKeys = new Set()
  for (const m of script.matchAll(/params\.set\(\s*['`]([A-Za-z0-9_]+)['`]/g)) queryKeys.add(m[1])
  for (const m of script.matchAll(/\bparams:\s*\{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(/([A-Za-z0-9_]+)\s*:/g)) queryKeys.add(k[1])
  }
  for (const m of script.matchAll(/\bquery:\s*\{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(/([A-Za-z0-9_]+)\s*:/g)) queryKeys.add(k[1])
  }
  for (const m of script.matchAll(/[?&]([A-Za-z0-9_]+)=/g)) queryKeys.add(m[1])

  // API：不限 /api/v1，legacy /api/account 这类同样要发现
  const calls = []
  const wronglyWrapped = []
  for (const m of script.matchAll(/(['`])(\/api\/[^'`]*)\1/g)) {
    const path = m[2].replace(/\$\{[^}]*\}/g, ':id').split('?')[0].replace(/\/$/, '')
    // urlFor( 是调用方注入的构造器：用于事件处理器里调用的普通函数，
    // 那里不保证有 Nuxt 实例，不能直接调 useAimsModule。同样算已包装。
    const before = script.slice(Math.max(0, m.index - 12), m.index)
    const explicitlyWrapped = before.includes('moduleUrl(') || before.includes('urlFor(')
    // Foundation 共享端点挂在根路径：不该包 moduleUrl，因此也不算"裸调用"。
    // 判定要分开——把它一律视作已包装，会让每条 Foundation 端点都被误报成"误包"。
    const isFoundation = FOUNDATION_ROUTES.has(path)
    const wrapped = explicitlyWrapped || isFoundation
    const after = script.slice(m.index, m.index + 220)
    const method = (after.match(/method:\s*'([A-Za-z]+)'/) || [])[1] || 'GET'
    calls.push({ path, method: method.toUpperCase(), wrapped })
    if (explicitlyWrapped && isFoundation) wronglyWrapped.push(path)
  }
  return { file, aliases, missingSymbols, usedComponents, unregisteredComponents, unresolvedComponents, calls, wronglyWrapped, relatives, links, queryKeys: [...queryKeys].sort() }
}

function report(entry, index, host) {
  const seen = new Set()
  const queue = [entry]
  const results = []
  while (queue.length) {
    const file = queue.shift()
    const result = analyse(file, index, seen)
    if (!result) continue
    results.push(result)
    for (const { src } of result.usedComponents) queue.push(src)
    for (const { src } of result.missingSymbols) queue.push(src)
    for (const src of result.relatives) queue.push(src)
    for (const child of childRoutes(file)) queue.push(child)
  }
  const aliases = [], symbols = [], components = [], unresolved = [], wrongWrap = new Set(), bareLinks = new Set(), apis = new Map(), queryKeys = new Set()
  for (const r of results) {
    for (const a of r.aliases) aliases.push(`${relative('aims/app', r.file)} : ${a}`)
    for (const s of r.missingSymbols) symbols.push(`${relative('aims/app', r.file)} : ${s.name} <- ${relative('aims/app', s.src)}`)
    for (const c of r.unregisteredComponents) components.push(`${relative('aims/app', r.file)} : <${c.name}> <- ${relative('aims/app', c.src)}`)
    for (const l of r.links) bareLinks.add(`${relative('aims/app', r.file)} : ${l}`)
    for (const k of r.queryKeys) queryKeys.add(k)
    for (const p of r.wronglyWrapped || []) wrongWrap.add(`${relative('aims/app', r.file)} : ${p}`)
    for (const tag of r.unresolvedComponents || []) unresolved.push(`${relative('aims/app', r.file)} : <${tag}> 仓库中无此组件`)
    for (const c of r.calls) {
      const key = `${c.method} ${c.path}`
      const prev = apis.get(key) || { wrapped: true, from: new Set() }
      prev.wrapped = prev.wrapped && c.wrapped
      prev.from.add(relative('aims/app', r.file))
      apis.set(key, prev)
    }
  }
  // 冒号动作（/weeks/2026-W30:submit）在 Nitro 里属于同一个路径段，
  // [periodKey] 会整段匹配，由 handler 自己剥离动作后缀。
  // 因此 `X:action` 找不到时，退回检查参数形式 `X`。
  // 宿主路由里的 :id 是参数段，调用方可能写字面量（/work-calendars/CN/days）。
  // 按段比对并把 :id 当通配，否则会把已提供的端点误报成缺失。
  const hostPatterns = [...host].map(k => {
    const [method, path] = k.split(' ')
    return { method, segments: path.split('/') }
  })
  const matches = key => {
    const [method, path] = key.split(' ')
    const segments = path.split('/')
    return hostPatterns.some(p => p.method === method
      && p.segments.length === segments.length
      && p.segments.every((seg, i) => seg === segments[i] || seg.startsWith(':')))
  }
  const served = key => matches(key) || matches(key.replace(/(:[a-z][a-zA-Z0-9-]*)$/, ''))
    || FOUNDATION_ROUTES.has(key.split(' ')[1])
  const missingApis = [...apis.keys()].filter(k => !served(k)).sort()
  const unwrapped = [...apis.entries()].filter(([, v]) => !v.wrapped).map(([k]) => k).sort()
  return { entry, files: results.length, aliases, symbols, components, unresolved, wrongWrap: [...wrongWrap].sort(), bareLinks: [...bareLinks].sort(), queryKeys: [...queryKeys].sort(), apis, missingApis, unwrapped }
}

// --json 输出逐文件明细，供批量修复脚本消费（同一套分析，避免第二份实现漂移）
const args = process.argv.slice(2).filter(a => a !== '--json')
const asJson = process.argv.includes('--json')
const targets = args.includes('--all')
  ? [...read('aims/layer/entry.mjs').matchAll(/layerPage\('([^']+)'/g)].map(m => m[1]).map(p => `（未映射）${p}`)
  : args
if (!targets.length) {
  console.error('用法: node enterprise/scripts/check-page-migration.mjs <aims/app/pages/... .vue>')
  process.exit(2)
}
const FOUNDATION_ROUTES = foundationRoutes()
const index = autoImportIndex()
const host = hostRoutes()
let blocking = 0
if (asJson) {
  const out = []
  for (const target of targets) {
    if (!existsSync(resolve(root, target))) continue
    const seen = new Set(); const queue = [target]; const files = []
    while (queue.length) {
      const file = queue.shift()
      const r = analyse(file, index, seen)
      if (!r) continue
      files.push(r)
      for (const { src } of r.usedComponents) queue.push(src)
      for (const { src } of r.missingSymbols) queue.push(src)
      for (const src of r.relatives) queue.push(src)
    for (const child of childRoutes(file)) queue.push(child)
    }
    out.push({ entry: target, files: files.map(f => ({
      file: f.file,
      aliases: f.aliases,
      missingSymbols: f.missingSymbols,
      unregisteredComponents: f.unregisteredComponents,
      bareCalls: f.calls.filter(c => !c.wrapped).map(c => c.path),
      bareLinks: f.links
    })) })
  }
  console.log(JSON.stringify(out, null, 1))
  process.exit(0)
}
for (const target of targets) {
  if (!existsSync(resolve(root, target))) { console.log(`\n### ${target}\n  文件不存在`); continue }
  const r = report(target, index, host)
  console.log(`\n### ${target}`)
  console.log(`  闭包文件数 ${r.files}    API ${r.apis.size} 个`)
  const section = (label, items) => {
    if (!items.length) { console.log(`  ${label}: 无`); return }
    blocking += items.length
    console.log(`  ${label} (${items.length}):`)
    items.forEach(i => console.log(`     ${i}`))
  }
  section('别名导入（必须改相对路径）', aliasesOf(r))
  section('缺显式导入（宿主不自动导入）', r.symbols)
  section('模板用了但未导入的组件（会渲染成空的未知元素）', r.components)
  section('无法解析的模板组件（仓库中不存在，原应用同样为空）', r.unresolved)
  section('误加 moduleUrl 的 Foundation 端点（加前缀会打不中）', r.wrongWrap)
  section('未经 moduleUrl 的调用', r.unwrapped)
  section('未经 moduleUrl 的页面跳转', r.bareLinks)
  section('宿主缺少的端点', r.missingApis)
  // 提示而非阻断：白名单该覆盖哪些键，按这里的事实写
  if (r.queryKeys.length) console.log(`  调用方发送的 query 键 (${r.queryKeys.length}): ${r.queryKeys.join(' ')}`)
}
function aliasesOf(r) { return r.aliases }
process.exit(blocking ? 1 : 0)
