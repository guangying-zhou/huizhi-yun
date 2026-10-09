import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBusinessNavigation, buildObjectWorkspaces, businessModules, registerBusinessPages } from '../composition/registry.mjs'
import { auxiliaryAreas, businessAreas } from '../composition/business-areas.mjs'

const nav = buildBusinessNavigation(businessModules, businessAreas, auxiliaryAreas)
const areas = [...nav.primary, ...nav.auxiliary]
const registered = new Set(registerBusinessPages([], businessModules, '/placeholder.vue').flatMap(function paths(page, _i, _a, parent = '') {
  const full = page.path.startsWith('/') ? page.path : `${parent}/${page.path}`.replace(/\/$/, '')
  return [full, ...(page.children || []).flatMap(child => paths(child, 0, [], full))]
}))
const leaves = areas.flatMap(area => area.children.flatMap(group => group.children))

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

test('every menu target is a registered Host page and appears once', () => {
  const seen = new Set()
  for (const leaf of leaves) {
    assert.ok(registered.has(leaf.to), `${leaf.to} is not a registered page`)
    assert.ok(!seen.has(leaf.to), `duplicate menu target ${leaf.to}`)
    seen.add(leaf.to)
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
    { area: 'delivery', group: 'project', label: 'x', to: '/assets/products' },
    { area: 'delivery', group: 'project', label: 'x', to: '/aims/quality-reviews' },
    { area: 'delivery', group: 'not-a-group', label: 'x', to: '/aims/projects' },
    { area: 'not-an-area', group: 'project', label: 'x', to: '/aims/projects' }
  ]
  for (const navigation of cases) {
    assert.throws(
      () => buildBusinessNavigation([{ ...aims, navigation: [navigation] }], businessAreas, auxiliaryAreas),
      /Business menu target/,
      `${navigation.to} in ${navigation.area}/${navigation.group} must be refused`
    )
  }
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

test('an object menu target that is not a registered page is refused at build time', () => {
  const [aims] = businessModules
  for (const bad of [
    { ...aims.objectWorkspaces[0], groups: [{ label: 'x', items: [{ label: 'x', path: '/metrics' }] }] },
    { ...aims.objectWorkspaces[0], base: '/assets/products/:id' }
  ]) {
    assert.throws(() => buildObjectWorkspaces([{ ...aims, objectWorkspaces: [bad] }]), /Object (menu target|workspace)/)
  }
})
