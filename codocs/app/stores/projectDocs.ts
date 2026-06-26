/**
 * Project Docs Store - 管理项目文档
 */
import { defineStore } from 'pinia'
import type { Project, GitlabSyncResponse, GitlabSubmitDoc, ConflictDoc, ResolvedDoc, GitlabSubmitResponse } from '~/types/account'
import type { ProjectFileItem } from '~/types/index'

interface ProjectDocsState {
  // 当前选中的项目
  selectedProject: Project | null
  selectedParentProjectCode: string | null

  // 文档列表
  documents: ProjectFileItem[]
  documentsLoading: boolean

  // 同步和提交状态
  syncing: boolean
  submitting: boolean
  resolving: boolean

  // 同步结果
  syncResult: GitlabSyncResponse | null
}

export const useProjectDocsStore = defineStore('projectDocs', {
  state: (): ProjectDocsState => ({
    selectedProject: null,
    selectedParentProjectCode: null,
    documents: [],
    documentsLoading: false,
    syncing: false,
    submitting: false,
    resolving: false,
    syncResult: null
  }),

  getters: {
    /**
     * 检查项目是否可以查看文档
     * - 叶子项目：需要配置 repoUrl 并已同步过
     * - 父项目：始终可以查看本地文档
     */
    canViewDocs: (state) => {
      if (!state.selectedProject) return false

      // 父项目（有子项目）：始终可以查看本地文档
      if (state.selectedProject.subProjects?.length) {
        return true
      }

      // 叶子项目：需要配置 GitLab 仓库并已同步
      const config = useRuntimeConfig()
      const gitlabBaseUrl = config.public.gitlabBaseUrl || 'http://gitlab.wiztek.cn'

      return !!(
        state.selectedProject.repoUrl
        && state.selectedProject.repoUrl.startsWith(gitlabBaseUrl)
        && state.selectedProject.docsSyncedAt
      )
    },

    /**
     * 获取OSS路径
     * - 父项目: codocs/projects/{project_code}/
     * - 叶子项目: {repo_path}/
     */
    ossPath: (state) => {
      if (!state.selectedProject) return ''

      // 父项目：使用本地 OSS 路径
      if (state.selectedProject.subProjects?.length) {
        return `codocs/projects/${state.selectedProject.projectCode}`
      }

      // 叶子项目：使用 GitLab 仓库路径
      if (!state.selectedProject.repoUrl) return ''

      const config = useRuntimeConfig()
      const gitlabBaseUrl = config.public.gitlabBaseUrl || 'http://gitlab.wiztek.cn'

      return state.selectedProject.repoUrl.replace(gitlabBaseUrl, '')
    },

    /**
     * 获取需要提交的文件（已修改但未提交的）
     * 判断依据：updated_at > committed_at
     */
    changedFiles: (state) => {
      const filterChanged = (items: ProjectFileItem[]): ProjectFileItem[] => {
        return items.filter((item) => {
          if (item.isDirectory && item.children) {
            const changedChildren = filterChanged(item.children)
            return changedChildren.length > 0
          }

          // 文件级别判断：updated_at > committed_at
          if (item.committedAt) {
            return new Date(item.lastModified) > new Date(item.committedAt)
          }

          // 如果没有 committed_at，说明从未提交过，所有文件都需要提交
          return true
        })
      }

      return filterChanged(state.documents)
    }
  },

  actions: {
    /**
     * 选择项目
     */
    selectProject(project: Project) {
      if (project.parentId) {
        this.selectedProject = project
        this.selectedParentProjectCode = project.parentId
      } else {
        this.selectedProject = null
        this.selectedParentProjectCode = null
      }
      this.documents = []
    },

    /**
     * 加载项目文档列表
     */
    async loadDocuments() {
      if (!this.selectedProject) {
        throw new Error('No project selected')
      }

      if (!this.canViewDocs) {
        throw new Error('未配置项目仓库地址或尚未进行项目文档同步')
      }

      this.documentsLoading = true
      try {
        const response = await $fetch<{ code: number, data: ProjectFileItem[] }>(
          `/api/project-docs/files/${this.selectedProject.projectCode}`
        )

        if (response.code === 0) {
          this.documents = response.data
        }

        return response.data
      } catch (error) {
        console.error('Failed to load documents:', error)
        throw error
      } finally {
        this.documentsLoading = false
      }
    },

    /**
     * 同步项目文档（从 GitLab 到 OSS）
     */
    async syncDocuments() {
      if (!this.selectedProject) {
        throw new Error('No project selected')
      }

      this.syncing = true
      try {
        console.log('[Store] Calling gitlab-sync API...')
        const response = await $fetch<{ code: number, message: string, data: GitlabSyncResponse }>(
          `/api/project-docs/gitlab-sync/${this.selectedProject.projectCode}`
        )

        if (response.code !== 0) {
          throw new Error(response.message || '同步失败')
        }

        if (!response.data) {
          throw new Error('API 返回数据为空')
        }

        this.syncResult = response.data

        // 同步完成后重新加载文档列表
        await this.loadDocuments()

        // 更新项目的 docsSyncedAt
        if (this.selectedProject) {
          this.selectedProject.docsSyncedAt = new Date().toISOString()
        }

        return response.data
      } catch (error) {
        console.error('Failed to sync documents:', error)
        throw error
      } finally {
        this.syncing = false
      }
    },

    /**
     * 解决冲突
     */
    async resolveConflicts(uid: string, docs: ConflictDoc[]) {
      if (!this.selectedProject) {
        throw new Error('No project selected')
      }

      this.resolving = true
      try {
        const response = await $fetch<{ code: number, data?: { docs: ResolvedDoc[] } }>(
          `/api/project-docs/resolve-conflicts/${this.selectedProject.projectCode}`,
          {
            method: 'POST',
            body: {
              uid,
              docs
            }
          }
        )

        if (response.code === 0) {
          // 解决冲突后重新加载文档列表（会刷新 content_size）
          await this.loadDocuments()

          // 清空同步结果中的冲突项
          if (this.syncResult) {
            this.syncResult.conflict = []
          }
        }

        return response
      } catch (error) {
        console.error('Failed to resolve conflicts:', error)
        throw error
      } finally {
        this.resolving = false
      }
    },

    /**
     * 提交项目文档（从 OSS 到 GitLab）
     */
    async submitDocuments(uid: string) {
      if (!this.selectedProject) {
        throw new Error('No project selected')
      }

      const changed = this.changedFiles
      if (changed.length === 0) {
        throw new Error('没有需要提交的文件')
      }

      // 将树形结构扁平化为文件列表
      const flattenFiles = (items: ProjectFileItem[]): ProjectFileItem[] => {
        const result: ProjectFileItem[] = []
        for (const item of items) {
          if (!item.isDirectory) {
            result.push(item)
          }
          if (item.children) {
            result.push(...flattenFiles(item.children))
          }
        }
        return result
      }

      const config = useRuntimeConfig()
      const gitlabBaseUrl = (config.public.gitlabBaseUrl as string) || 'http://gitlab.wiztek.cn'
      const repoPath = this.selectedProject.repoUrl?.replace(gitlabBaseUrl, '').replace(/^\/+/, '') || ''
      const prefix = `${repoPath}/`

      const docs: GitlabSubmitDoc[] = flattenFiles(changed).map(file => ({
        oss_path: file.path,
        gitlab_path: file.path.replace(prefix, '')
      }))

      this.submitting = true
      try {
        const response = await $fetch<{ code: number, data: GitlabSubmitResponse }>(
          `/api/project-docs/gitlab-submit/${this.selectedProject.projectCode}`,
          {
            method: 'POST',
            body: {
              uid,
              docs
            }
          }
        )

        if (response.code === 0) {
          // 提交成功后更新 docsCommittedAt 并重新加载文件列表
          if (this.selectedProject) {
            this.selectedProject.docsCommittedAt = new Date().toISOString()
            // 重新加载文件列表以清除修改状态
            await this.loadDocuments()
          }
        }

        return response.data
      } catch (error) {
        console.error('Failed to submit documents:', error)
        throw error
      } finally {
        this.submitting = false
      }
    },

    /**
     * 清除状态
     */
    clear() {
      this.selectedProject = null
      this.selectedParentProjectCode = null
      this.documents = []
      this.documentsLoading = false
      this.syncing = false
      this.submitting = false
      this.resolving = false
      this.syncResult = null
    }
  }
})
