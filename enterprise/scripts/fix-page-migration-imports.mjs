// 批量修复迁移页面闭包里的导入问题。消费 check-page-migration.mjs --json，
// 只处理导入层（别名、缺显式导入、模板组件），不碰 moduleUrl 包装——
// 那一类要在函数体内加 Nuxt 上下文调用，风险不同，单独一轮做。
//
// 默认 dry-run，--apply 才写入。
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const apply = process.argv.includes('--apply')
const input = process.argv.find(a => a.endsWith('.json'))
if (!input) { console.error('用法: node fix-page-migration-imports.mjs <closure.json> [--apply]'); process.exit(2) }

const relImport = (fromFile, toFile) => {
  let path = relative(dirname(resolve(root, fromFile)), resolve(root, toFile)).replace(/\.ts$/, '')
  if (!path.startsWith('.')) path = './' + path
  return path
}

// 插在最后一条 import 之后：保持既有顺序，避免把导入插进 <template> 或函数体
function insertImports(source, lines) {
  if (!lines.length) return source
  const scriptStart = source.indexOf('<script')
  const bodyStart = scriptStart >= 0 ? source.indexOf('>', scriptStart) + 1 : 0
  const region = source.slice(bodyStart)
  // 必须匹配完整语句：`^import .*$` 会命中多行 import 的首行（`import {`），
  // 插在那之后会把新导入塞进原语句内部，产生语法错误。
  const imports = [...region.matchAll(/^import\b[\s\S]*?from\s+'[^']*'\s*;?$/gm)]
  if (imports.length) {
    const last = imports[imports.length - 1]
    const at = bodyStart + last.index + last[0].length
    return source.slice(0, at) + '\n' + lines.join('\n') + source.slice(at)
  }
  return source.slice(0, bodyStart) + '\n' + lines.join('\n') + source.slice(bodyStart)
}

const closure = JSON.parse(readFileSync(resolve(root, input), 'utf8'))
const byFile = new Map()
for (const entry of closure) {
  for (const f of entry.files) {
    const prev = byFile.get(f.file) || { aliases: new Set(), symbols: new Map(), components: new Map() }
    f.aliases.forEach(a => prev.aliases.add(a))
    f.missingSymbols.forEach(s => prev.symbols.set(s.name, s.src))
    f.unregisteredComponents.forEach(c => prev.components.set(c.name, c.src))
    byFile.set(f.file, prev)
  }
}

let changed = 0, aliasCount = 0, symbolCount = 0, componentCount = 0
for (const [file, work] of [...byFile].sort()) {
  let source = readFileSync(resolve(root, file), 'utf8')
  const before = source
  const notes = []

  for (const alias of work.aliases) {
    const target = 'aims/app/' + alias.replace(/^~~?\//, '')
    const replacement = relImport(file, target)
    const pattern = new RegExp(`(from\\s+')${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(')`, 'g')
    const next = source.replace(pattern, `$1${replacement}$2`)
    if (next !== source) { source = next; aliasCount++; notes.push(`别名 ${alias} -> ${replacement}`) }
  }

  const lines = []
  for (const [name, src] of work.symbols) {
    if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b`).test(source)) continue
    lines.push(`import { ${name} } from '${relImport(file, src)}'`)
    symbolCount++
  }
  for (const [name, src] of work.components) {
    if (new RegExp(`import\\s+${name}\\s+from`).test(source)) continue
    lines.push(`import ${name} from '${relImport(file, src)}'`)
    componentCount++
  }
  source = insertImports(source, lines)
  lines.forEach(l => notes.push(l))

  if (source !== before) {
    changed++
    console.log(`\n${file}`)
    notes.forEach(n => console.log(`   ${n}`))
    if (apply) writeFileSync(resolve(root, file), source)
  }
}
console.log(`\n${apply ? '已写入' : 'DRY-RUN（加 --apply 执行）'}  文件 ${changed}  别名 ${aliasCount}  缺导入 ${symbolCount}  组件 ${componentCount}`)
