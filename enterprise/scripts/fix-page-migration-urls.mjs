// 把闭包内的裸 URL 与裸跳转包进 moduleUrl。默认 dry-run，--apply 才写入。
//
// 与导入那一轮分开做：这一类要在函数体内调用 useAimsModule()，依赖 Nuxt 上下文。
// 纯 util / config 模块在模块作用域没有该上下文，脚本会跳过并单独列出，不做一刀切。
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const apply = process.argv.includes('--apply')
const input = process.argv.find(a => a.endsWith('.json'))
if (!input) { console.error('用法: node fix-page-migration-urls.mjs <closure.json> [--apply]'); process.exit(2) }

const relImport = (fromFile, to) => {
  let p = relative(dirname(resolve(root, fromFile)), resolve(root, to))
  if (!p.startsWith('.')) p = './' + p
  return p
}

function classify(file, source) {
  if (file.endsWith('.vue')) return source.includes('<script setup') ? 'vue-setup' : 'unsupported'
  if (/defineStore\([^,]+,\s*\(\)\s*=>/.test(source)) return 'store-setup'
  if (file.includes('/composables/')) return 'composable'
  return 'unsupported'
}

// 取用点必须在有 Nuxt 上下文的作用域内，不能放模块顶层
function ensureAccessor(source, file, kind) {
  if (/const\s*\{[^}]*\bmoduleUrl\b[^}]*\}\s*=\s*useAimsModule\(\)/.test(source)) return source
  const note = '// 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。'
  const decl = `${note}\nconst { moduleUrl } = useAimsModule()`
  if (kind === 'vue-setup') {
    const imports = [...source.matchAll(/^import\b[\s\S]*?from\s+'[^']*'\s*;?$/gm)]
    const last = imports[imports.length - 1]
    const at = last ? last.index + last[0].length : source.indexOf('>', source.indexOf('<script')) + 1
    return source.slice(0, at) + '\n\n' + decl + source.slice(at)
  }
  if (kind === 'store-setup') {
    const m = source.match(/defineStore\([^,]+,\s*\(\)\s*=>\s*\{/)
    return source.slice(0, m.index + m[0].length) + `\n  ${note}\n  const { moduleUrl } = useAimsModule()` + source.slice(m.index + m[0].length)
  }
  // composable：插入第一个导出函数体内
  const m = source.match(/export\s+(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*\{/)
  if (!m) return null
  return source.slice(0, m.index + m[0].length) + `\n  ${note}\n  const { moduleUrl } = useAimsModule()` + source.slice(m.index + m[0].length)
}

function ensureImport(source, file) {
  if (/import\s*\{[^}]*\buseAimsModule\b/.test(source)) return source
  const line = `import { useAimsModule } from '${relImport(file, 'aims/layer/useAimsModule')}'`
  const imports = [...source.matchAll(/^import\b[\s\S]*?from\s+'[^']*'\s*;?$/gm)]
  if (imports.length) {
    const first = imports[0]
    return source.slice(0, first.index) + line + '\n' + source.slice(first.index)
  }
  const scriptEnd = source.indexOf('>', source.indexOf('<script'))
  return scriptEnd >= 0 ? source.slice(0, scriptEnd + 1) + '\n' + line + source.slice(scriptEnd + 1) : line + '\n' + source
}

// 只处理脚本段：模板里的 :to 绑定另行处理，避免误改静态文案
function scriptRange(source) {
  if (!source.includes('<script')) return [0, source.length]
  const start = source.indexOf('>', source.indexOf('<script')) + 1
  const end = source.lastIndexOf('</script>')
  return [start, end > start ? end : source.length]
}

const closure = JSON.parse(readFileSync(resolve(root, input), 'utf8'))
const files = new Set()
for (const e of closure) for (const f of e.files) if (f.bareCalls.length || f.bareLinks.length) files.add(f.file)

let changed = 0, calls = 0, links = 0
const skipped = []
for (const file of [...files].sort()) {
  let source = readFileSync(resolve(root, file), 'utf8')
  const kind = classify(file, source)
  if (kind === 'unsupported') { skipped.push(`${file}（模块作用域无 Nuxt 上下文）`); continue }

  const [start, end] = scriptRange(source)
  let body = source.slice(start, end)
  const before = body
  body = body.replace(/(['`])(\/api\/[^'`]*)\1/g, (m, q, path, offset) => {
    const pre = body.slice(Math.max(0, offset - 12), offset)
    if (pre.includes('moduleUrl(')) return m
    calls++
    return `moduleUrl(${q}${path}${q})`
  })
  body = body.replace(/(navigateTo|router\.(?:push|replace))\(\s*(['`])(\/(?!api\/)[^'`]*)\2/g, (m, fn, q, path, offset) => {
    const pre = body.slice(Math.max(0, offset - 4 - fn.length), offset)
    if (pre.includes('moduleUrl(')) return m
    links++
    return `${fn}(moduleUrl(${q}${path}${q})`
  })
  if (body === before) continue

  source = source.slice(0, start) + body + source.slice(end)
  source = ensureImport(source, file)
  const withAccessor = ensureAccessor(source, file, kind)
  if (!withAccessor) { skipped.push(`${file}（找不到可插入取用点）`); continue }
  changed++
  console.log(`  ${file.replace('aims/app/', '')}`)
  if (apply) writeFileSync(resolve(root, file), withAccessor)
}
if (skipped.length) { console.log('\n跳过（需人工判断）:'); skipped.forEach(s => console.log('   ' + s)) }
console.log(`\n${apply ? '已写入' : 'DRY-RUN（加 --apply 执行）'}  文件 ${changed}  调用 ${calls}  跳转 ${links}`)
