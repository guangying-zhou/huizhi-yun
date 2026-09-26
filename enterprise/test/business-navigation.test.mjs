import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBusinessNavigation, buildObjectWorkspaces, businessModules, registerBusinessPages } from '../composition/registry.mjs'
import { auxiliaryAreas, businessAreas } from '../composition/business-areas.mjs'
import { readFileSync } from 'node:fs'
import { selectActiveLeaf } from '../app/utils/navigation-active.mjs'
import { matchRegisteredPage } from '../shared/registered-page.mjs'

const nav = buildBusinessNavigation(businessModules, businessAreas, auxiliaryAreas)
const areas = [...nav.primary, ...nav.auxiliary]
const registered = new Set(registerBusinessPages([], businessModules, '/placeholder.vue').flatMap(function paths(page, _i, _a, parent = '') {
  const full = page.path.startsWith('/') ? page.path : `${parent}/${page.path}`.replace(/\/$/, '')
  return [full, ...(page.children || []).flatMap(child => paths(child, 0, [], full))]
}))
const leaves = areas.flatMap(area => area.children.flatMap(group => group.children))

test('the Host navigation section resolves its tree component statically', () => {
  const source = readFileSync(new URL('../app/components/HostNavSections.vue', import.meta.url), 'utf8')
  assert.match(source, /import HostNavTree from ['"]\.\/HostNavTree\.vue['"]/)
})

test('the menu is organised by business area, never by owning application', () => {
  assert.ok(areas.length > 0)
  const shapes = [...businessAreas, ...auxiliaryAreas]
  for (const area of areas) {
    assert.ok(shapes.some(shape => shape.code === area.code && shape.label === area.label), `${area.code} is not a declared area`)
    assert.ok(area.icon?.startsWith('i-lucide-'), `${area.code} has no icon`)
  }
  for (const label of businessModules.map(module => module.label)) {
    assert.ok(!areas.some(area => area.label === label), `${label} must not be a top-level entry`)
  }
})

test('every menu node has stable metadata and canonical targets may have multiple entries', () => {
  const seen = new Set()
  for (const leaf of leaves) {
    assert.ok(registered.has(leaf.to), `${leaf.to} is not a registered page`)
    assert.ok(leaf.id && leaf.module, `${leaf.to} is missing stable identity`)
    assert.deepEqual(Object.keys(leaf.permission).sort(), ['action', 'resource'])
    assert.ok(!seen.has(leaf.id), `duplicate menu node id ${leaf.id}`)
    seen.add(leaf.id)
  }
  assert.ok(leaves.length > 0)
})

test('an area or group nobody contributed to is dropped, not shown empty', () => {
  for (const area of areas) {
    assert.ok(area.children.length > 0, `${area.code} renders with no group`)
    for (const group of area.children) assert.ok(group.children.length > 0, `${area.code}/${group.code} renders empty`)
  }
  // Sales has no contributing module yet, so it must not reach the menu.
  assert.ok(businessAreas.some(area => area.code === 'sales'))
  assert.ok(!areas.some(area => area.code === 'sales'))
})

test('composition refuses targets outside the module, off the route table or in an unknown group', () => {
  const [aims] = businessModules
  const cases = [
    { id: 'fixture.1', area: 'delivery', group: 'project', label: 'x', to: '/assets/products', permission: { resource: 'projects', action: 'view' } },
    { id: 'fixture.2', area: 'delivery', group: 'project', label: 'x', to: '/aims/quality-reviews', permission: { resource: 'projects', action: 'view' } },
    { id: 'fixture.3', area: 'delivery', group: 'not-a-group', label: 'x', to: '/aims/projects', permission: { resource: 'projects', action: 'view' } },
    { id: 'fixture.4', area: 'not-an-area', group: 'project', label: 'x', to: '/aims/projects', permission: { resource: 'projects', action: 'view' } }
  ]
  for (const navigation of cases) {
    assert.throws(
      () => buildBusinessNavigation([{ ...aims, navigation: [navigation] }], businessAreas, auxiliaryAreas),
      /Business menu target/,
      `${navigation.to} in ${navigation.area}/${navigation.group} must be refused`
    )
  }
})

test('same canonical route is allowed when discovery ids differ, duplicate ids are rejected', () => {
  const [aims] = businessModules
  const base = aims.navigation[0]
  const duplicateRoute = { ...base, id: 'fixture.second-entry', label: '另一个发现入口' }
  const result = buildBusinessNavigation([{ ...aims, navigation: [base, duplicateRoute] }], businessAreas, auxiliaryAreas)
  const matching = result.primary.flatMap(area => area.children.flatMap(group => group.children)).filter(item => item.to === base.to)
  assert.equal(matching.length, 2)
  assert.throws(() => buildBusinessNavigation([{ ...aims, navigation: [base, { ...duplicateRoute, id: base.id }] }], businessAreas, auxiliaryAreas), /Duplicate business menu node id/)
})

test('menu labels follow the specification rather than the source application', () => {
  // Regression for menus that read as an application index: the same page is
  // discovered under the name the navigation specification gives it.
  const byTarget = new Map(leaves.map(leaf => [leaf.to, leaf.label]))
  for (const [to, label] of [
    ['/aims/projects', '项目总览'],
    ['/aims/work-items', '任务中心'],
    ['/aims/timesheet', '工时日历'],
    ['/aims/products', '产品管理空间'],
    ['/assets/products', '全部产品'],
    ['/assets/physical', '自用资产']
  ]) {
    assert.equal(byTarget.get(to), label, `${to} must be discovered as ${label}`)
  }
})

const objectWorkspaces = buildObjectWorkspaces(businessModules)

test('object workspaces resolve to registered pages of their own module', () => {
  assert.ok(objectWorkspaces.length > 0)
  const patterns = new Set(registerBusinessPages([], businessModules, '/placeholder.vue').flatMap(function paths(page, _i, _a, parent = '') {
    const full = page.path.startsWith('/') ? page.path : `${parent}/${page.path}`.replace(/\/$/, '')
    return [full, ...(page.children || []).flatMap(child => paths(child, 0, [], full))]
  }))
  for (const workspace of objectWorkspaces) {
    assert.ok(patterns.has(workspace.backTo), `${workspace.backTo} is not a registered page`)
    assert.ok(workspace.groups.length > 0)
    for (const group of workspace.groups) {
      assert.ok(group.items.length > 0, `${workspace.code}/${group.label} is empty`)
      for (const item of group.items) {
        assert.ok(patterns.has(`${workspace.base}${item.path}`), `${workspace.base}${item.path} is not registered`)
      }
    }
  }
})

test('client-safe navigation artifact is reproducibly generated from the registry', () => {
  const source = readFileSync(new URL('../app/utils/enterprise-navigation.ts', import.meta.url), 'utf8')
  const match = source.match(/export const enterpriseNavigation = (\{[\s\S]*\}) as const\s*$/)
  assert.ok(match, 'generated navigation artifact must contain a JSON-compatible value')
  const artifact = JSON.parse(match[1])
  assert.deepEqual(artifact.businessNavigation, nav)
  assert.deepEqual(artifact.objectWorkspaces, objectWorkspaces)
  assert.ok(artifact.registeredPages.length > 0)
  assert.ok(artifact.registeredPages.every(page => page.path && page.name))
  const flatten = (page, parent = '') => {
    const path = page.path.startsWith('/') ? page.path : `${parent}/${page.path}`.replace(/\/$/, '')
    return [{ path, name: page.name }, ...(page.children || []).flatMap(child => flatten(child, path))]
  }
  assert.deepEqual(artifact.registeredPages, registerBusinessPages([], businessModules, '/placeholder.vue').flatMap(page => flatten(page)))
})

test('active navigation selects one longest canonical match and prefers the selected discovery id', () => {
  const tree = [
    { id: 'area-a', children: [{ id: 'a-root', to: '/mydocs' }, { id: 'a-cabinet', to: '/mydocs/cabinet' }] },
    { id: 'area-b', children: [{ id: 'b-root', to: '/mydocs' }] }
  ]
  assert.equal(selectActiveLeaf(tree, '/mydocs/cabinet'), 'a-cabinet')
  assert.equal(selectActiveLeaf(tree, '/mydocs', 'b-root'), 'b-root')
  assert.equal(selectActiveLeaf(tree, '/mydocs', 'missing'), 'a-root')
  assert.equal(selectActiveLeaf(tree, '/other'), '')
})

test('registered return paths preserve query/hash while rejecting unsafe or unregistered paths', () => {
  const pages = [{ path: '/aims/projects', name: 'projects' }, { path: '/aims/projects/:id', name: 'project' }]
  assert.equal(matchRegisteredPage('/aims/projects?page=2#members', pages).name, 'projects')
  assert.equal(matchRegisteredPage('/aims/projects/中文', pages).name, 'project')
  for (const unsafe of ['/api/v1/projects', '/auth/callback', '/aims/projects/%2Fsecret', '/aims/projects/../auth', '/aims/projects\\x', '/aims/missing']) {
    assert.equal(matchRegisteredPage(unsafe, pages), null, unsafe)
  }
})

test('an object menu target that is not a registered page is refused at build time', () => {
  const [aims] = businessModules
  for (const bad of [
    { ...aims.objectWorkspaces[0], groups: [{ label: 'x', items: [{ label: 'x', path: '/metrics' }] }] },
    { ...aims.objectWorkspaces[0], base: '/assets/products/:id' }
  ]) {
    assert.throws(() => buildObjectWorkspaces([{ ...aims, objectWorkspaces: [bad] }]), /Object (menu target|workspace)/)
  }
})

test('global leaves and object actions cannot collide in the runtime visibility set', () => {
  const [aims] = businessModules
  const workspace = { ...aims.objectWorkspaces[0], actions: [{ id: aims.navigation[0].id, permission: { resource: 'work_items', action: 'create' } }] }
  assert.throws(() => buildObjectWorkspaces([{ ...aims, objectWorkspaces: [workspace] }]), /Duplicate or missing object action/)
})

test('a discovery alias cannot weaken canonical destination permissions', () => {
  const [aims] = businessModules
  const first = aims.navigation[0]
  const alias = { ...first, id: 'alias.products', permission: { resource: 'work_items', action: 'view' } }
  assert.throws(() => buildBusinessNavigation([{ ...aims, navigation: [first, alias] }], businessAreas, auxiliaryAreas), /share destination permissions/)
})
