/**
 * Directory Store - 统一管理从 Console Directory Runtime 获取的用户、部门、项目信息。
 */
import { defineStore } from 'pinia'
import type {
  AccountUser,
  Department,
  DepartmentResponse,
  Project,
  UserProjects,
  ApiResponse
} from '../types/account'

const normalizeDirectoryUser = (user: AccountUser): AccountUser => {
  return {
    ...user,
    avatar: resolveAvatarSrc(user.avatar) || null
  }
}

interface DirectoryState {
  users: Map<string, AccountUser>
  usersLoading: boolean
  departments: DepartmentResponse | null
  departmentsLoading: boolean
  projects: Map<string, Project>
  projectsLoading: boolean
  userProjects: Map<string, UserProjects>
}

export const useDirectoryStore = defineStore('directory', {
  state: (): DirectoryState => ({
    users: new Map(),
    usersLoading: false,
    departments: null,
    departmentsLoading: false,
    projects: new Map(),
    projectsLoading: false,
    userProjects: new Map()
  }),

  getters: {
    allUsers: (state): AccountUser[] => {
      return Array.from(state.users.values())
    },
    getUserByUid: state => (uid: string): AccountUser | undefined => {
      return state.users.get(uid)
    },
    departmentTree: (state): Department[] => {
      return state.departments?.tree || []
    },
    departmentFlat: (state): Department[] => {
      return state.departments?.flat || []
    },
    getDepartmentById: state => (deptCode: string): Department | undefined => {
      return state.departments?.flat.find((dept: Department) => dept.deptCode === deptCode)
    },
    allProjects: (state): Project[] => {
      return Array.from(state.projects.values())
    },
    getProjectById: state => (projectCode: string): Project | undefined => {
      return state.projects.get(projectCode)
    },
    getUserProjects: state => (uid: string): UserProjects | undefined => {
      return state.userProjects.get(uid)
    }
  },

  actions: {
    async fetchUsers(params?: { search?: string, dept_code?: string, pageSize?: number }) {
      this.usersLoading = true
      try {
        const response = await $fetch<ApiResponse<{
          items: AccountUser[]
          tree: unknown[]
        }>>('/api/directory/users', { params })

        if (response.code === 0 && response.data) {
          response.data.items.forEach((user: AccountUser) => {
            const normalized = normalizeDirectoryUser(user)
            this.users.set(normalized.uid, normalized)
          })
        }
        return response.data
      } catch (error) {
        console.error('Failed to fetch directory users:', error)
        throw error
      } finally {
        this.usersLoading = false
      }
    },

    async fetchUser(uid: string, force = false) {
      if (!force && this.users.has(uid)) {
        return this.users.get(uid)
      }

      try {
        const response = await $fetch<ApiResponse<AccountUser>>(
          `/api/directory/users/${encodeURIComponent(uid)}`
        )
        if (response.code === 0 && response.data) {
          const normalized = normalizeDirectoryUser(response.data)
          this.users.set(uid, normalized)
          return normalized
        }
        return null
      } catch (error) {
        console.error(`Failed to fetch directory user ${uid}:`, error)
        throw error
      }
    },

    async fetchUsersBatch(uids: string[]) {
      const uncachedUids = uids.filter(uid => !this.users.has(uid))
      if (uncachedUids.length === 0) {
        return uids.map(uid => this.users.get(uid)).filter(Boolean) as AccountUser[]
      }

      try {
        const response = await $fetch<ApiResponse<AccountUser[]>>(
          '/api/directory/users/batch',
          { method: 'POST', body: { uids: uncachedUids } }
        )
        if (response.code === 0 && response.data) {
          response.data.forEach((user: AccountUser) => {
            const normalized = normalizeDirectoryUser(user)
            this.users.set(normalized.uid, normalized)
          })
        }
        return uids.map(uid => this.users.get(uid)).filter(Boolean) as AccountUser[]
      } catch (error) {
        console.error('Failed to batch fetch directory users:', error)
        throw error
      }
    },

    async fetchDepartments(force = false) {
      if (!force && this.departments) return this.departments

      this.departmentsLoading = true
      try {
        const response = await $fetch<ApiResponse<DepartmentResponse>>(
          '/api/directory/departments'
        )
        if (response.code === 0 && response.data) {
          this.departments = response.data
          return response.data
        }
        return null
      } catch (error) {
        console.error('Failed to fetch directory departments:', error)
        throw error
      } finally {
        this.departmentsLoading = false
      }
    },

    async fetchProjects(params?: {
      dept_code?: string
      leader_uid?: string
      search?: string
      status?: number
      only_group?: string
    }) {
      this.projectsLoading = true
      try {
        const response = await $fetch<ApiResponse<{
          items: Project[]
          total: number
        }>>('/api/directory/projects', { params })

        if (response.code === 0 && response.data) {
          const flattenProjects = (projects: Project[]) => {
            projects.forEach((project: Project) => {
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
        console.error('Failed to fetch directory projects:', error)
        throw error
      } finally {
        this.projectsLoading = false
      }
    },

    async fetchUserProjects(uid: string, force = false) {
      if (!force && this.userProjects.has(uid)) {
        return this.userProjects.get(uid)
      }

      try {
        const response = await $fetch<ApiResponse<UserProjects>>(
          `/api/directory/users/${encodeURIComponent(uid)}/projects`
        )
        if (response.code === 0 && response.data) {
          this.userProjects.set(uid, response.data)
          return response.data
        }
        return null
      } catch (error) {
        console.error(`Failed to fetch directory projects for user ${uid}:`, error)
        throw error
      }
    },

    clearUserCache(uid?: string) {
      if (uid) {
        this.users.delete(uid)
        this.userProjects.delete(uid)
      } else {
        this.users.clear()
        this.userProjects.clear()
      }
    },

    clearDepartmentCache() {
      this.departments = null
    },

    clearProjectCache(projectCode?: string) {
      if (projectCode) {
        this.projects.delete(projectCode)
      } else {
        this.projects.clear()
      }
    },

    clearAllCache() {
      this.clearUserCache()
      this.clearDepartmentCache()
      this.clearProjectCache()
    }
  }
})
