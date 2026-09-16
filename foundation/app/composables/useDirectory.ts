/**
 * Console Directory Runtime composables.
 *
 * Returned shapes intentionally stay compatible with the legacy Account
 * types so existing application UI can migrate endpoint names gradually.
 */
import type {
  AccountUser,
  BusinessDomain,
  DepartmentResponse,
  Project,
  UserProjects,
  ApiResponse
} from '../types/account'

export function useDirectoryBusinessDomains() {
  const domains = ref<BusinessDomain[]>([])
  const loading = ref(false)

  async function fetchDomains() {
    loading.value = true
    try {
      const response = await $fetch<ApiResponse<BusinessDomain[]>>(
        '/api/directory/business-domains'
      )
      if (response.code === 0 && response.data) {
        domains.value = response.data
      }
    } catch (error) {
      console.error('Failed to fetch business domains:', error)
    } finally {
      loading.value = false
    }
  }

  onMounted(fetchDomains)

  return { domains, loading, refresh: fetchDomains }
}

export function useDirectoryUsers(params?: { search?: string, dept_code?: string, pageSize?: number }) {
  const users = ref<AccountUser[]>([])
  const loading = ref(false)

  async function fetchUsers() {
    loading.value = true
    try {
      const response = await $fetch<ApiResponse<{ items: AccountUser[], total: number } | AccountUser[]>>(
        '/api/directory/users',
        { params: { pageSize: 500, ...params } }
      )
      if (response.code === 0 && response.data) {
        const data = response.data
        users.value = Array.isArray(data) ? data : data.items || []
      }
    } catch (error) {
      console.error('Failed to fetch directory users:', error)
    } finally {
      loading.value = false
    }
  }

  onMounted(fetchUsers)

  return { users, loading, refresh: fetchUsers }
}

export function useDirectoryUser(uid: Ref<string | null | undefined> | string) {
  const user = ref<AccountUser | null>(null)
  const loading = ref(false)

  async function fetchUser() {
    const uidVal = unref(uid)
    if (!uidVal) return
    loading.value = true
    try {
      const response = await $fetch<ApiResponse<AccountUser>>(
        `/api/directory/users/${encodeURIComponent(uidVal)}`
      )
      if (response.code === 0 && response.data) {
        user.value = response.data
      }
    } catch (error) {
      console.error(`Failed to fetch directory user ${uidVal}:`, error)
    } finally {
      loading.value = false
    }
  }

  if (isRef(uid)) {
    watch(uid, () => fetchUser(), { immediate: true })
  } else {
    onMounted(fetchUser)
  }

  return { user, loading, refresh: fetchUser }
}

export function useDirectoryDepartments() {
  const departments = ref<DepartmentResponse | null>(null)
  const loading = ref(false)

  async function fetchDepartments() {
    loading.value = true
    try {
      const response = await $fetch<ApiResponse<DepartmentResponse>>(
        '/api/directory/departments'
      )
      if (response.code === 0 && response.data) {
        departments.value = response.data
      }
    } catch (error) {
      console.error('Failed to fetch directory departments:', error)
    } finally {
      loading.value = false
    }
  }

  onMounted(fetchDepartments)

  return {
    departments,
    loading,
    refresh: fetchDepartments,
    tree: computed(() => departments.value?.tree || []),
    flat: computed(() => departments.value?.flat || [])
  }
}

export function useDirectoryProjects(params?: { dept_code?: string, search?: string, only_group?: string }) {
  const projects = ref<Project[]>([])
  const loading = ref(false)

  async function fetchProjects() {
    loading.value = true
    try {
      const response = await $fetch<ApiResponse<{ items: Project[], total: number }>>(
        '/api/directory/projects',
        { params }
      )
      if (response.code === 0 && response.data) {
        projects.value = response.data.items
      }
    } catch (error) {
      console.error('Failed to fetch directory projects:', error)
    } finally {
      loading.value = false
    }
  }

  onMounted(fetchProjects)

  return { projects, loading, refresh: fetchProjects }
}

export function useDirectoryGitGroups() {
  const groups = ref<Project[]>([])
  const tree = ref<Project[]>([])
  const loading = ref(false)

  function flattenProjects(items: Project[]): Project[] {
    const result: Project[] = []
    for (const item of items) {
      result.push(item)
      if (item.subProjects?.length) {
        result.push(...flattenProjects(item.subProjects))
      }
    }
    return result
  }

  async function fetchGroups() {
    loading.value = true
    try {
      const response = await $fetch<ApiResponse<{ items: Project[], total: number }>>(
        '/api/directory/projects',
        { params: { only_group: 'true' } }
      )
      if (response.code === 0 && response.data) {
        tree.value = response.data.items
        groups.value = flattenProjects(response.data.items)
      }
    } catch (error) {
      console.error('Failed to fetch directory git groups:', error)
    } finally {
      loading.value = false
    }
  }

  onMounted(fetchGroups)

  return { groups, tree, loading, refresh: fetchGroups }
}

export function useDirectoryUserProjects(uid: Ref<string | null | undefined> | string) {
  const userProjects = ref<UserProjects | null>(null)
  const loading = ref(false)

  async function fetchUserProjects() {
    const uidVal = unref(uid)
    if (!uidVal) return
    loading.value = true
    try {
      const response = await $fetch<ApiResponse<UserProjects>>(
        `/api/directory/users/${encodeURIComponent(uidVal)}/projects`
      )
      if (response.code === 0 && response.data) {
        userProjects.value = response.data
      }
    } catch (error) {
      console.error(`Failed to fetch directory projects for ${uidVal}:`, error)
    } finally {
      loading.value = false
    }
  }

  if (isRef(uid)) {
    watch(uid, () => fetchUserProjects(), { immediate: true })
  } else {
    onMounted(fetchUserProjects)
  }

  return { userProjects, loading, refresh: fetchUserProjects }
}
