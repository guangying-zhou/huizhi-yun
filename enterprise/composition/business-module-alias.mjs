import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { init, parse as parseImports } from 'es-module-lexer'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const modules = ['aims', 'assets', 'codocs', 'altoc']
const suffixes = ['', '.ts', '.js', '.mjs', '.vue', '/index.ts', '/index.js', '/index.vue']

export function resolveBusinessModuleAlias(source, importer) {
  if (!source.startsWith('~/') && !source.startsWith('~~/')) return null
  if (!importer) return null
  const normalized = importer.split('?')[0].replaceAll('\\', '/')
  for (const module of modules) {
    const moduleRoot = resolve(root, module)
    if (normalized !== moduleRoot && !normalized.startsWith(moduleRoot + sep)) continue
    const base = source.startsWith('~~/') ? moduleRoot : resolve(moduleRoot, 'app')
    const target = resolve(base, source.slice(source.indexOf('/') + 1))
    if (target !== base && !target.startsWith(base + sep)) throw Error(`Invalid ${module} module import: ${source}`)
    if (!suffixes.some(suffix => existsSync(target + suffix))) throw Error(`Unresolved ${module} module import: ${source} in ${importer}`)
    return target
  }
  return null
}

function ownedModule(id) {
  const path = id.split('?')[0]
  return modules.find(module => path.startsWith(resolve(root, module) + sep)) || null
}

// ---------------------------------------------------------------------------
// Module-scoped auto-imports.
//
// Standalone, Nuxt auto-imports each module's own app/composables and app/utils.
// The Host is a different Nuxt app, so those names are undefined there unless a
// file imports them explicitly (useAssetLabels / useAssetDictionaries crashed
// composed Assets pages). A global `imports.dirs` would be wrong: Codocs and
// Assets reuse names such as useAuth, usePermissions and useCookieOptions that
// the Host must keep resolving to its single Foundation session. So only files
// owned by a composed module receive that module's names, and only names the
// Host does not already provide itself.
const autoImportDirs = ['app/composables', 'app/utils']
const hostAutoImportDirs = ['foundation/app/composables', 'foundation/app/utils', 'enterprise/app/composables', 'enterprise/app/utils']
const scriptExtensions = new Set(['.ts', '.js', '.mjs'])
let exportCache = null

// Nuxt scans the top level of each directory plus <dir>/<name>/index.*.
function autoImportFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isFile()) return scriptExtensions.has(extname(entry.name)) && !entry.name.endsWith('.d.ts') ? [path] : []
    if (!entry.isDirectory()) return []
    return ['index.ts', 'index.js', 'index.mjs'].map(name => join(path, name)).filter(file => existsSync(file)).slice(0, 1)
  })
}

export function scanAutoImportExports(dirs) {
  const names = new Map()
  for (const dir of dirs) {
    for (const file of autoImportFiles(dir)) {
      const source = readFileSync(file, 'utf8')
      for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s*([A-Za-z_$][\w$]*)/gm)) names.set(m[1], file)
      for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const part of m[1].split(',')) {
          if (part.trim().startsWith('type ')) continue
          const name = part.trim().split(/\s+as\s+/).pop()?.trim()
          if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.set(name, file)
        }
      }
      if (/^export\s+default\s/m.test(source)) {
        const stem = basename(file, extname(file)) === 'index' ? basename(dirname(file)) : basename(file, extname(file))
        names.set(stem.replace(/[-_.](\w)/g, (_, c) => c.toUpperCase()), file)
      }
    }
  }
  return names
}

function autoImportIndex() {
  if (exportCache) return exportCache
  const host = scanAutoImportExports(hostAutoImportDirs.map(dir => resolve(root, dir)))
  const byModule = new Map()
  for (const module of modules) {
    const own = scanAutoImportExports(autoImportDirs.map(dir => resolve(root, module, dir)))
    for (const name of host.keys()) own.delete(name)
    byModule.set(module, own)
  }
  exportCache = { host, byModule }
  return exportCache
}

/** Names a composed module's own files may use without importing them. */
export function businessModuleAutoImports(module) {
  return autoImportIndex().byModule.get(module) || new Map()
}

/** Names the Host itself auto-imports (they win over a module's same-named export). */
export function hostAutoImports() {
  return autoImportIndex().host
}

export function clearBusinessModuleAutoImportCache() {
  exportCache = null
}

// Blank comments and plain string literals so a name that only appears in text
// is not treated as a call. Template literals keep their ${} code.
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, match => ' '.repeat(match.length))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length))
}

// Static import bindings, read textually: es-module-lexer is a JavaScript lexer
// and misreads some raw TypeScript (e.g. `a[i]! / b`), which Vite hands this
// pre-transform before esbuild. Only the alias rewrite still lexes, and only
// for files that actually contain a `~/` specifier, as before.
function importedNames(source) {
  const names = new Set()
  for (const match of source.matchAll(/(?:^|[\n;])\s*import\s+(?:type\s+)?([\w$*{}\s,]+?)\s+from\s*['"]/g)) {
    const clause = match[1]
    for (const part of (clause.match(/\{([^}]*)\}/)?.[1] || '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
    for (const part of clause.replace(/\{[^}]*\}/, '').split(',')) {
      const name = part.trim().replace(/^\*\s*as\s+/, '')
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return names
}

/**
 * Module-owned auto-import names that `source` (one module file's script) calls
 * without importing or declaring them. `templateUsage` is the SFC template when
 * the imports land in <script setup>, whose bindings the template can reach.
 */
export function missingModuleAutoImports(module, source, templateUsage = '') {
  const available = businessModuleAutoImports(module)
  if (!available.size) return []
  const bound = importedNames(source)
  const code = codeOnly(source)
  const usage = `${code}\n${templateUsage}`
  const missing = []
  for (const [name, file] of available) {
    if (bound.has(name)) continue
    const escaped = name.replace(/\$/g, '\\$')
    if (!new RegExp(`(?<![\\w$.])${escaped}\\s*(?:\\(|<)`).test(usage)) continue
    const declared = new RegExp(`\\b(?:function\\s*\\*?|const|let|var|class)\\s+${escaped}(?![\\w$])|\\b(?:const|let|var)\\s*\\{[^}]*(?<![\\w$])${escaped}(?![\\w$])[^}]*\\}\\s*=`)
    if (declared.test(code)) continue
    missing.push({ name, file })
  }
  return missing
}

// 'sfc' = full Vue file, 'script' = JS/TS module or a Vue script sub-request.
function requestKind(id) {
  const [path, query = ''] = id.split('?')
  if (path.endsWith('.vue')) {
    if (!query) return 'sfc'
    const params = new URLSearchParams(query)
    if (params.get('type') === 'script') return 'script'
    return null
  }
  return scriptExtensions.has(extname(path)) ? 'script' : null
}

export async function rewriteBusinessModuleImports(code, id) {
  const module = ownedModule(id)
  if (!module) return null
  const inject = requestKind(id)
  if (!inject && !code.includes('~/') && !code.includes('~~/')) return null
  const blocks = []
  if (id.split('?')[0].endsWith('.vue') && !id.includes('?vue') && !id.includes('&vue')) {
    const { descriptor, errors } = parseSfc(code, { filename: id })
    if (errors.length) throw Error(`Invalid composed SFC ${id}: ${errors[0]}`)
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (block) blocks.push({ content: block.content, offset: block.loc.start.offset, setup: block === descriptor.scriptSetup, template: descriptor.template?.content || '' })
    }
  } else blocks.push({ content: code, offset: 0, setup: false, template: '' })

  const edits = []
  const hasAlias = code.includes('~/') || code.includes('~~/')
  if (hasAlias) await init
  for (const block of hasAlias ? blocks : []) {
    const [imports] = parseImports(block.content)
    for (const item of imports) {
      if (item.d >= 0 && item.n === undefined) {
        // A computed specifier could evaluate to ~/... at runtime. Refuse it
        // instead of letting Nuxt's Host alias resolve an unknown module.
        throw Error(`Non-literal dynamic import in composed module: ${id}`)
      }
      if (item.n === undefined) continue
      const target = resolveBusinessModuleAlias(item.n, id)
      if (!target) continue
      const original = block.content.slice(item.s, item.e)
      const replacement = item.d >= 0 ? `${original[0]}${target}${original.at(-1)}` : target
      edits.push({ start: block.offset + item.s, end: block.offset + item.e, replacement })
    }
  }
  if (inject && blocks.length) {
    // Both SFC script blocks share one module scope; inject into <script setup>
    // when present (its bindings reach the template), else the only block.
    const combined = blocks.map(block => block.content).join('\n;\n')
    const target = blocks.find(block => block.setup) || blocks[0]
    const missing = missingModuleAutoImports(module, combined, target.setup ? target.template : '')
    if (missing.length) {
      // Same absolute, extension-less specifier shape as the alias rewrite above.
      const lines = missing.map(({ name, file }) => `import { ${name} } from ${JSON.stringify(file.slice(0, -extname(file).length))}`).join('\n')
      edits.push({ start: target.offset, end: target.offset, replacement: `\n${lines}\n` })
    }
  }
  if (!edits.length) return null
  let rewritten = code
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    rewritten = rewritten.slice(0, edit.start) + edit.replacement + rewritten.slice(edit.end)
  }
  return { code: rewritten, map: null }
}

/** @returns {import('vite').Plugin} */
export function businessModuleAliasPlugin() {
  const watched = [...hostAutoImportDirs, ...modules.flatMap(module => autoImportDirs.map(dir => `${module}/${dir}`))]
    .map(dir => resolve(root, dir) + sep)
  return {
    name: 'enterprise-business-module-alias',
    enforce: 'pre',
    transform: rewriteBusinessModuleImports,
    watchChange(id) {
      if (watched.some(dir => id.split('?')[0].startsWith(dir))) clearBusinessModuleAutoImportCache()
    }
  }
}
