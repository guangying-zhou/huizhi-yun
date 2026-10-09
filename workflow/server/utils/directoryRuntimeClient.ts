import { createError, type H3Event } from 'h3'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'

interface ApiEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

export interface DirectoryUser {
  uid: string
  username?: string | null
  displayName?: string | null
  realName?: string | null
  nickname?: string | null
  email?: string | null
  mobile?: string | null
  avatar?: string | null
  deptCode?: string | null
  deptName?: string | null
  positionTitle?: string | null
}

export interface DirectoryDepartment {
  id?: number
  deptCode: string
  name: string
  orgType?: string | null
  parentId?: string | null
  managerId?: string | null
  leaderId?: string | null
  level?: number
}

export interface DirectoryDepartmentMember extends DirectoryUser {
  deptCode?: string | null
  deptName?: string | null
}

function unwrapEnvelope<T>(response: ApiEnvelope<T>): T | null {
  if (response.code !== undefined && response.code !== 0) {
    throw createError({
      statusCode: 502,
      statusMessage: 'DIR_UPSTREAM_INVALID_RESPONSE',
      message: response.message || 'Console Directory returned an unsuccessful response'
    })
  }
  return response.data ?? null
}

export async function getDirectoryUserByUid(event: H3Event, uid: string): Promise<DirectoryUser | null> {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid) return null

  const response = await fetchConsoleDirectoryApi<ApiEnvelope<DirectoryUser>>(
    `/users/${encodeURIComponent(normalizedUid)}`,
    { event }
  )
  return unwrapEnvelope(response)
}

export async function listDirectoryDepartments(event: H3Event): Promise<DirectoryDepartment[]> {
  const response = await fetchConsoleDirectoryApi<ApiEnvelope<{ flat?: DirectoryDepartment[] }>>(
    '/departments',
    { event }
  )
  const data = unwrapEnvelope(response)
  return Array.isArray(data?.flat) ? data.flat : []
}

export async function getDirectoryDepartmentByCode(event: H3Event, deptCode: string): Promise<DirectoryDepartment | null> {
  const normalizedDeptCode = String(deptCode || '').trim()
  if (!normalizedDeptCode) return null

  const departments = await listDirectoryDepartments(event)
  return departments.find(department => department.deptCode === normalizedDeptCode) || null
}

export async function listDirectoryDepartmentMembers(event: H3Event, deptCode: string): Promise<DirectoryDepartmentMember[]> {
  const normalizedDeptCode = String(deptCode || '').trim()
  if (!normalizedDeptCode) return []

  const response = await fetchConsoleDirectoryApi<ApiEnvelope<{ items?: DirectoryDepartmentMember[] }>>(
    '/users',
    { event, params: { dept_code: normalizedDeptCode } }
  )
  const data = unwrapEnvelope(response)
  return Array.isArray(data?.items) ? data.items : []
}
