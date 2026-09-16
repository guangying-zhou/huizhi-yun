// RBAC Role (from Account module)
export interface RbacRole {
  code: string
  name: string
}

export type SystemUserStatus = 0 | 1 | 2 // 0=禁用, 1=激活, 2=待验证

export interface SystemUser {
  id: number
  email: string
  uid?: string | null
  roles?: RbacRole[]
  personId?: number | null
  deptCode?: number | null
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

/**
 * 项目文档管理相关类型定义
 */

export interface Folder {
  id: number
  name: string
  folderType: 'folder'
  ownerUid: string
  deptCode?: number
  projectCode: number
  parentId?: number | null
  sortOrder?: number
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface ProjectDocument {
  id: number
  uuid?: string
  title: string
  docType: string
  ossPath: string
  ownerUid: string
  projectCode: number
  folderId?: number | null
  status: number
  contentSize?: number
  lastEditorUid?: string
  createdAt?: string
  updatedAt?: string
  committedAt?: string
  deletedAt?: string
  [key: string]: unknown
}

export interface ProjectFileItem {
  uuid: string
  name: string
  path: string
  ossPath: string
  docType: 'private' | 'slide' | 'shared' | 'department' | 'project' | 'git-project' | 'company' | 'knowledge' | 'product' | 'sale'
  size: number
  lastModified: string
  createdAt?: string
  committedAt?: string // GitLab 提交时间，用于判断是否已修改
  isDirectory: boolean
  isModified: boolean | 0 | 1
  children?: ProjectFileItem[]
  // 冲突相关字段（从 OSS 元数据读取）
  conflictStatus?: boolean
  gitlabLatestSize?: string | null
  gitlabLatestCommitId?: string | null
  [key: string]: unknown
}

// Tree item type (混合目录和文件)
export interface ProjectDocsTreeItem {
  type: 'folder' | 'document'
  id: number | string
  uuid?: string
  nodeId: string
  parentId?: number
  name: string
  data: Record<string, unknown>
  children?: ProjectDocsTreeItem[]
}
