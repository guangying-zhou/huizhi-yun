/**
 * 回收站相关的组合式函数
 * 提供文件名冲突检测、智能重命名、恢复操作等
 */

import type { ProjectDocument } from '~/types/index'

export const useRecycleBin = () => {
  const toast = useToast()

  /**
   * 格式化文档位置信息
   */
  const formatDocLocation = (doc: ProjectDocument): string => {
    if (!doc) return ''

    const parts: string[] = []

    // 文档类型位置
    if (doc.docType === 'private') {
      parts.push('我的文档')
    } else if (doc.docType === 'slide') {
      parts.push('演示文稿')
    } else if (doc.docType === 'department') {
      parts.push('部门协作')
    } else if (doc.docType === 'project' || doc.docType === 'git-project') {
      parts.push('项目文档')
      if (doc.projectCode) {
        parts.push(String(doc.projectCode))
      }
    }

    // 文件夹
    // 假设 doc 包含 folder_name（根据 view_file 结果，ProjectDocument 没有 folder_name，但 doc: any 被使用，说明可能有些扩展）
    const d = doc as Record<string, unknown>
    if (d.folder_name) {
      parts.push(String(d.folder_name))
    }

    return parts.length > 0 ? parts.join(' / ') : '根目录'
  }

  /**

   * 生成智能默认文件名（冲突时）
   * 规则：如果文件名最后带 v/Vnn 版本号则自动递增，否则加下划线加日期
   */
  const generateConflictName = (title: string): string => {
    // 检查是否以 v/V + 数字 结尾
    const versionMatch = title.match(/^(.*?)[vV](\d+)$/)
    if (versionMatch?.[1] && versionMatch[2]) {
      const base = versionMatch[1]
      const ver = parseInt(versionMatch[2]) + 1
      return `${base}v${ver}`
    }

    // 否则加下划线加日期
    const now = new Date()
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    return `${title}_${dateStr}`
  }

  /**
   * 检查文件名是否冲突
   */
  const checkNameConflict = async (params: {
    title: string
    doc_type: string
    owner_uid?: string
    folder_id?: number | null
    dept_code?: string
    project_code?: string
    exclude_uuid?: string
  }): Promise<boolean> => {
    try {
      const query: Record<string, string | number> = { title: params.title, doc_type: params.doc_type }
      if (params.owner_uid) query.owner_uid = params.owner_uid
      if (params.folder_id !== undefined && params.folder_id !== null) {
        query.folder_id = params.folder_id
      } else {
        query.folder_id = 'null'
      }
      if (params.dept_code) query.dept_code = params.dept_code
      if (params.project_code) query.project_code = params.project_code
      if (params.exclude_uuid) query.exclude_uuid = params.exclude_uuid

      const result = await $fetch<{ success: boolean, data: { exists: boolean } }>('/api/documents/check-name', {
        query
      })
      return result?.data?.exists || false
    } catch {
      return false
    }
  }

  /**
   * 获取回收站文档列表
   */
  const fetchTrashDocuments = async (params: {
    type?: string
    owner?: string
    dept_code?: string
    project_code?: string
  }) => {
    try {
      const result = await $fetch<{ success: boolean, data: { items: ProjectDocument[] } }>('/api/documents/trash', {
        query: params
      })
      return result?.data?.items || []
    } catch {
      return []
    }
  }

  /**
   * 恢复文档
   */
  const restoreDocument = async (uuid: string, newTitle?: string): Promise<boolean> => {
    try {
      const body: Record<string, string> = {}
      if (newTitle) body.new_title = newTitle

      await $fetch(`/api/documents/${uuid}/restore`, {
        method: 'POST',
        body
      })
      toast.add({ title: '文档已恢复', color: 'success' })
      return true
    } catch (err: unknown) {
      const error = err as { data?: { message?: string }, message?: string }
      toast.add({ title: error.data?.message || error.message || '恢复失败', color: 'error' })
      return false
    }
  }

  /**
   * 格式化删除时间（显示"n天后彻底删除"）
   */
  const formatDeletedAt = (deletedAt: string): string => {
    if (!deletedAt) return ''
    const config = useRuntimeConfig()
    const recycleDays = config.public.recycleDays || 30

    // 计算删除日期（只取日期部分，去除时间）
    const deleted = new Date(deletedAt)
    const deletedDate = new Date(deleted.getFullYear(), deleted.getMonth(), deleted.getDate())

    // 当前日期（只取日期部分，去除时间）
    const now = new Date()
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // 计算已经过去了多少整天
    const diffMs = nowDate.getTime() - deletedDate.getTime()
    const passedDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    // 剩余天数
    const remainingDays = Math.max(0, recycleDays - passedDays)

    if (remainingDays === 0) return '即将彻底删除'
    return `${remainingDays}天后彻底删除`
  }

  /**
   * 计算剩余天数
   */
  const getRemainingDays = (deletedAt: string): number => {
    if (!deletedAt) return 30
    const config = useRuntimeConfig()
    const recycleDays = config.public.recycleDays || 30
    const deleted = new Date(deletedAt)
    const now = new Date()
    const diffMs = now.getTime() - deleted.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    return Math.max(0, recycleDays - diffDays)
  }

  return {
    formatDocLocation,
    generateConflictName,
    checkNameConflict,
    fetchTrashDocuments,
    restoreDocument,
    formatDeletedAt,
    getRemainingDays
  }
}
