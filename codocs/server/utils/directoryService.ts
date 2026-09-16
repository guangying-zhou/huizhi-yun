import { $fetch } from 'ofetch'
import type { H3Event } from 'h3'
import { resolveConsoleRuntimeBaseUrl } from '@hzy/foundation/server/utils/consoleRuntime'
import {
  requestWithServiceAccessToken,
  trustedServiceRequestHeaders
} from '@hzy/foundation/server/utils/serviceOidc'
import type {
  AccountUser,
  AccountUsersData,
  DepartmentResponse,
  Project,
  ProjectListResponse,
  UserProjects
} from '~/types/account'

interface ConsoleResponse<T> {
  code: number
  message?: string
  data: T
}

function consoleBaseUrl(event: H3Event) {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>
  const baseUrl = resolveConsoleRuntimeBaseUrl(config, event)
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Console runtime is not configured' })
  }
  return baseUrl
}

export async function fetchDirectoryUsersByService(
  event: H3Event,
  query: Record<string, unknown> = {}
) {
  const baseUrl = consoleBaseUrl(event)
  return await requestWithServiceAccessToken<ConsoleResponse<AccountUsersData>>({
    audience: 'console',
    scope: 'console:directory-users:read',
    event,
    request: token => $fetch(`${baseUrl}/api/v1/console/service/directory/users`, {
      headers: { ...trustedServiceRequestHeaders(event), Authorization: `Bearer ${token}` },
      params: query,
      timeout: 10000
    })
  })
}

export function fetchDirectoryDepartmentMembersByService(
  event: H3Event,
  deptCode: string,
  query: Record<string, unknown> = {}
) {
  return fetchDirectoryUsersByService(event, {
    ...query,
    dept_code: deptCode
  })
}

export async function fetchDirectoryUsersBatchByService(
  event: H3Event,
  uids: string[]
) {
  const baseUrl = consoleBaseUrl(event)
  return await requestWithServiceAccessToken<ConsoleResponse<AccountUser[]>>({
    audience: 'console',
    scope: 'console:directory-users:read',
    event,
    request: token => $fetch(`${baseUrl}/api/v1/console/service/directory/users`, {
      headers: { ...trustedServiceRequestHeaders(event), Authorization: `Bearer ${token}` },
      params: { uids: uids.join(',') },
      timeout: 10000
    })
  })
}

export async function fetchDirectoryDepartmentsByService(event: H3Event) {
  const baseUrl = consoleBaseUrl(event)
  return await requestWithServiceAccessToken<ConsoleResponse<DepartmentResponse>>({
    audience: 'console',
    scope: 'console:directory-users:read',
    event,
    request: token => $fetch(`${baseUrl}/api/v1/console/service/directory/users`, {
      headers: { ...trustedServiceRequestHeaders(event), Authorization: `Bearer ${token}` },
      params: { projection: 'departments' },
      timeout: 10000
    })
  })
}

export async function fetchDirectoryUserDepartmentsByService(event: H3Event, uid: string) {
  const baseUrl = consoleBaseUrl(event)
  return await requestWithServiceAccessToken<ConsoleResponse<{
    departments: Array<{
      deptCode: string
      name?: string
      parentId?: string | null
      orgType?: string
      relationType?: string
      isPrimary?: boolean
    }>
    primaryDeptCode?: string | null
  }>>({
    audience: 'console',
    scope: 'console:directory-users:read',
    event,
    request: token => $fetch(`${baseUrl}/api/v1/console/service/directory/users`, {
      headers: { ...trustedServiceRequestHeaders(event), Authorization: `Bearer ${token}` },
      params: { projection: 'user-departments', uid },
      timeout: 10000
    })
  })
}

async function fetchDirectoryProjectProjectionByService<T>(
  event: H3Event,
  params: Record<string, unknown>
) {
  const baseUrl = consoleBaseUrl(event)
  return await requestWithServiceAccessToken<ConsoleResponse<T>>({
    audience: 'console',
    scope: 'console:directory-project-access:read',
    event,
    request: token => $fetch(`${baseUrl}/api/v1/console/service/directory/project-access`, {
      headers: { ...trustedServiceRequestHeaders(event), Authorization: `Bearer ${token}` },
      params,
      timeout: 10000
    })
  })
}

export function fetchDirectoryProjectsByService(event: H3Event, query: Record<string, unknown> = {}) {
  return fetchDirectoryProjectProjectionByService<ProjectListResponse>(event, {
    ...query,
    projection: 'projects'
  })
}

export function fetchDirectoryUserProjectsByService(
  event: H3Event,
  uid: string,
  query: Record<string, unknown> = {}
) {
  return fetchDirectoryProjectProjectionByService<UserProjects>(event, {
    ...query,
    projection: 'user-projects',
    actor_uid: uid
  })
}

export function fetchDirectoryProjectByService(event: H3Event, projectCode: string) {
  return fetchDirectoryProjectProjectionByService<Project>(event, {
    projection: 'project',
    project_code: projectCode
  })
}

export interface DirectoryProjectAccess {
  projectCode: string
  leaderUid: string | null
  deptCode: string | null
  departmentTree: string[]
  actorIsMember: boolean
}

export async function fetchDirectoryProjectAccessByService(
  event: H3Event,
  projectCode: string,
  actorUid: string
) {
  const baseUrl = consoleBaseUrl(event)
  return await requestWithServiceAccessToken<ConsoleResponse<DirectoryProjectAccess>>({
    audience: 'console',
    scope: 'console:directory-project-access:read',
    event,
    request: token => $fetch(`${baseUrl}/api/v1/console/service/directory/project-access`, {
      headers: { ...trustedServiceRequestHeaders(event), Authorization: `Bearer ${token}` },
      params: { project_code: projectCode, actor_uid: actorUid },
      timeout: 10000
    })
  })
}
