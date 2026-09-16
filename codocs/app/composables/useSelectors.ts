/**
 * 用户选择 Composable
 * 简化用户选择功能的使用
 */
import { useAccountStore } from '~/stores/account'
import type { AccountUser } from '~/types/account'

/**
 * 用户选择器
 */
export function useUserSelector() {
  const accountStore = useAccountStore()
  const loading = ref(false)
  const error = ref<Error | null>(null)

  // 所有用户列表
  const users = computed(() => accountStore.allUsers)

  // 加载用户列表
  const loadUsers = async (force = false) => {
    if (!force && users.value.length > 0) {
      return // 已有缓存，不重复加载
    }

    loading.value = true
    error.value = null

    try {
      await accountStore.fetchUsers()
    } catch (e) {
      error.value = e as Error
      console.error('Failed to load users:', e)
    } finally {
      loading.value = false
    }
  }

  // 根据用户名获取用户
  const getUserByUid = (uid: string): AccountUser | undefined => {
    return accountStore.getUserByUid(uid)
  }

  // 批量获取用户
  const getUsersByUids = (uids: string[]): AccountUser[] => {
    return uids
      .map(uid => accountStore.getUserByUid(uid))
      .filter((user): user is AccountUser => user !== undefined)
  }

  // 搜索用户
  const searchUsers = async (keyword: string, deptCode?: string) => {
    loading.value = true
    error.value = null

    try {
      await accountStore.fetchUsers({
        search: keyword || undefined,
        dept_code: deptCode
      })
    } catch (e) {
      error.value = e as Error
    } finally {
      loading.value = false
    }
  }

  return {
    users,
    loading,
    error,
    loadUsers,
    getUserByUid,
    getUsersByUids,
    searchUsers
  }
}

/**
 * 部门选择器
 */
export function useDepartmentSelector() {
  const accountStore = useAccountStore()
  const loading = ref(false)
  const error = ref<Error | null>(null)

  // 部门树形结构
  const departmentTree = computed(() => accountStore.departmentTree)

  // 部门扁平列表
  const departmentFlat = computed(() => accountStore.departmentFlat)

  // 加载部门列表
  const loadDepartments = async (force = false) => {
    if (!force && departmentFlat.value.length > 0) {
      return // 已有缓存
    }

    loading.value = true
    error.value = null

    try {
      await accountStore.fetchDepartments()
    } catch (e) {
      error.value = e as Error
      console.error('Failed to load departments:', e)
    } finally {
      loading.value = false
    }
  }

  // 根据ID获取部门
  const getDepartmentById = (deptCode: string) => {
    return accountStore.getDepartmentById(deptCode)
  }

  return {
    departmentTree,
    departmentFlat,
    loading,
    error,
    loadDepartments,
    getDepartmentById
  }
}

/**
 * 项目选择器
 */
export function useProjectSelector() {
  const accountStore = useAccountStore()
  const loading = ref(false)
  const error = ref<Error | null>(null)

  // 所有项目列表
  const git_projects = computed(() => accountStore.allProjects)

  // 加载项目列表
  const loadProjects = async (params?: {
    search?: string
    dept_code?: string
    leader_uid?: string
    status?: number
  }) => {
    loading.value = true
    error.value = null

    try {
      await accountStore.fetchProjects(params)
    } catch (e) {
      error.value = e as Error
      console.error('Failed to load git_projects:', e)
    } finally {
      loading.value = false
    }
  }

  // 根据ID获取项目
  const getProjectById = (projectCode: string) => {
    return accountStore.getProjectById(projectCode)
  }

  // 获取用户的项目
  const loadUserProjects = async (uid: string, force = false) => {
    loading.value = true
    error.value = null

    try {
      await accountStore.fetchUserProjects(uid, force)
      return accountStore.getUserProjects(uid)
    } catch (e) {
      error.value = e as Error
      console.error('Failed to load user git_projects:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    git_projects,
    loading,
    error,
    loadProjects,
    getProjectById,
    loadUserProjects
  }
}
