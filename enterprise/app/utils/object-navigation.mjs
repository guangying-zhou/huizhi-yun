import { matchRegisteredPage } from '../../shared/registered-page.mjs'

const PROJECT_ID = /^[1-9]\d*$/
const SOURCE_QUERY_KEYS = new Set(['page', 'pageSize', 'search', 'keyword', 'category', 'status', 'portfolio', 'portfolioId', 'participatingOnly', 'view', 'sort', 'order', 'filter', 'tab', 'versionId', 'featureId', 'component', 'domainCode'])

export function projectAllowsCreate(project) {
  const admin = project?.currentUserIsProjectAdmin ?? project?.current_user_is_project_admin
  const role = project?.currentUserRole ?? project?.current_user_role
  return admin === true || admin === 1 || role === 'manager' || role === 'member'
}

export function isUsableProject(project) {
  const access = project?.canAccess ?? project?.can_access
  return Boolean(project && PROJECT_ID.test(String(project.id)) && Number.isSafeInteger(Number(project.id)) && (access === true || access === 1) && !project.deletedAt && !project.deleted_at && String(project.name || '').trim())
}

export function numericProjectId(route, workspace) {
  const params = route?.params || {}
  const candidate = params.id ?? params.projectId
  const id = Array.isArray(candidate) ? candidate[0] : candidate
  if (typeof id !== 'string' && typeof id !== 'number') return ''
  const value = String(id)
  if (!PROJECT_ID.test(value) || !Number.isSafeInteger(Number(value))) return ''
  const base = String(workspace?.base || '')
  if (!base.startsWith('/')) return ''
  const prefix = `${base.replace(/\/:[^/]+$/, '')}/`
  const path = String(route?.path || '')
  if (!path.startsWith(`${prefix}${value}`)) return ''
  if (path.charAt(prefix.length + value.length) && path.charAt(prefix.length + value.length) !== '/') return ''
  const matched = Array.isArray(route?.matched) && route.matched.some((record) => {
    const pattern = String(record?.path || '')
    return /^\/aims\/projects\/:(?:id|projectId)(?:\/|$)/.test(pattern)
  })
  return matched ? value : ''
}

export function filterObjectGroups(workspace, visibleIds, project) {
  const allowed = visibleIds ? new Set(visibleIds) : null
  return (workspace?.groups || []).map(group => ({
    ...group,
    items: (group.items || []).filter((item) => {
      if (allowed && !allowed.has(item.id)) return false
      const tab = projectTabForPath(item.path)
      if (tab && !projectTabAllows(project, tab)) return false
      const action = item.permission?.action
      if (item.id === 'aims.project.edit') return project?.canEditProject === true
      if (!action || ['view', 'read'].includes(action)) return true
      const admin = project?.currentUserIsProjectAdmin ?? project?.current_user_is_project_admin
      const role = project?.currentUserRole ?? project?.current_user_role
      return admin === true || admin === 1 || role === 'manager'
    })
  })).filter(group => group.items.length)
}

function allowedSourcePath(pathname) {
  return pathname === '/aims/projects'
    || pathname === '/assets/products'
    || pathname.startsWith('/assets/products/')
    || pathname === '/aims/products'
    || pathname.startsWith('/aims/products/')
}

export function safeProjectReturn(value, registeredPages) {
  const source = Array.isArray(value) ? value[0] : value
  // eslint-disable-next-line no-control-regex -- Reject control characters in navigation targets.
  if (typeof source !== 'string' || source.length > 3000 || !source.startsWith('/') || source.startsWith('//') || /[\u0000-\u001f\u007f]/.test(source)) return ''
  try {
    const parsed = new URL(source, 'https://enterprise.invalid')
    const pathname = decodeURIComponent(parsed.pathname)
    if (parsed.origin !== 'https://enterprise.invalid' || pathname.startsWith('//') || !allowedSourcePath(pathname)) return ''
    if (registeredPages && !matchRegisteredPage(source, registeredPages)) return ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (!SOURCE_QUERY_KEYS.has(key)) parsed.searchParams.delete(key)
    }
    // eslint-disable-next-line no-control-regex -- Hashes follow the same control-character boundary.
    if (/[\u0000-\u001f\u007f]/.test(decodeURIComponent(parsed.hash))) return ''
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return ''
  }
}

export function projectReturnTarget(query = {}, registeredPages) {
  return safeProjectReturn(query.returnTo, registeredPages) || safeProjectReturn(query.from, registeredPages) || '/aims/projects'
}

export function projectWorkspaceWithWriteAccess(workspace, completeWorkspace, project) {
  // Navigation remains discovery: only the current detail response can add this
  // exact object action, never a global permission or arbitrary module action.
  const groups = (workspace?.groups || []).map(group => ({ ...group, items: group.items.filter(item => item.id !== 'aims.project.edit') }))
  if (project?.canEditProject === true) {
    const group = completeWorkspace?.groups.find(group => group.items.some(item => item.id === 'aims.project.edit'))
    const item = group?.items.find(item => item.id === 'aims.project.edit')
    if (group && item && !groups.some(group => group.items.some(item => item.id === 'aims.project.edit'))) {
      const existing = groups.find(candidate => candidate.id === group.id)
      if (existing) existing.items.push(item)
      else groups.push({ ...group, items: [item] })
    }
  }
  return { ...workspace, groups }
}

export function projectTabForPath(path) {
  const segment = String(path || '').split('/').filter(Boolean)[0]
  return ({ 'board': 'board', 'work-items': 'goals', 'requirements': 'requirements', 'risks': 'risks', 'metrics': 'metrics', 'timesheet': 'timesheet', 'weekly-reports': 'weekly-reports', 'edit': 'settings' })[segment] || ''
}
export function projectTabAllows(project, tab) {
  if (tab === 'settings') return project?.canEditProject === true
  const facts = project?.projectTabAccess
  if (!facts) return false
  if (tab === 'weekly-reports') return facts.member === true || facts.management === true || facts.anyProjectManager === true
  return facts.member === true || facts.management === true
}

// Resolve before navigation discovery has loaded, so restricted pages cannot
// mount while their project summary is still unknown. No authorization inference.
export function projectRouteTab(path) {
  const match = /^\/aims\/projects\/([1-9]\d*)(?:\/(.*))?$/.exec(String(path || ''))
  return match ? projectTabForPath(match[2]) : ''
}
export function projectPageCanMount(path, project) {
  const match = /^\/aims\/projects\/([1-9]\d*)(?:\/|$)/.exec(String(path))
  if (!match) return true
  const tab = projectRouteTab(path)
  return String(project?.id) === match[1] && isUsableProject(project) && (!tab || projectTabAllows(project, tab))
}
