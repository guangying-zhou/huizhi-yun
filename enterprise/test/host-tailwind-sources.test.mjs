import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { businessModules, hostNativePages } from '../composition/registry.mjs'

// Tailwind only emits classes found in scanned files. Nuxt UI adds the Nuxt layers
// (enterprise, foundation) automatically; business modules are composed through
// their entry registries and must be declared with @source in main.css. A missing
// source silently drops classes used only by those pages (responsive widths, grid
// columns), which is how department documents and project weekly reports lost
// their layout.
const enterpriseDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = resolve(enterpriseDir, '..')
const cssFile = resolve(enterpriseDir, 'app/assets/css/main.css')
const layerRoots = [resolve(repoRoot, 'enterprise/app'), resolve(repoRoot, 'foundation/app')]
const declaredSources = [...readFileSync(cssFile, 'utf8').matchAll(/@source\s+"([^"]+)"/g)]
  .map(match => resolve(dirname(cssFile), match[1]))
const scannedRoots = [...layerRoots, ...declaredSources]

const isScanned = file => scannedRoots.some(root => file === root || file.startsWith(root + sep))
const rel = file => relative(repoRoot, file)

function registeredPageFiles() {
  const files = new Set()
  const collect = (value) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach(collect)
    if (typeof value.file === 'string') files.add(value.file)
    Object.values(value).forEach(collect)
  }
  businessModules.forEach(collect)
  hostNativePages.forEach(collect)
  return [...files]
}

function componentDirs() {
  const config = readFileSync(resolve(enterpriseDir, 'nuxt.config.ts'), 'utf8')
  return [...config.matchAll(/path:\s*fileURLToPath\(new URL\('([^']+)',\s*import\.meta\.url\)\)/g)]
    .map(match => resolve(enterpriseDir, match[1]))
}

test('every declared @source exists', () => {
  assert.ok(declaredSources.length > 0)
  for (const source of declaredSources) assert.ok(existsSync(source), `@source does not exist: ${rel(source)}`)
})

test('every registered business page file is a Tailwind source', () => {
  const files = registeredPageFiles()
  assert.ok(files.length > 50, `expected the business page registry, got ${files.length} files`)
  const missing = files.filter(file => !isScanned(file)).map(rel)
  assert.deepEqual(missing, [], `pages outside every @source: ${missing.join(', ')}`)
})

test('every components.dirs entry is a Tailwind source', () => {
  const dirs = componentDirs()
  assert.ok(dirs.length > 0)
  const missing = dirs.filter(dir => !isScanned(dir)).map(rel)
  assert.deepEqual(missing, [], `component dirs outside every @source: ${missing.join(', ')}`)
})

test('pages that lost their layout before the whole-module sources are covered', () => {
  for (const file of [
    'codocs/layer/pages/enterprise-department-documents.vue',
    'aims/app/pages/projects/[id]/weekly-reports.vue',
    'aims/app/pages/weekly-reports.vue',
    'aims/app/pages/projects/[id]/board.vue',
    'aims/app/components/project/ProjectNavbar.vue'
  ]) assert.ok(isScanned(resolve(repoRoot, file)), `${file} must be a Tailwind source`)
})
