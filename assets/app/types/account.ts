/**
 * Account 模块类型定义
 */

export interface AccountUser {
  id: number
  uid: string
  realName: string
  nickname: string | null
  email: string
  mobile?: string | null
  avatar: string | null
  gender?: number
  status: number
  deptCode?: string | null
  deptName?: string | null
  department?: {
    id: number
    name: string
    code: string
  }
}

export interface Department {
  id: number
  deptCode: string
  name: string
  parentId?: string | null
  level?: number
  orgType?: string
  managerId?: string | null
  leaderId?: string | null
  children?: Department[]
}

export interface DepartmentResponse {
  tree: Department[]
  flat: Department[]
}

export interface Project {
  id: number
  projectCode: string
  name: string
  description?: string | null
  deptCode?: string | null
  leaderUid?: string | null
  status?: number
  isGroup?: number
  parentProjectCode?: string | null
  repoUrl?: string | null
  members?: string[]
  subProjects?: Project[]
  isExpanded?: boolean
}

export interface ProjectListResponse {
  items: Project[]
  total: number
}

export interface UserProjects {
  managed: Project[]
  joined: Project[]
}

export interface ApiResponse<T> {
  code: number
  message: string
  success?: boolean
  data: T
}
