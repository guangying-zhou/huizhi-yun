import { getQuery } from 'h3'
import {
  getDirectoryProject,
  listDirectoryDepartments,
  listDirectoryProjects,
  listDirectoryUserProjects,
  ok,
  type ProjectItem
} from '~~/server/utils/directoryRuntime'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

interface DepartmentNode {
  deptCode?: string
  children?: DepartmentNode[]
}

function text(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value || '').trim()
}

function departmentPath(nodes: DepartmentNode[], target: string, parents: string[] = []): string[] | null {
  for (const node of nodes) {
    const code = text(node.deptCode)
    const path = code ? [...parents, code] : parents
    if (code === target) return path
    const nested = departmentPath(node.children || [], target, path)
    if (nested) return nested
  }
  return null
}

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(
    event,
    'console',
    'console:directory-project-access:read',
    { requireBoundTargetApp: true }
  )
  const binding = resolveConsoleRuntimeBinding(event)
  if (!actor.actorId || !actor.appCode || actor.tenantCode !== binding.tenantId) {
    throw createError({ statusCode: 403, message: 'directory service actor tenant binding mismatch' })
  }

  const query = getQuery(event)
  const projection = text(query.projection)
  const projectCode = text(query.project_code || query.projectCode)
  const actorUid = text(query.actor_uid || query.actorUid)
  if (projection === 'projects') {
    return ok(await listDirectoryProjects(query))
  }
  if (projection === 'user-projects') {
    if (!actorUid) {
      throw createError({ statusCode: 400, message: 'actor_uid is required' })
    }
    return ok(await listDirectoryUserProjects(actorUid, query))
  }
  if (projection === 'project') {
    if (!projectCode) {
      throw createError({ statusCode: 400, message: 'project_code is required' })
    }
    const project = await getDirectoryProject(projectCode)
    if (!project) {
      throw createError({ statusCode: 404, message: 'Project not found' })
    }
    return ok(project)
  }
  if (!projectCode || !actorUid) {
    throw createError({ statusCode: 400, message: 'project_code and actor_uid are required' })
  }

  const [project, userProjects, departments] = await Promise.all([
    getDirectoryProject(projectCode),
    listDirectoryUserProjects(actorUid),
    listDirectoryDepartments()
  ])
  if (!project) {
    throw createError({ statusCode: 404, message: 'Project not found' })
  }

  const actorProjectCodes = new Set(
    userProjects.items.map((item: ProjectItem) => text(item.projectCode)).filter(Boolean)
  )
  const deptCode = text(project.deptCode)
  const deptPath = deptCode
    ? departmentPath(departments.tree as DepartmentNode[], deptCode)
    : []
  if (deptCode && !deptPath) {
    throw createError({ statusCode: 503, message: 'Project department scope is unavailable' })
  }

  return ok({
    projectCode: text(project.projectCode),
    leaderUid: text(project.leaderUid) || null,
    deptCode: deptCode || null,
    departmentTree: deptPath || [],
    actorIsMember: actorProjectCodes.has(projectCode)
  })
})
