#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { init, parse as parseImports } from 'es-module-lexer'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const owners = ['aims', 'assets', 'codocs', 'altoc']
const extensions = ['.ts', '.js', '.mjs', '.vue', '.css', '.scss', '.sass', '.less']
const sourceExtensions = ['', '.ts', '.js', '.mjs', '/index.ts', '/index.js', '/index.mjs']

function files(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return []
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : extensions.includes(extname(path)) ? [path] : []
  })
}

export function presentationFiles(owner) {
  return [...files(resolve(root, owner, 'app')), ...files(resolve(root, owner, 'layer'))]
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function styleReferences(source, offset = 0) {
  const failures = []
  // CSS has no JS import semantics. Keep this check limited to @import and url().
  for (const pattern of [/@import\s+(?:url\(\s*)?['"]?\s*~{1,2}\//g, /url\(\s*['"]?\s*~{1,2}\//g]) {
    for (const match of source.matchAll(pattern)) failures.push(offset + match.index)
  }
  return [...new Set(failures)]
}

export function checkVuePresentationAliases(source, filename) {
  const { descriptor, errors } = parseSfc(source, { filename })
  if (errors.length) throw Error(`Invalid SFC ${filename}: ${errors[0]}`)
  const violations = []
  function walk(node) {
    if (node.type === 1) {
      for (const prop of node.props || []) {
        const name = prop.type === 6 ? prop.name : prop.arg?.content
        const value = prop.type === 6 ? prop.value?.content : prop.exp?.content
        if (['src', 'href', 'poster'].includes(name) && typeof value === 'string' && /^['"`]?~{1,2}\//.test(value.trim())) {
          violations.push({ line: prop.loc.start.line, kind: `template ${name}` })
        }
      }
    }
    for (const child of node.children || []) walk(child)
    for (const branch of node.branches || []) walk(branch)
  }
  if (descriptor.template?.ast) walk(descriptor.template.ast)
  for (const style of descriptor.styles) {
    for (const index of styleReferences(style.content)) {
      violations.push({ line: lineAt(source, style.loc.start.offset + index), kind: 'style @import/url' })
    }
  }
  return violations
}

function resolveSource(from, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(from), specifier)
  for (const suffix of sourceExtensions) {
    const candidate = base + suffix
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

async function imports(file) {
  const [records] = parseImports(readFileSync(file, 'utf8'))
  return records.map(record => record.n).filter(Boolean)
}

function ownerServer(file) {
  return owners.some(owner => file.startsWith(resolve(root, owner, 'server') + sep))
}

export function serverAliasTokens(source) {
  const positions = []
  for (let index = 0; index < source.length; index++) {
    if (source.startsWith('~/', index) || source.startsWith('~~/', index)) {
      positions.push(index)
      index += source.startsWith('~~/', index) ? 2 : 1
    }
  }
  return positions
}

export async function checkBusinessModuleAliases() {
  await init
  const violations = []
  for (const owner of owners) {
    for (const file of presentationFiles(owner)) {
      const source = readFileSync(file, 'utf8')
      const found = extname(file) === '.vue'
        ? checkVuePresentationAliases(source, file)
        : ['.css', '.scss', '.sass', '.less'].includes(extname(file))
            ? styleReferences(source).map(index => ({ line: lineAt(source, index), kind: 'style @import/url' }))
            : []
      for (const item of found) violations.push(`${relative(root, file)}:${item.line}: ${item.kind} cannot use ~/ or ~~/ in Host composition`)
    }
  }

  const direct = new Set()
  for (const file of files(resolve(root, 'enterprise/server'))) {
    if (!['.ts', '.js', '.mjs'].includes(extname(file))) continue
    for (const specifier of await imports(file)) {
      const target = resolveSource(file, specifier)
      if (target && ownerServer(target)) direct.add(target)
    }
  }
  const checked = new Set(direct)
  for (const file of direct) {
    for (const specifier of await imports(file)) {
      const target = resolveSource(file, specifier)
      if (target && ownerServer(target)) checked.add(target)
    }
  }
  for (const file of checked) {
    const source = readFileSync(file, 'utf8')
    for (const index of serverAliasTokens(source)) {
      violations.push(`${relative(root, file)}:${lineAt(source, index)}: Nitro-imported module server file cannot use ~/ or ~~/`)
    }
  }
  return { violations, directCount: direct.size, checkedCount: checked.size }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkBusinessModuleAliases()
  if (result.violations.length) {
    for (const violation of result.violations) console.error(violation)
    process.exitCode = 1
  } else console.log(`Business module alias check passed (${result.directCount} Host server imports, ${result.checkedCount} server files including direct dependencies).`)
}
