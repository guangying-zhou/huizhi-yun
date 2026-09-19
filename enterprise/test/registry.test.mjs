import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { businessModules, registerBusinessPages } from '../composition/registry.mjs'

test('same local product path belongs to distinct prefixed routes', () => {
  const modules = businessModules.map(module => ({ ...module, pages: [{ path: '/products', name: 'products', file: 'products.vue' }] }))
  const pages = registerBusinessPages([], modules, 'entry.vue')
  assert.deepEqual(pages.map(page => page.path), ['/aims', '/aims/products', '/assets', '/assets/products'])
  assert.equal(new Set(pages.map(page => page.name)).size, pages.length)
})
test('host and module collisions fail rather than override', () => {
  assert.throws(() => registerBusinessPages([{ path: '/aims', name: 'existing' }], businessModules, 'entry.vue'), /Duplicate/)
  assert.throws(() => registerBusinessPages([], [...businessModules, businessModules[0]], 'entry.vue'), /Duplicate/)
})
test('invalid or escaping prefixes fail', () => {
  assert.throws(() => registerBusinessPages([], [{ code: 'aims', prefix: '/assets', pages: [] }], 'entry.vue'), /Invalid/)
  assert.throws(() => registerBusinessPages([], [{ code: 'aims', prefix: '/aims', pages: [{ path: '/../assets', name: 'escape' }] }], 'entry.vue'), /Invalid/)
})

test('product workspace and version plans preserve nested shells and metadata', () => {
  const pages = registerBusinessPages([], businessModules, 'entry.vue')
  const products = pages.find(page => page.name === 'aims-products-shell')
  const workspace = products.children.find(page => page.path === ':productCode')
  assert.ok(workspace.file.endsWith('/products/[productCode].vue'))
  assert.deepEqual(workspace.children.map(page => page.path), ['', 'structure', 'features/:featureId', 'features/:featureId/requests', 'features/:featureId/lifecycle', 'features/:featureId/roadmap', 'requests', 'planning-items/:itemId/handoff', 'execution-coordination', 'planning', 'versions', 'versions/:versionId'])
  const version = workspace.children.find(page => page.path === 'versions/:versionId')
  assert.deepEqual(version.children.map(page => page.path), ['', 'acceptance', 'acceptances', 'acceptances/:acceptanceId', 'releases', 'releases/:recordId', 'plan'])
  assert.equal(version.children.find(page => page.path === 'plan').meta.logicalModule, 'aims')
  assert.ok(version.children.find(page => page.path === 'plan').file.endsWith('/versions/[versionId]/plan.vue'))
})

test('nested routes reject absolute escapes and duplicate siblings', () => {
  const module = { code: 'aims', prefix: '/aims', pages: [{ path: '/products', name: 'products', children: [{ path: '/assets', name: 'escape' }] }] }
  assert.throws(() => registerBusinessPages([], [module], 'entry.vue'), /Invalid/)
  module.pages[0].children = [{ path: 'requests', name: 'one' }, { path: 'requests', name: 'two' }]
  assert.throws(() => registerBusinessPages([], [module], 'entry.vue'), /Duplicate/)
})

test('Assets product maintenance and product category routes keep their namespace', () => {
  const pages = registerBusinessPages([], businessModules, 'entry.vue')
  const assets = pages.filter(page => page.path.startsWith('/assets/'))
  for (const suffix of ['/products', '/products/:id', '/admin/asset-categories']) {
    const page = assets.find(page => page.path === `/assets${suffix}`)
    assert.ok(page, `missing Assets ${suffix}`)
    assert.equal(page.meta.logicalModule, 'assets')
  }
})

test('Assets Layer registers only Host-ready pages and supplies its module landing path', () => {
  const pages = registerBusinessPages([], businessModules, 'entry.vue')
  const assetsModule = businessModules.find(module => module.code === 'assets')
  const assets = pages.filter(page => page.path.startsWith('/assets'))
  assert.equal(assets.find(page => page.path === '/assets')?.meta.moduleEntryPath, '/products')
  assert.deepEqual(assets.filter(page => page.path !== '/assets').map(page => page.path).sort(), [
    '/assets/admin/asset-categories', '/assets/admin/dictionaries', '/assets/digital-assets', '/assets/digital-assets/:id', '/assets/ip-assets', '/assets/ip-assets/:id',
    '/assets/items/:id', '/assets/physical', '/assets/products', '/assets/products/:id', '/assets/resources'
  ])
  for (const deferred of assetsModule.hostReadiness.deferredPages) {
    const route = deferred.split(' ', 1)[0]
    assert.equal(assets.some(page => page.path === `/assets${route}`), false, `deferred page must not be registered: ${route}`)
  }
})

test('Aims Layer registers Host-ready project reads and leaves unsupported member detail deferred', () => {
  const pages = registerBusinessPages([], businessModules, 'entry.vue')
  const aimsModule = businessModules.find(module => module.code === 'aims')
  const aims = pages.filter(page => page.path.startsWith('/aims'))
  assert.equal(aims.find(page => page.path === '/aims')?.meta.moduleEntryPath, '/projects')
  for (const route of ['/aims/projects', '/aims/projects/:id', '/aims/projects/:id/members', '/aims/projects/:id/timesheet', '/aims/projects/:id/timesheet/:entryId', '/aims/projects/:id/weekly-reports', '/aims/projects/:id/weekly-reports/:periodKey', '/aims/work-items', '/aims/work-items/:id']) {
    assert.ok(aims.some(page => page.path === route), `missing ready project route: ${route}`)
  }
  for (const deferred of aimsModule.hostReadiness.deferredPages) {
    const route = deferred.split(' ', 1)[0]
    assert.equal(aims.some(page => page.path === `/aims${route}`), false, `deferred page must not be registered: ${route}`)
  }
})

// Session scoping is an invariant of every registered surface: a cached key that
// is not derived from the verified tenant/subject/policy can be served across a
// tenant or subject switch. The file list comes from the registry itself, so a
// page mounted from a standalone application is covered as soon as it is listed.
test('every registered Host page derives its cached keys from the session scope', () => {
  const pages = registerBusinessPages([], businessModules, 'entry.vue')
  const files = new Set()
  const collect = (list) => {
    for (const page of list) {
      if (page.file && page.file.endsWith('.vue')) files.add(page.file)
      if (page.children) collect(page.children)
    }
  }
  collect(pages)
  const offenders = []
  for (const file of files) {
    if (file.endsWith('entry.vue') || !existsSync(file)) continue
    const source = readFileSync(file, 'utf8')
    for (const call of source.matchAll(/use(?:State|AsyncData)\s*\(/g)) {
      // The key may be a literal or a function, so read the first argument by
      // balancing parentheses instead of stopping at the first bracket.
      let depth = 1
      let index = call.index + call[0].length
      let first = ''
      while (index < source.length && depth > 0) {
        const char = source[index]
        if (char === '(') depth++
        else if (char === ')') depth--
        if (depth === 1 && char === ',') break
        if (depth > 0) first += char
        index++
      }
      if (!first.includes('cacheKey(')) offenders.push(`${file.split('/huizhiyun/')[1]}: ${first.replace(/\s+/g, ' ').slice(0, 70)}`)
    }
  }
  assert.deepEqual(offenders, [], `${offenders.length} registered pages cache without the session scope`)
})

// INT-302 composition conflicts. Each clause is the executable form of a rule
// that was previously only reviewed by hand.
test('composed modules do not collide on dependencies, auto-imports, layouts or background work', () => {
  const root = new URL('../../', import.meta.url).pathname
  const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))
  const host = json('enterprise/package.json').dependencies || {}
  for (const module of ['aims', 'assets']) {
    const deps = json(`${module}/package.json`).dependencies || {}
    const conflicts = Object.keys(deps).filter(name => host[name] && host[name] !== deps[name])
    assert.deepEqual(conflicts, [], `${module} shares a dependency with the Host at a different version`)
  }
  // Auto-imported composables are flat per module; two modules must not expose
  // the same file name into one Host.
  const names = (module) => new Set(readdirSync(join(root, `${module}/app/composables`)).filter(name => /\.ts$/.test(name)))
  const aims = names('aims')
  const collisions = [...names('assets')].filter(name => aims.has(name))
  assert.deepEqual(collisions, [], 'two modules auto-import the same composable file name')

  // Registered pages must not bring their own layout or middleware: the Host owns
  // the single app shell, and a module-declared one would not resolve there.
  const pages = registerBusinessPages([], businessModules, 'entry.vue')
  const files = []
  const collect = (list) => {
    for (const page of list) {
      if (page.file && page.file.endsWith('.vue')) files.push(page.file)
      if (page.children) collect(page.children)
    }
  }
  collect(pages)
  const shellClaims = []
  for (const file of files) {
    if (file.endsWith('entry.vue') || !existsSync(file)) continue
    const source = readFileSync(file, 'utf8')
    // An inline middleware function travels with the page and needs nothing from
    // the Host; a named layout or middleware would have to resolve there.
    if (/definePageMeta\([^)]*\blayout\s*:/s.test(source)) shellClaims.push(`${file.split('/huizhiyun/')[1]} (layout)`)
    if (/definePageMeta\([^)]*\bmiddleware\s*:\s*(['"[])/s.test(source)) shellClaims.push(`${file.split('/huizhiyun/')[1]} (named middleware)`)
  }
  assert.deepEqual(shellClaims, [], 'a registered page declares its own layout or middleware')

  // The Host composes pages, not module nuxt configs, so module public/ dirs and
  // global CSS are never served. Module code must not depend on either.
  const hostCss = readFileSync(join(root, 'enterprise/nuxt.config.ts'), 'utf8').match(/css:\s*\[([^\]]*)\]/)
  assert.deepEqual(hostCss && hostCss[1].split(',').map(entry => entry.trim()).filter(Boolean), ["'~/assets/css/main.css'"])
  const shellAssets = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(vue|ts)$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8')
        if (/(src|href)="\/[\w.-]+\.(png|svg|ico|jpe?g|webp|css|html|md)"/.test(source) || /import\s[^\n]*\.css['"]/.test(source)) shellAssets.push(path.split('/huizhiyun/')[1])
      }
    }
  }
  for (const module of ['aims', 'assets']) walk(join(root, `${module}/app`))
  assert.deepEqual(shellAssets, [], 'module code depends on a public/ asset or global CSS the Host does not serve')

  // Background work stays unowned until INT-305 assigns a single owner, so the
  // reserved fields must stay empty and the Host must not register them.
  for (const module of businessModules) {
    assert.deepEqual(module.handlers, [], `${module.code} declares server handlers the Host does not compose`)
    assert.deepEqual(module.tasks, [], `${module.code} declares background tasks; INT-305 owns that decision`)
  }
  assert.doesNotMatch(readFileSync(join(root, 'enterprise/nuxt.config.ts'), 'utf8'), /scheduledTasks|module\.tasks/)
})
