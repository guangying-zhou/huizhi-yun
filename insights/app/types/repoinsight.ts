// RepoInsight Types
// Migrated from CodeInsight

import type { AvatarProps } from '@nuxt/ui'

export type UserStatus = 'subscribed' | 'unsubscribed' | 'bounced'
export type SaleStatus = 'paid' | 'failed' | 'refunded'

export interface User {
  id: number
  name: string
  email: string
  avatar?: AvatarProps
  status: UserStatus
  location: string
}

export interface Mail {
  id: number
  unread?: boolean
  from: User
  subject: string
  body: string
  date: string
}

export interface Member {
  name: string
  username: string
  role: 'member' | 'owner'
  avatar: AvatarProps
}

export interface Stat {
  title: string
  icon: string
  value: number | string
  variation: number
  formatter?: (value: number) => string
}

export interface Sale {
  id: string
  date: string
  status: SaleStatus
  email: string
  amount: number
}

export interface Notification {
  id: number
  unread?: boolean
  sender: User
  body: string
  date: string
}

export type Period = 'daily' | 'weekly' | 'monthly'

export interface Range {
  start: Date
  end: Date
}

export type RepoSourceType = 'svn' | 'gitlab'

export interface RepoSummary {
  id: number
  sourceId?: number
  sourceType: RepoSourceType
  repoKey: string
  name: string
  description?: string | null
  departmentId?: number | null
  defaultBranch?: string | null
  repoCreatedAt?: string | null
  latestRevision?: string | null
  latestCommitAt?: string | null
  lastScannedAt?: string | null
  scanStatus: string
  isValid: boolean
  totalCommits?: number
  ingestedCommits?: number
  syncedCommits?: number
  codeLines?: number
  commitsEvents?: number
  repoEvents?: number
  currentCommitYear?: number | null
  currentYearCommits?: number
  periodWorkingDays?: number
}

export interface RepoReportItem {
  repo_catalog_id: number
  repo_name: string
  department_name: string
  active_contributors: number
  total_commits: number
  net_lines_added: number
  total_lines_changed: number
  net_files_added: number
  daily_avg_lines: number
  submission_quality: number
  code_quality: number
  days: number
  periodWorkingDays: number
}

export interface RepoDetail extends RepoSummary {
  repoPath?: string | null
  gitlabProjectId?: number | null
  visibility?: string | null
  extra?: unknown
  languageBreakdown?: { name: string, value: number }[] | null
  stats: {
    commitCount: number
    runCount: number
  }
}

export interface Department {
  id: number
  name: string
  code?: string | null
  parentId?: number | null
  isActive: boolean
}

export interface TrendRow {
  stat_year: number
  stat_month: number
  active_repos: number
  active_contributors: number
  total_commits: number
  files_added: number
  lines_added: number
  lines_deleted: number
  lines_modified: number
  duplicate_lines: number
  submission_quality: number
  net_lines: number
  workload: number
}

export interface CommitSummary {
  id: number
  revision: string
  committedAt?: string | null
  authoredAt?: string | null
  authorName?: string | null
  authorEmail?: string | null
  committerName?: string | null
  committerEmail?: string | null
  title?: string | null
  message?: string | null
  filesAdded?: number | null
  filesDeleted?: number | null
  filesModified?: number | null
  linesAdded?: number | null
  linesDeleted?: number | null
  linesModified?: number | null
  filesChanged?: number | null
  abnormalEvents?: number | null
}

export interface CommitDetail extends CommitSummary {
  repoCatalogId: number
  sourceType: RepoSourceType
  repoKey: string
  parentRevisions?: unknown
  rawMetadata?: unknown
  ingestedAt: string
}

export interface CommitFileChange {
  id: number
  repoCommitId: number
  filePath: string
  changeType: string
  linesAdded?: number | null
  linesDeleted?: number | null
  linesModified?: number | null
  bytesBefore?: number | null
  bytesAfter?: number | null
  canLineCount: boolean
}

export interface IngestionRun {
  id: number
  jobType: string
  sourceType?: RepoSourceType | null
  repoCatalogId?: number | null
  repoKey?: string | null
  repoName?: string | null
  status: string
  startedAt: string
  finishedAt?: string | null
  itemsTotal?: number | null
  itemsProcessed?: number | null
  itemsFailed?: number | null
  errorMessage?: string | null
  triggeredBy?: string | null
  params?: unknown
}

export interface IngestionRunLog {
  id: number
  runId: number
  level: string
  message: string
  context?: unknown
  createdAt: string
}

// System User Role Masks (bitwise)
export const ROLE_USER = 1 // 普通用户
export const ROLE_DEPT_MANAGER = 2 // 部门经理
export const ROLE_HR = 4 // HR
export const ROLE_SUPERVISOR = 8 // 分管领导
export const ROLE_ADMIN = 16 // 超级管理员

export type SystemUserStatus = 0 | 1 | 2 // 0=禁用, 1=激活, 2=待验证

export interface SystemUser {
  id: number
  email: string
  username?: string | null
  umask: number
  personId?: number | null
  departmentId?: number | null
  mobile?: string | null
  status: SystemUserStatus
  puId?: number | null
  verificationCode?: string | null
  vcExpiredAt?: string | null
  latestLoggedAt?: string | null
  loginIp?: string | null
  remark?: string | null
  createdAt: string
  updatedAt: string
}

// Helper functions for role checking
export function hasRole(umask: number, role: number): boolean {
  return (umask & role) !== 0
}

export function hasAnyRole(umask: number, ...roles: number[]): boolean {
  const combined = roles.reduce((acc, r) => acc | r, 0)
  return (umask & combined) !== 0
}

export function hasAllRoles(umask: number, ...roles: number[]): boolean {
  const combined = roles.reduce((acc, r) => acc | r, 0)
  return (umask & combined) === combined
}

// Tenant auth types
export interface TenantAuthSession {
  business: string
  userId: number // Tenant database user ID (system_users.id in backend)
  platformUserId?: string // Platform SaaS user ID (users.id in SaaS DB) - for membership queries
  role: number
  token?: string
  email?: string
  username?: string
}
