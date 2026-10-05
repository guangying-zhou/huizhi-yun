import { getQuery, setHeader } from 'h3'
import {
  batchDirectoryUsers,
  listDirectoryDepartments,
  listDirectoryUserDepartments,
  listDirectoryUsers,
  ok
} from '~~/server/utils/directoryRuntime'
import { resolveConsoleRuntimeBinding } from '~~/server/utils/consoleRuntimeBinding'
import { requireConsoleServiceActor } from '~~/server/utils/vault'
import { directoryActiveStatuses } from '~~/server/utils/directoryActiveStatus'

function queryText(value: unknown) {
  const normalized = String(Array.isArray(value) ? value[0] : value || '').trim()
  return normalized || undefined
}

function sharingUser(user: Awaited<ReturnType<typeof batchDirectoryUsers>>[number]) {
  return {
    uid: user.uid,
    realName: user.realName,
    displayName: user.displayName,
    avatar: user.avatar,
    deptCode: user.deptCode,
    deptName: user.deptName,
    positionTitle: user.positionTitle
  }
}

function sharingDepartment(node: Record<string, unknown>): Record<string, unknown> {
  return {
    id: node.id,
    deptCode: node.deptCode,
    name: node.name,
    parentId: node.parentId,
    level: node.level,
    orgType: node.orgType,
    managerId: node.managerId,
    leaderId: node.leaderId,
    children: Array.isArray(node.children)
      ? node.children.map(child => sharingDepartment(child as Record<string, unknown>))
      : []
  }
}

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(
    event,
    'console',
    'console:directory-users:read',
    { requireBoundTargetApp: true }
  )
  const binding = resolveConsoleRuntimeBinding(event)
  if (!actor.actorId || !actor.appCode || actor.tenantCode !== binding.tenantId) {
    throw createError({ statusCode: 403, message: 'directory service actor tenant binding mismatch' })
  }

  const query = getQuery(event)
  if (queryText(query.projection) === 'user-departments') {
    const uid = queryText(query.uid)
    if (!uid) {
      throw createError({ statusCode: 400, message: 'uid is required' })
    }
    return ok(await listDirectoryUserDepartments(uid))
  }

  if (queryText(query.projection) === 'departments') {
    const departments = await listDirectoryDepartments()
    return ok({
      tree: departments.tree.map(node => sharingDepartment(node as unknown as Record<string, unknown>)),
      flat: departments.flat.map(node => sharingDepartment(node as unknown as Record<string, unknown>))
    })
  }

  const requestedUids = queryText(query.uids)
    ?.split(',')
    .map(uid => uid.trim())
    .filter(Boolean)
  if (queryText(query.projection) === 'active-status') {
    setHeader(event, 'Cache-Control', 'no-store')
    if (!requestedUids?.length || requestedUids.length > 100) {
      throw createError({ statusCode: 400, message: 'active-status requires 1 to 100 explicit uids' })
    }
    return ok(directoryActiveStatuses(requestedUids, await batchDirectoryUsers(requestedUids)))
  }
  if (requestedUids?.length) {
    return ok((await batchDirectoryUsers(requestedUids)).map(sharingUser))
  }

  const result = await listDirectoryUsers({
    search: queryText(query.search),
    dept_code: queryText(query.dept_code || query.deptCode),
    page: queryText(query.page),
    pageSize: queryText(query.pageSize || query.limit)
  })

  return ok({
    items: result.items.map(sharingUser),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    tree: []
  })
})
