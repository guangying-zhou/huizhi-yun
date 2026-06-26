/**
 * Account Store - 统一管理从 Account 模块获取的部门、用户、项目信息等
 */
import { defineStore } from 'pinia'
import type {
  AccountUser,
  Department,
  DepartmentResponse,
  Project,
  UserProjects,
  GitlabSyncResponse,
  ConflictDoc,
  GitlabSubmitDoc,
  ApiResponse
} from '~/types/account'
import type { ProjectFileItem, ProjectDocsTreeItem } from '~/types/index'
import { resolveAvatarSrc } from '~/composables/useAvatar'

const normalizeAccountUser = (user: AccountUser): AccountUser => {
  const normalizedDeptCode = user.deptCode || user.department?.code
  const normalizedDeptName = user.deptName || user.department?.name

  return {
    ...user,
    deptCode: normalizedDeptCode,
    deptName: normalizedDeptName,
    avatar: resolveAvatarSrc(user.avatar) || null
  }
}

const USER_PROJECTS_CACHE_PREFIX = 'account:user-projects:'
const USER_PROJECTS_CACHE_VERSION = 'v2'

const getUserProjectsCacheKey = (uid: string) => `${USER_PROJECTS_CACHE_PREFIX}${USER_PROJECTS_CACHE_VERSION}:${uid}`

const getLegacyUserProjectsCacheKeys = (uid: string) => [
  `${USER_PROJECTS_CACHE_PREFIX}${uid}`
]

const readUserProjectsCache = (uid: string): UserProjects | null => {
  if (!import.meta.client || !uid) return null

  try {
    const raw = localStorage.getItem(getUserProjectsCacheKey(uid))
    if (!raw) {
      getLegacyUserProjectsCacheKeys(uid).forEach(key => localStorage.removeItem(key))
      return null
    }
    return JSON.parse(raw) as UserProjects
  } catch {
    return null
  }
}

const writeUserProjectsCache = (uid: string, data: UserProjects | null | undefined) => {
  if (!import.meta.client || !uid) return

  try {
    if (!data) {
      localStorage.removeItem(getUserProjectsCacheKey(uid))
      getLegacyUserProjectsCacheKeys(uid).forEach(key => localStorage.removeItem(key))
      return
    }
    localStorage.setItem(getUserProjectsCacheKey(uid), JSON.stringify(data))
    getLegacyUserProjectsCacheKeys(uid).forEach(key => localStorage.removeItem(key))
  } catch { /* ignore localStorage errors */ }
}

const clearUserProjectsCache = (uid?: string) => {
  if (!import.meta.client) return

  try {
    if (uid) {
      localStorage.removeItem(getUserProjectsCacheKey(uid))
      getLegacyUserProjectsCacheKeys(uid).forEach(key => localStorage.removeItem(key))
      return
    }

    const keysToRemove: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(USER_PROJECTS_CACHE_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))
  } catch { /* ignore localStorage errors */ }
}

const hasProjectDocsTree = (projects: Project[]): boolean => {
  return projects.every((project) => {
    const selfReady = Array.isArray(project.docsTree)
    const childrenReady = project.subProjects?.length ? hasProjectDocsTree(project.subProjects) : true
    return selfReady && childrenReady
  })
}

const hasUserProjectsDocsTree = (userProjects: UserProjects | null | undefined): boolean => {
  if (!userProjects) return false
  return hasProjectDocsTree(userProjects.managed || []) && hasProjectDocsTree(userProjects.joined || [])
}

interface AccountState {
  // 用户信息
  users: Map<string, AccountUser>
  usersLoading: boolean

  // 部门信息
  departments: DepartmentResponse | null
  departmentsLoading: boolean

  // 项目信息
  projects: Map<string, Project>
  projectsLoading: boolean
  selectedProject: Project | null
  selectedProjectDoc: ProjectFileItem | null
  selectedGroup: ProjectDocsTreeItem | null
  // 用户项目映射
  userProjects: Map<string, UserProjects>

  // 文档加载状态
  loadingProjects: Set<string>
  docsLoading: boolean

  syncing: boolean
  resolving: boolean
  submitting: boolean
  syncResult: GitlabSyncResponse | null
}

export const useAccountStore = defineStore('account', {
  state: (): AccountState => ({
    users: new Map(),
    usersLoading: false,

    departments: null,
    departmentsLoading: false,

    projects: new Map(),
    projectsLoading: false,
    selectedProject: null,
    selectedGroup: null,
    selectedProjectDoc: null,
    userProjects: new Map(),

    loadingProjects: new Set(),
    docsLoading: false,

    syncing: false,
    resolving: false,
    submitting: false,
    syncResult: null
  }),

  getters: {
    /**
     * Check if a specific project is loading documents
     */
    isProjectLoading: state => (projectCode: string): boolean => {
      return state.loadingProjects.has(projectCode)
    },

    /**
     * 获取所有用户列表
     */
    allUsers: (state): AccountUser[] => {
      return Array.from(state.users.values())
    },

    /**
     * 根据用户名获取用户
     */
    getUserByUid: state => (uid: string): AccountUser | undefined => {
      return state.users.get(uid)
    },

    /**
     * 获取部门树形结构
     */
    departmentTree: (state): Department[] => {
      return state.departments?.tree || []
    },

    /**
     * 获取部门扁平列表
     */
    departmentFlat: (state): Department[] => {
      return state.departments?.flat || []
    },

    /**
     * 根据部门ID获取部门
     */
    getDepartmentById: state => (deptCode: string): Department | undefined => {
      return state.departments?.flat.find(dept => dept.deptCode === deptCode)
    },

    /**
     * 获取所有项目列表
     */
    allProjects: (state): Project[] => {
      return Array.from(state.projects.values())
    },

    /**
     * 根据项目ID获取项目
     */
    getProjectById: state => (projectCode: string): Project | undefined => {
      return state.projects.get(projectCode)
    },

    /**
     * 获取用户的所有项目
     * @param state
     * @returns
     */
    getUserProjects: state => (uid: string): UserProjects | undefined => {
      return state.userProjects.get(uid)
    },

    /**
     * 获取当前选中的项目
     */
    getSelectedProject: state => (): Project | null => {
      return state.selectedProject
    },

    /**
     * 获取当前选中的文档
     */
    getSelectedDocument: state => (): ProjectFileItem | null => {
      return state.selectedProjectDoc
    },

    /**
     * 获取需要提交的文件数量（已修改但未提交的）
     * 判断依据：updated_at > committed_at
     */
    getChangedFiles: (state) => {
      if (!state.selectedProject) {
        return []
      }
      if (!state.selectedProject.documents) {
        return []
      }
      const docs: ProjectFileItem[] = state.selectedProject.documents

      for (const doc of docs) {
        if (doc.isModified) {
          doc.isModified = 1
        }
      }

      return state.selectedProject.documents.filter((doc: ProjectFileItem) => doc.isModified)
    }

  },

  actions: {

    /**
     * 选择文档
     */
    async selectDocument(doc: ProjectFileItem) {
      this.selectedProjectDoc = doc
    },
    /**
     * 获取用户列表
     */
    async fetchUsers(params?: { search?: string, dept_code?: string }) {
      this.usersLoading = true
      try {
        const response = await $fetch<ApiResponse<{
          items: AccountUser[]
          tree: Record<string, unknown>[]
        }>>('/api/account/users', {
          params
        })

        if (response.code === 0 && response.data) {
          // 更新用户缓存
          response.data.items.forEach((user) => {
            const normalized = normalizeAccountUser(user)
            this.users.set(normalized.uid, normalized)
          })
        }

        return response.data
      } catch (error) {
        console.error('Failed to fetch users:', error)
        throw error
      } finally {
        this.usersLoading = false
      }
    },

    /**
     * 获取单个用户详情
     */
    async fetchUser(uid: string, force = false) {
      // 如果缓存中存在且不强制刷新，直接返回
      if (!force && this.users.has(uid)) {
        return this.users.get(uid)
      }

      try {
        const response = await $fetch<ApiResponse<AccountUser>>(
          `/api/account/users/${encodeURIComponent(uid)}`
        )

        if (response.code === 0 && response.data) {
          const normalized = normalizeAccountUser(response.data)
          this.users.set(uid, normalized)
          return normalized
        }

        return null
      } catch (error) {
        console.error(`Failed to fetch user ${uid}:`, error)
        throw error
      }
    },

    /**
     * 批量获取用户
     */
    async fetchUsersBatch(uids: string[]) {
      // 过滤掉已缓存的用户
      const uncachedUids = uids.filter(uid => !this.users.has(uid))

      if (uncachedUids.length === 0) {
        return uids.map(uid => this.users.get(uid)).filter(Boolean) as AccountUser[]
      }

      try {
        const response = await $fetch<ApiResponse<AccountUser[]>>(
          '/api/account/users/batch',
          {
            method: 'POST',
            body: { uids: uncachedUids }
          }
        )

        if (response.code === 0 && response.data) {
          response.data.forEach((user) => {
            const normalized = normalizeAccountUser(user)
            this.users.set(normalized.uid, normalized)
          })
        }

        return uids.map(uid => this.users.get(uid)).filter(Boolean) as AccountUser[]
      } catch (error) {
        console.error('Failed to batch fetch users:', error)
        throw error
      }
    },

    /**
     * 获取部门列表
     */
    async fetchDepartments(force = false) {
      // 如果已缓存且不强制刷新，直接返回
      if (!force && this.departments) {
        return this.departments
      }

      this.departmentsLoading = true
      try {
        const response = await $fetch<ApiResponse<DepartmentResponse>>(
          '/api/account/departments'
        )

        if (response.code === 0 && response.data) {
          this.departments = response.data
          return response.data
        }

        return null
      } catch (error) {
        console.error('Failed to fetch departments:', error)
        throw error
      } finally {
        this.departmentsLoading = false
      }
    },

    /**
     * 获取项目列表
     */
    async fetchProjects(params?: {
      dept_code?: string
      leader_uid?: string
      search?: string
      status?: number
      only_group?: string
      onlyGroup?: string
      include_template?: string
      includeTemplate?: string
    }) {
      this.projectsLoading = true
      try {
        const response = await $fetch<ApiResponse<{
          items: Project[]
          total: number
        }>>('/api/account/projects', {
          params
        })

        if (response.code === 0 && response.data) {
          // 递归展平项目树以更新缓存
          const flattenProjects = (projects: Project[]) => {
            projects.forEach((project: Project) => {
              // Preserve isExpanded state if project already exists
              const existingProject = this.projects.get(project.projectCode)
              if (existingProject && existingProject.isExpanded) {
                project.isExpanded = true
              }

              this.projects.set(project.projectCode, project)
              if (project.subProjects?.length) {
                flattenProjects(project.subProjects)
              }
            })
          }
          flattenProjects(response.data.items)
          return response.data
        }

        return null
      } catch (error) {
        console.error('Failed to fetch projects:', error)
        throw error
      } finally {
        this.projectsLoading = false
      }
    },

    /**
     * 切换项目展开状态；展开叶子代码库时若未加载过文档则按需加载
     */
    async toggleProject(project: Project) {
      const findAndToggle = async (projects: Project[]) => {
        for (const p of projects) {
          if (p.projectCode === project.projectCode) {
            const willExpand = !p.isExpanded
            p.isExpanded = willExpand

            if (willExpand) {
              const isGitLabProject = !!(p.repoUrl && p.docsSyncedAt)
              if (!p.documents && (!p.isGroup || isGitLabProject)) {
                p.docsLoading = true
                try {
                  await this.loadDocuments(p)
                } finally {
                  p.docsLoading = false
                }
              }
            }
            return true
          }

          if (p.subProjects && p.subProjects.length > 0) {
            if (await findAndToggle(p.subProjects)) {
              return true
            }
          }
        }
        return false
      }

      for (const userProject of this.userProjects.values()) {
        if (userProject.managed && await findAndToggle(userProject.managed)) return
        if (userProject.joined && await findAndToggle(userProject.joined)) return
      }
    },

    /**
       * 加载项目文档列表
       * 通过 isGroup 参数告知后端是父项目还是叶子项目
       */
    async loadDocuments(project: Project) {
      if (!project) {
        throw new Error('No project selected')
      }
      // 代码库项目在 Directory 运行时中没有 docsSyncedAt，不能用该字段阻断读取。
      // 父项目只有在历史同步标记存在时才按 GitLab 项目处理。
      const isGitLabProject = !!(project.repoUrl && (!project.isGroup || project.docsSyncedAt))
      if (project.isGroup && !isGitLabProject) {
        return
      }

      if (!project.repoUrl || (project.isGroup && !project.docsSyncedAt)) {
        throw new Error('未配置项目仓库地址或尚未进行项目文档同步')
      }

      let docs: ProjectFileItem[] = []
      try {
        const response = await $fetch<{ code: number, data: ProjectFileItem[] }>(
          `/api/project-docs/files/${project.projectCode}`
        )
        console.log('loadDocuments', response.data)

        if (response.code === 0) {
          docs = response.data
        }
      } catch (error) {
        console.error('Failed to load documents:', error)
        throw error
      }

      project.documents = docs
    },

    /**
     * 选择项目并展开
     */
    async selectProject(project: Project) {
      this.selectedProject = project
      const findAndToggle = async (projects: Project[]) => {
        for (const p of projects) {
          if (p.projectCode === project.projectCode) {
            p.docsLoading = true
            p.isExpanded = true
            const isGitLabProject = !!(p.repoUrl && p.docsSyncedAt)
            if (!p.documents && (!p.isGroup || isGitLabProject)) {
              try {
                await this.loadDocuments(p)
              } finally {
                p.docsLoading = false
              }
            }
            p.docsLoading = false
            return true
          }

          if (p.subProjects && p.subProjects.length > 0) {
            if (await findAndToggle(p.subProjects)) {
              return true
            }
          }
        }
        return false
      }

      for (const userProject of this.userProjects.values()) {
        if (userProject.managed && await findAndToggle(userProject.managed)) return
        if (userProject.joined && await findAndToggle(userProject.joined)) return
      }
    },

    /**
     * 获取单个项目详情
     */
    async fetchProject(projectCode: string, force = false) {
      // 如果缓存中存在且不强制刷新，直接返回
      if (!force && this.projects.has(projectCode)) {
        return this.projects.get(projectCode)
      }

      try {
        const response = await $fetch<ApiResponse<Project>>(
          `/api/account/projects/${encodeURIComponent(projectCode)}`
        )

        if (response.code === 0 && response.data) {
          this.projects.set(projectCode, response.data)
          return response.data
        }

        return null
      } catch (error) {
        console.error(`Failed to fetch project ${projectCode}:`, error)
        throw error
      }
    },

    /**
     * 获取用户的项目
     */
    async fetchUserProjects(uid: string, force = false) {
      // 如果缓存中存在且不强制刷新，直接返回
      if (!force && this.userProjects.has(uid)) {
        return this.userProjects.get(uid)
      }

      if (!force && !this.userProjects.has(uid)) {
        const cachedProjects = readUserProjectsCache(uid)
        if (cachedProjects) {
          this.userProjects.set(uid, cachedProjects)
          return cachedProjects
        }
      }

      try {
        const response = await $fetch<ApiResponse<UserProjects>>(
          `/api/account/users/${encodeURIComponent(uid)}/projects`
        )

        if (response.code === 0 && response.data) {
          this.userProjects.set(uid, response.data)
          writeUserProjectsCache(uid, response.data)
          return response.data
        }

        return null
      } catch (error) {
        console.error(`Failed to fetch projects for user ${uid}:`, error)
        throw error
      }
    },

    buildTreeItems(folders: ProjectDocsTreeItem[], documents: ProjectDocsTreeItem[], parentId: number | null) {
      const items: ProjectDocsTreeItem[] = []

      // 1. 添加子文件夹
      folders.forEach((folder: ProjectDocsTreeItem) => {
        if (folder.parentId !== parentId) {
          return
        }
        items.push({
          type: 'folder',
          id: folder.id,
          nodeId: folder.nodeId,
          parentId: parentId || undefined,
          name: folder.name,
          data: folder as unknown as Record<string, unknown>,
          children: this.buildTreeItems(folders, documents, folder.id as number)
        })
      })

      // 2. 添加该文件夹下的文档
      const docs = documents.filter((d: ProjectDocsTreeItem) => d.parentId === parentId)
      docs.forEach((doc: ProjectDocsTreeItem) => {
        items.push({
          type: 'document',
          id: doc.id,
          uuid: doc.uuid,
          nodeId: doc.nodeId,
          parentId: parentId || undefined,
          name: doc.name,
          data: doc as unknown as Record<string, unknown>
        })
      })

      return items
    },

    async fetchUserProjectsDocsTree(uid: string, force = false) {
      // 递归添加项目文档树
      const addProjectDocsTree = async (projects: Project[]) => {
        for (const p of projects) {
          // 加载该项目的文件夹和文档
          let projectFolders: ProjectDocsTreeItem[] = [], projectDocs: ProjectDocsTreeItem[] = []
          try {
            const response = await $fetch<ApiResponse<ProjectDocsTreeItem[]>>(
              `/api/folders/list/${encodeURIComponent(p.projectCode)}`
            )
            if (response.success && response.data) {
              projectFolders = response.data
            }
          } catch (error) {
            console.error(`Failed to fetch projects for user ${uid}:`, error)
            throw error
          }

          try {
            const response = await $fetch<ApiResponse<ProjectDocsTreeItem[]>>(
              `/api/documents/project/${encodeURIComponent(p.projectCode)}`
            )
            if (response.success && response.data) {
              projectDocs = response.data
            }
          } catch (error) {
            console.error(`Failed to fetch projects for user ${uid}:`, error)
            throw error
          }
          const projectDocsTree = this.buildTreeItems(projectFolders, projectDocs, null)
          p.docsTree = projectDocsTree

          if (p.subProjects && p.subProjects?.length > 0) {
            if (await addProjectDocsTree(p.subProjects)) {
              return true
            }
          }
        }
        return false
      }

      let managedProjects = null, joinedProjects = null
      this.docsLoading = true
      if (!this.userProjects.has(uid) || force) {
        await this.fetchUserProjects(uid, force)
      }
      const userProjects = this.userProjects.get(uid)

      if (!force && hasUserProjectsDocsTree(userProjects)) {
        this.docsLoading = false
        return userProjects
      }

      if (userProjects) {
        managedProjects = userProjects.managed
        joinedProjects = userProjects.joined
      }

      if (managedProjects) {
        await addProjectDocsTree(managedProjects)
      }
      if (joinedProjects) {
        await addProjectDocsTree(joinedProjects)
      }

      this.docsLoading = false
      if (userProjects) {
        writeUserProjectsCache(uid, userProjects)
      }
      return userProjects
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

        console.log('[Store] API Response:', response)

        if (response.code !== 0) {
          throw new Error(response.message || '同步失败')
        }

        if (!response.data) {
          throw new Error('API 返回数据为空')
        }

        this.syncResult = response.data

        // 更新项目的 docsSyncedAt（必须在 loadDocuments 之前，否则守卫条件会阻止加载）
        if (this.selectedProject) {
          this.selectedProject.docsSyncedAt = new Date().toISOString()
        }

        // 同步完成后重新加载文档列表
        await this.loadDocuments(this.selectedProject)

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
        const response = await $fetch<{ code: number, data?: { docs: Record<string, unknown>[] } }>(
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
          console.log('[Store] Conflicts resolved, reloading documents...')
          console.log('[Store] Response data:', response.data)

          // 解决冲突后重新加载文档列表（会刷新 content_size）
          await this.loadDocuments(this.selectedProject)

          // 清空同步结果中的冲突和删除项
          if (this.syncResult) {
            this.syncResult.conflict = []
            this.syncResult.deleted = []
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

      const changed = this.getChangedFiles
      if (changed.length <= 0) {
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
      const gitlabBaseUrl = config.public.gitlabBaseUrl || 'http://gitlab.wiztek.cn'
      const repoPath = this.selectedProject.repoUrl?.replace(gitlabBaseUrl, '').replace(/^\/+/, '') || ''
      const prefix = `${repoPath}/`

      const docs: GitlabSubmitDoc[] = flattenFiles(changed).map(file => ({
        oss_path: file.path,
        gitlab_path: file.path.replace(prefix, '')
      }))

      this.submitting = true
      try {
        const response = await $fetch<{ code: number, data: Record<string, unknown> }>(
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
            await this.loadDocuments(this.selectedProject)
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
     * 清除用户缓存
     */
    clearUserCache(uid?: string) {
      if (uid) {
        this.users.delete(uid)
        this.userProjects.delete(uid)
        clearUserProjectsCache(uid)
      } else {
        this.users.clear()
        this.userProjects.clear()
        clearUserProjectsCache()
      }
    },

    /**
     * 清除部门缓存
     */
    clearDepartmentCache() {
      this.departments = null
    },

    /**
     * 清除项目缓存
     */
    clearProjectCache(projectCode?: string) {
      if (projectCode) {
        this.projects.delete(projectCode)
      } else {
        this.projects.clear()
      }
    },

    /**
     * 清除所有缓存
     */
    clearAllCache() {
      this.clearUserCache()
      this.clearDepartmentCache()
      this.clearProjectCache()
    }
  }
})
