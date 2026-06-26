import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'

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
    return null
  }
  return response.data ?? null
}

export async function getDirectoryUserByUid(uid: string): Promise<DirectoryUser | null> {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid) return null

  try {
    const response = await fetchDirectoryApi<ApiEnvelope<DirectoryUser>>(
      `/api/v1/directory/users/${encodeURIComponent(normalizedUid)}`
    )
    return unwrapEnvelope(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[DirectoryRuntime] Failed to fetch user ${normalizedUid}: ${message}`)
    return null
  }
}

export async function getDirectoryDepartmentByCode(deptCode: string): Promise<DirectoryDepartment | null> {
  const normalizedDeptCode = String(deptCode || '').trim()
  if (!normalizedDeptCode) return null

  try {
    const response = await fetchDirectoryApi<ApiEnvelope<DirectoryDepartment>>(
      `/api/v1/directory/departments/${encodeURIComponent(normalizedDeptCode)}`
    )
    return unwrapEnvelope(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[DirectoryRuntime] Failed to fetch department ${normalizedDeptCode}: ${message}`)
    return null
  }
}

export async function listDirectoryDepartmentMembers(deptCode: string): Promise<DirectoryDepartmentMember[]> {
  const normalizedDeptCode = String(deptCode || '').trim()
  if (!normalizedDeptCode) return []

  try {
    const response = await fetchDirectoryApi<ApiEnvelope<{ items?: DirectoryDepartmentMember[] }>>(
      `/api/v1/directory/departments/${encodeURIComponent(normalizedDeptCode)}/members`
    )
    const data = unwrapEnvelope(response)
    return Array.isArray(data?.items) ? data.items : []
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[DirectoryRuntime] Failed to fetch department members ${normalizedDeptCode}: ${message}`)
    return []
  }
}
