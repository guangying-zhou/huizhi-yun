import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, parse, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const modules = ['enterprise', 'aims', 'assets', 'codocs', 'altoc', 'finance', 'people']
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : ['.vue', '.ts', '.js', '.mjs'].includes(extname(path)) ? [path] : []
  })
}
// existsSync alone would accept incorrectly cased paths on a default macOS volume.
function exactFile(path) {
  let directory = parse(path).root
  for (const segment of path.slice(directory.length).split(sep)) {
    if (!readdirSync(directory).includes(segment)) return false
    directory = join(directory, segment)
  }
  return true
}

test('all Host and composed presentation imports avoid the undeclared ~host alias', () => {
  const violations = []
  for (const module of modules) {
    for (const directory of module === 'enterprise' ? ['app'] : ['app', 'layer']) {
      for (const file of sources(resolve(root, module, directory))) {
        for (const match of readFileSync(file, 'utf8').matchAll(/['"](~host\/[^'"]+)['"]/g)) {
          violations.push(`${relative(root, file)}: ${match[1]}`)
        }
      }
    }
  }
  assert.deepEqual(violations, [], 'production has no ~host alias; use an explicit relative Host import')
})

test('People directory recovery resolves the actual Host component with Linux-exact casing', () => {
  const page = resolve(root, 'people/layer/pages/directory-recovery.vue')
  const source = readFileSync(page, 'utf8')
  const specifier = source.match(/import PeopleDirectoryRecoveryPage from '([^']+)'/)?.[1]
  assert.ok(specifier?.startsWith('.'))
  const component = resolve(dirname(page), specifier)
  assert.equal(component, resolve(root, 'enterprise/app/components/PeopleDirectoryRecoveryPage.vue'))
  assert.ok(exactFile(component))
  assert.equal(exactFile(component.replace('PeopleDirectoryRecoveryPage.vue', 'peopleDirectoryRecoveryPage.vue')), false)
})

test('every relative Host component reference stays in this repository and matches exact casing', () => {
  let checked = 0
  for (const module of modules) {
    for (const directory of module === 'enterprise' ? ['app'] : ['app', 'layer']) {
      for (const file of sources(resolve(root, module, directory))) {
        for (const match of readFileSync(file, 'utf8').matchAll(/['"]((?:\.\.\/)+enterprise\/app\/components\/[^'"]+)['"]/g)) {
          const target = resolve(dirname(file), match[1])
          assert.ok(target.startsWith(resolve(root, 'enterprise/app/components') + sep), `${relative(root, file)} escapes the Host component directory`)
          assert.ok(exactFile(target), `${relative(root, file)} has an unresolved or incorrectly cased Host component: ${match[1]}`)
          checked++
        }
      }
    }
  }
  assert.ok(checked >= 12, 'all People Host wrappers are included')
})
