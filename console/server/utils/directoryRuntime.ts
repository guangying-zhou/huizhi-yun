import type { H3Event } from 'h3'
import {
  getConsoleAccessibleDepartments,
  getConsoleDirectoryCommittees,
  getConsoleDirectoryCommittee,
  getConsoleDirectoryCommitteeMembers,
  getConsoleDirectoryDepartment,
  getConsoleDirectoryDepartmentMembers,
  getConsoleDirectoryDepartments,
  getConsoleDirectoryProject,
  getConsoleDirectoryProjectMembers,
  getConsoleDirectoryProjects,
  getConsoleDirectorySubjectExports,
  getConsoleDirectorySubjectMemberships,
  getConsoleDirectoryUser,
  getConsoleDirectoryUserDepartments,
  getConsoleDirectoryUserProjects,
  getConsoleDirectoryUsers,
  getConsoleDirectoryUsersBatch,
  getConsoleDirectoryMeta,
  type ConsoleTenantRuntimeEnvelope
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

export interface DirectoryQuery {
  [key: string]: unknown
  search?: string
  keyword?: string
  dept_code?: string
  deptCode?: string
  parentDeptCode?: string
  status?: string
  role?: string
  cursor?: string
  limit?: string | number
  page?: string | number
  pageSize?: string | number
}

export interface AccountUserItem {
  id: number
  uid: string
  username?: string | null
  displayName?: string | null
  realName: string | null
  nickname: string | null
  email: string | null
  mobile: string | null
  mobileTail4?: string | null
  avatar: string | null
  gender: number
  status?: number
  deptCode: string | null
  deptName: string | null
  positionTitle?: string | null
  userType?: string
  dingtalkId?: string | null
}

export interface DeptNode {
  id?: number
  deptCode: string
  name: string
  parentId: string | null
  level: number
  orgType: string
  deptCategory: string | null
  managerId: string | null
  manager: string | null
  leaderId: string | null
  leader: string | null
  description?: string | null
  sortOrder?: number
  children: DeptNode[]
  users?: AccountUserItem[]
}

export interface ProjectItem {
  id: number
  projectCode: string
  parentId: string | null
  name: string
  deptCode: string | null
  ownerUid?: string | null
  leaderUid: string | null
  description: string | null
  status: number
  statusKey?: string
  repoUrl: string | null
  isGroup: number
  isTemplate: number
  docsSyncedAt: string | null
  docsCommittedAt: string | null
  role?: string | null
  subProjects: ProjectItem[]
}

export interface SubjectExportItem {
  subjectType: string
  subjectCode: string
  externalRef: string | null
  parentSubjectType: string | null
  parentSubjectCode: string | null
  sourceObjectType: string
  sourceObjectCode: string
  snapshotHash: string
  status: string
  exportedAt: string
  updatedAt: string
}

export interface SubjectMembershipItem {
  subjectType: string
  subjectCode: string
  containerSubjectType: string
  containerSubjectCode: string
  relationType: string
  isPrimary: boolean
  status: string
  updatedAt: string
}

function requestEvent() {
  return useEvent() as H3Event
}

function data<T>(envelope: ConsoleTenantRuntimeEnvelope<unknown>) {
  return envelope.data as T
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return 0
  const item = error as Record<string, unknown>
  return Number(item.statusCode || item.status)
}

export async function getDirectoryMeta() {
  return data<Record<string, unknown>>(await getConsoleDirectoryMeta(requestEvent()))
}

export async function listDirectoryUsers(query: DirectoryQuery = {}) {
  return data<{ items: AccountUserItem[], total: number, page?: number, pageSize?: number, tree: DeptNode[] }>(
    await getConsoleDirectoryUsers(requestEvent(), query)
  )
}

export async function getDirectoryUser(uid: string) {
  try {
    return data<AccountUserItem>(await getConsoleDirectoryUser(requestEvent(), uid))
  } catch (error: unknown) {
    if (errorStatus(error) === 404) return null
    throw error
  }
}

export async function getDirectoryUserForAdmin(uid: string) {
  try {
    return data<AccountUserItem>(await getConsoleDirectoryUser(requestEvent(), uid, true))
  } catch (error: unknown) {
    if (errorStatus(error) === 404) return null
    throw error
  }
}

export async function batchDirectoryUsers(uids: string[]) {
  return data<AccountUserItem[]>(await getConsoleDirectoryUsersBatch(requestEvent(), uids))
}

export async function listDirectoryDepartments(query: DirectoryQuery = {}) {
  return data<{ tree: DeptNode[], flat: DeptNode[] }>(
    await getConsoleDirectoryDepartments(requestEvent(), query)
  )
}

export async function listAccessibleDepartments(uid: string) {
  return data<DeptNode[]>(await getConsoleAccessibleDepartments(requestEvent(), uid))
}

export async function getDirectoryDepartment(deptCode: string) {
  try {
    return data<DeptNode>(await getConsoleDirectoryDepartment(requestEvent(), deptCode))
  } catch (error: unknown) {
    if (errorStatus(error) === 404) return null
    throw error
  }
}

export async function listDirectoryDepartmentMembers(deptCode: string, query: DirectoryQuery = {}) {
  return data<{ items: AccountUserItem[], total: number, page?: number, pageSize?: number }>(
    await getConsoleDirectoryDepartmentMembers(requestEvent(), deptCode, query)
  )
}

export async function listDirectoryUserDepartments(uid?: string) {
  return data<unknown>(await getConsoleDirectoryUserDepartments(requestEvent(), uid))
}

export async function listDirectoryProjects(query: DirectoryQuery = {}) {
  return data<{ items: ProjectItem[], flat: ProjectItem[], total: number, page?: number, pageSize?: number }>(
    await getConsoleDirectoryProjects(requestEvent(), query)
  )
}

export async function getDirectoryProject(projectCode: string) {
  try {
    return data<ProjectItem>(await getConsoleDirectoryProject(requestEvent(), projectCode))
  } catch (error: unknown) {
    if (errorStatus(error) === 404) return null
    throw error
  }
}

export async function listDirectoryProjectMembers(projectCode: string, query: DirectoryQuery = {}) {
  return data<unknown>(await getConsoleDirectoryProjectMembers(requestEvent(), projectCode, query))
}

export async function listDirectoryUserProjects(uid: string, query: DirectoryQuery = {}) {
  return data<{ items: ProjectItem[], total: number, page?: number, pageSize?: number }>(
    await getConsoleDirectoryUserProjects(requestEvent(), uid, query)
  )
}

export async function listDirectoryCommittees(query: DirectoryQuery = {}) {
  return data<unknown>(await getConsoleDirectoryCommittees(requestEvent(), query))
}

export async function getDirectoryCommittee(committeeCode: string) {
  try {
    return data<unknown>(await getConsoleDirectoryCommittee(requestEvent(), committeeCode))
  } catch (error: unknown) {
    if (errorStatus(error) === 404) return null
    throw error
  }
}

export async function listDirectoryCommitteeMembers(committeeCode: string, query: DirectoryQuery = {}) {
  return data<unknown>(await getConsoleDirectoryCommitteeMembers(requestEvent(), committeeCode, query))
}

export async function listSubjectExports(query: DirectoryQuery = {}) {
  return data<{
    items: SubjectExportItem[]
    nextCursor: string | null
    hasMore: boolean
  }>(await getConsoleDirectorySubjectExports(requestEvent(), query))
}

export async function listSubjectMemberships() {
  const items: SubjectMembershipItem[] = []
  let cursor: string | undefined
  do {
    const page = data<{
      items: SubjectMembershipItem[]
      nextCursor: string | null
      hasMore: boolean
    }>(await getConsoleDirectorySubjectMemberships(requestEvent(), { cursor, limit: 100 }))
    items.push(...page.items)
    cursor = page.nextCursor || undefined
  } while (cursor)
  return items
}

export function ok<T>(value: T) {
  return { code: 0, data: value }
}
