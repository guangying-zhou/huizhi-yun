/**
 * 应用 Manifest 类型定义
 *
 * 各业务模块声明自己的资源和审批动作，启动时同步到 Account 和 Workflow。
 */

/** 权限资源（同步到 Account） */
export interface ResourceManifestItem {
  code: string
  name: string
  description?: string
  sortOrder?: number
}

/** 审批动作（同步到 Workflow） */
export interface ApprovalActionManifestItem {
  resourceCode: string
  actionCode: string
  name: string
  description?: string
  formSchemaCode?: string
  icon?: string
  embedUrlPattern?: string
  sortOrder?: number
  enabled?: boolean
}
