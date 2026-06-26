/**
 * Account 模块相关类型定义
 */

import type { ProjectDocsTreeItem, ProjectFileItem } from './index'

export interface AccountApiResponse<T> {
  code: number
  success?: boolean
  message?: string
  data: T
}

export type ApiResponse<T> = AccountApiResponse<T>

export interface HzyRuntimeConfig {
  apiBaseUrl?: string
  apiKey?: string
  apiSecret?: string
}

export interface CodocsPublicRuntimeConfig {
  casEnable?: boolean
  casBaseUrl?: string
  serviceUrl?: string
  wecomCorpid?: string
  wecomAgentid?: string
}

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'publish' | 'submit' | 'approve' | 'archive' | 'export' | 'admin'

export interface AccountRole {
  code: string
  name: string
}

export type AccountPermissionsMap = Record<string, PermissionAction[]>

export interface UserPermissionsData {
  uid: string
  roles: AccountRole[]
  resources: AccountPermissionsMap
}

export type UserPermissionsResponse = AccountApiResponse<UserPermissionsData>

export interface AccountUser {
  id: number
  uid: string
  realName: string
  nickname: string | null
  email: string
  mobile?: string
  avatar: string | null
  gender?: number
  status: number
  deptCode?: string
  deptName?: string
  department?: {
    id: number
    name: string
    code: string
  }
}

export interface Department {
  id?: number
  deptCode: string
  name: string
  parentId: string | null
  level: number
  orgType?: string
  deptCategory?: number | null
  managerId?: string | null
  manager?: string | null
  leaderId?: string | null
  leader?: string | null
  isActive?: boolean
  description?: string | null
  leaderUid?: string
  children?: Department[]
}

export interface DepartmentResponse {
  tree: Department[]
  flat: Department[]
}

export interface UserDepartmentData extends Department {
  managed?: Department[]
  committees?: Department[]
  led?: Department[]
}

export type UserDepartmentResponse = AccountApiResponse<UserDepartmentData>

export interface Project {
  projectCode: string
  parentId?: string | null
  name: string
  deptCode: string
  leaderUid: string
  description?: string
  status: number
  isGroup: number
  isTemplate: number
  repoUrl?: string
  docsSyncedAt?: string
  docsCommittedAt?: string
  members?: ProjectMember[]
  subProjects?: Project[]
  isExpanded?: boolean
  documents?: ProjectFileItem[] | undefined
  docsTree: ProjectDocsTreeItem[] | undefined
  docsLoading?: boolean
  filesModifiedCount?: number
}

export interface ProjectListResponse {
  items: Project[]
  total: number
}

export interface ProjectMember {
  uid: string
  role: string
}

export interface UserProjects {
  managed: Project[]
  joined: Project[]
}

export interface AccountUsersData {
  items: AccountUser[]
  tree?: Array<Department & { users?: AccountUser[] }>
}

export type AccountUsersResponse = AccountApiResponse<AccountUsersData>

// GitLab 文件信息
export interface GitlabFileInfo {
  doc_path: string
  oss_path: string
  content_size?: number // 文件大小（字节）
  gitlab_commit_id?: string
  gitlab_commit_time?: string
  gitlab_committer?: string
  diff?: string
}

// GitLab 同步响应
export interface GitlabSyncResponse {
  new: GitlabFileInfo[]
  updated: GitlabFileInfo[] // 自动更新的文件
  nochange: Omit<GitlabFileInfo, 'gitlab_commit_id' | 'gitlab_commit_time' | 'gitlab_committer' | 'diff'>[]
  conflict: GitlabFileInfo[]
  deleted: Omit<GitlabFileInfo, 'doc_path'>[]
}

// 冲突解决请求
export interface ConflictDoc {
  oss_path: string
  use_gitlab?: boolean
  delete?: boolean
}

// 冲突解决响应中的文档
export interface ResolvedDoc {
  oss_path: string
  use_gitlab?: boolean
  delete?: boolean
  content_size?: number
}

export interface ResolveConflictsRequest {
  uid: string
  docs: ConflictDoc[]
}

export interface ResolveConflictsResponse {
  code: number
  message: string
  docs: ResolvedDoc[]
}

// GitLab 提交文档
export interface GitlabSubmitDoc {
  oss_path: string
  gitlab_path: string
}

export interface GitlabSubmitRequest {
  uid: string
  docs: GitlabSubmitDoc[]
}

export interface GitlabSubmitResponse {
  revision: string
  commitId: string
}

export interface LegacySuccessApiResponse<T> {
  success: boolean
  message: string
  data: T
}
