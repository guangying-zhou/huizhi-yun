import test from 'node:test'
import assert from 'node:assert/strict'
import { filterObjectGroups, isUsableProject, numericProjectId, projectReturnTarget, safeProjectReturn, projectWorkspaceWithWriteAccess, projectTabAllows, projectTabForPath } from '../app/utils/object-navigation.mjs'

const workspace = { base: '/aims/projects/:id', groups: [{ id: 'overview', label: '概览', items: [{ id: 'overview', label: '概览', path: '' }, { id: 'board', label: '看板', path: '/board' }] }] }
const matched = [{ name: 'aims-project-detail', path: '/aims/projects/:id' }]

test('object route requires a registered match and numeric project id', () => {
  assert.equal(numericProjectId({ name: 'aims-project-new', path: '/aims/projects/new', params: { id: 'new' }, matched }, workspace), '')
  assert.equal(numericProjectId({ name: 'aims-project-detail', path: '/aims/projects/abc', params: { id: 'abc' }, matched }, workspace), '')
  assert.equal(numericProjectId({ name: 'aims-project-board', path: '/aims/projects/42/board', params: { id: '42' }, matched }, workspace), '42')
})

test('object groups are filtered by caller-provided visible ids', () => {
  assert.deepEqual(filterObjectGroups(workspace, new Set(['board']), { projectTabAccess: { member: true } }), [{ id: 'overview', label: '概览', items: [{ id: 'board', label: '看板', path: '/board' }] }])
})

test('object action permissions hide edit-only items for ordinary members', () => {
  const secured = { ...workspace, groups: [{ label: '管理', items: [{ id: 'edit', label: '编辑', path: '/edit', permission: { action: 'edit' } }, { id: 'view', label: '查看', path: '', permission: { action: 'view' } }] }] }
  assert.deepEqual(filterObjectGroups(secured, null, { currentUserRole: 'member' }), [{ label: '管理', items: [{ id: 'view', label: '查看', path: '', permission: { action: 'view' } }] }])
  assert.equal(filterObjectGroups(secured, null, { currentUserRole: 'manager', canEditProject: true })[0].items.length, 2)
})

test('deleted or denied detail responses cannot become object context', () => {
  assert.equal(isUsableProject({ id: 42, name: '已删除', canAccess: false }), false)
  assert.equal(isUsableProject({ id: 42, name: '' }), false)
  assert.equal(isUsableProject({ id: 42, name: '可见', canAccess: true }), true)
})

test('return targets only accept formal list/product pages and preserve query/hash', () => {
  assert.equal(safeProjectReturn('/aims/projects?page=3&filter=x#row'), '/aims/projects?page=3&filter=x#row')
  assert.equal(safeProjectReturn('/assets/products?keyword=x#p'), '/assets/products?keyword=x#p')
  assert.equal(safeProjectReturn('/assets/products?keyword=%E4%B8%AD%E6%96%87#p'), '/assets/products?keyword=%E4%B8%AD%E6%96%87#p')
  assert.equal(safeProjectReturn('/api/v1/projects?tenant=other'), '')
  assert.equal(safeProjectReturn('/aims/projects/%2f%2fevil'), '')
  assert.equal(projectReturnTarget({ from: '/api/v1/projects', returnTo: '/aims/projects?page=2' }), '/aims/projects?page=2')
  assert.equal(projectReturnTarget({ from: '/aims/projects/42' }), '/aims/projects')
})

test('PA03 exact project edit discovery uses current server verdict and clears on revocation', () => {
  const complete = { groups: [{ id: 'manage', items: [{ id: 'aims.project.edit', path: '/edit', permission: { resource: 'projects', action: 'edit' } }, { id: 'unrelated', path: '/secret' }] }] }
  const filtered = { groups: [{ id: 'overview', items: [{ id: 'overview', path: '' }] }] }
  for (const role of ['manager', null]) {
    const groups = filterObjectGroups(projectWorkspaceWithWriteAccess(filtered, complete, { canEditProject: true, currentUserRole: role }), null, { canEditProject: true, currentUserRole: role })
    assert.equal(groups.flatMap(g => g.items).filter(i => i.id === 'aims.project.edit').length, 1)
    assert.equal(groups.flatMap(g => g.items).some(i => i.id === 'unrelated'), false)
  }
  const groups = filterObjectGroups(projectWorkspaceWithWriteAccess(filtered, complete, { canEditProject: false }), null, { canEditProject: false })
  assert.equal(groups.flatMap(g => g.items).some(i => i.id === 'aims.project.edit'), false)
})

test('project tabs use only current Runtime facts and scope view never grants management', () => {
  const tabs = ['board', 'goals', 'requirements', 'risks', 'metrics', 'timesheet']
  for (const tab of tabs) {
    assert.equal(projectTabAllows({ currentUserRole: 'member' }, tab), false)
    assert.equal(projectTabAllows({ projectTabAccess: { member: true } }, tab), true)
    assert.equal(projectTabAllows({ projectTabAccess: { management: true } }, tab), true)
    assert.equal(projectTabAllows({ projectTabAccess: { anyProjectManager: true } }, tab), false)
  }
  assert.equal(projectTabAllows({ projectTabAccess: { anyProjectManager: true } }, 'weekly-reports'), true)
  assert.equal(projectTabAllows({ projectTabAccess: {} }, 'weekly-reports'), false)
  assert.equal(projectTabForPath('/work-items/12/append'), 'goals')
  const globallyVisible = { groups: [{ id: 'manage', items: [{ id: 'aims.project.edit', path: '/edit' }] }] }
  assert.equal(projectWorkspaceWithWriteAccess(globallyVisible, globallyVisible, { canEditProject: false }).groups[0].items.length, 0)
})

test('restricted page mounting fails closed before discovery and for stale project identity', async () => {
  const { projectPageCanMount } = await import('../app/utils/object-navigation.mjs')
  const project = { id: 263, name: '项目', canAccess: true, projectTabAccess: { member: false, management: false } }
  for (const tab of ['board', 'work-items', 'requirements', 'risks', 'metrics', 'timesheet', 'weekly-reports', 'edit']) {
    const path = `/aims/projects/263/${tab}`
    assert.equal(projectPageCanMount(path, null), false)
    assert.equal(projectPageCanMount(path, project), false)
    assert.equal(projectPageCanMount(path, { ...project, id: 264, canEditProject: true, projectTabAccess: { member: true } }), false)
    assert.equal(projectPageCanMount(path, { ...project, canEditProject: true, projectTabAccess: { member: true } }), true)
  }
  assert.equal(projectPageCanMount('/aims/projects/263', project), true)
  assert.equal(projectPageCanMount('/enterprise', null), true)
  assert.equal(projectPageCanMount('/aims/projects/263/weekly-reports', { ...project, projectTabAccess: { anyProjectManager: true } }), true)
})
