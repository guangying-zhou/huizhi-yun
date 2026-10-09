import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { legacyAimsPages } from '../../aims/layer/legacyPages.mjs'
import { businessModules, registerBusinessPages } from '../composition/registry.mjs'

const root = resolve(import.meta.dirname, '../..')
const normalize = value => value.replace(/:[^/]+/g, ':parameter').replace(/\/$/, '')
function flatten(pages, parent = '') {
  return pages.flatMap((page) => {
    const path = `${parent}/${page.path}`.replace(/\/+/g, '/')
    return [{ ...page, path }, ...flatten(page.children || [], path)]
  })
}

test('every former Aims page URL has an exact Host registration after retirement', () => {
  const pages = flatten(registerBusinessPages([], businessModules, 'placeholder.vue'))
  const paths = new Set(pages.map(page => normalize(page.path)))
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.name.endsWith('.vue')) {
        const path = '/aims/' + relative(resolve(root, 'aims/app/pages'), file).slice(0, -4).replace(/\[([^\]]+)\]/g, ':$1').replace(/\/index$/, '')
        if (path !== '/aims/index') assert.ok(paths.has(normalize(path)), path)
      }
    }
  }
  visit(resolve(root, 'aims/app/pages'))
  assert.equal(legacyAimsPages.length, 59)
  assert.equal(new Set(legacyAimsPages.map(page => normalize(page.path))).size, 59)
  for (const legacy of legacyAimsPages) {
    assert.ok(!legacy.path.includes('*'), legacy.path)
    const page = pages.find(page => page.path === '/aims' + legacy.path)
    assert.ok(page, legacy.path)
    assert.ok(page.file.endsWith('/enterprise-legacy-page.vue'))
    assert.equal(page.meta.authorizationApp, 'aims')
    assert.ok(['redirect', 'retired'].includes(legacy.kind))
    if (legacy.kind === 'redirect') assert.ok(['/enterprise', '/enterprise/profile'].includes(legacy.target))
    else assert.equal(legacy.target, null)
  }
})

test('compatibility page only redirects exact known targets and never restores a legacy API', () => {
  const source = readFileSync(resolve(root, 'aims/layer/pages/enterprise-legacy-page.vue'), 'utf8')
  assert.match(source, /route\.name/)
  assert.match(source, /navigateTo\(target, \{ replace: true \}\)/)
  assert.match(source, /返回项目/)
  assert.match(source, /返回首页/)
  assert.doesNotMatch(source, /\$fetch|useFetch|iframe|serviceAppFetch|route\.query/)
})

test('archived compatibility pages cannot become active business navigation', () => {
  const module = businessModules.find(module => module.code === 'aims')
  const compatibility = module.pages.filter(page => page.compatibilityOnly)
  assert.equal(compatibility.length, legacyAimsPages.length)
  assert.deepEqual(compatibility.map(page => page.path).sort(), legacyAimsPages.map(page => page.path).sort())
})
