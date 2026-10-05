/**
 * useAccount Composable - 简化 Account Store 的使用
 */
import { useAccountStore } from '~/stores/account'
import type { AccountUser, Department } from '~/types/account'

/**
 * 获取单个用户信息的 composable
 */
export function useAccountUser(uid: Ref<string> | string) {
  const accountStore = useAccountStore()
  const uidRef = isRef(uid) ? uid : ref(uid)

  const user = computed(() => accountStore.getUserByUid(uidRef.value))
  const loading = ref(false)
  const error = ref<Error | null>(null)

  const load = async (force = false) => {
    if (!uidRef.value) return

    loading.value = true
    error.value = null

    try {
      await accountStore.fetchUser(uidRef.value, force)
    } catch (e) {
      error.value = e as Error
    } finally {
      loading.value = false
    }
  }

  // 监听 uid 变化自动加载
  watch(uidRef, (newUid) => {
    if (newUid && !accountStore.getUserByUid(newUid)) {
      load()
    }
  }, { immediate: true })

  return {
    user,
    loading,
    error,
    reload: () => load(true)
  }
}

/**
 * 批量获取用户信息的 composable
 */
export function useAccountUsers(uids: Ref<string[]> | string[]) {
  const accountStore = useAccountStore()
  const uidsRef = isRef(uids) ? uids : ref(uids)

  const users = computed(() =>
    uidsRef.value
      .map(uid => accountStore.getUserByUid(uid))
      .filter((user): user is AccountUser => user !== undefined)
  )

  const loading = ref(false)
  const error = ref<Error | null>(null)

  const load = async () => {
    if (!uidsRef.value.length) return

    loading.value = true
    error.value = null

    try {
      await accountStore.fetchUsersBatch(uidsRef.value)
    } catch (e) {
      error.value = e as Error
    } finally {
      loading.value = false
    }
  }

  // 监听 uids 变化自动加载
  watch(uidsRef, (newUids) => {
    if (newUids.length > 0) {
      load()
    }
  }, { immediate: true, deep: true })

  return {
    users,
    loading,
    error,
    reload: load
  }
}

/**
 * 获取部门信息的 composable
 */
export function useAccountDepartments() {
  const accountStore = useAccountStore()

  const departments = computed(() => accountStore.departmentTree)
  const departmentsFlat = computed(() => accountStore.departmentFlat)
  const loading = computed(() => accountStore.departmentsLoading)
  const error = ref<Error | null>(null)

  const load = async (force = false) => {
    error.value = null

    try {
      await accountStore.fetchDepartments(force)
    } catch (e) {
      error.value = e as Error
    }
  }

  // 如果没有数据，自动加载
  onMounted(() => {
    if (!accountStore.departments) {
      load()
    }
  })

  const getDepartment = (deptCode: string): Department | undefined => {
    return accountStore.getDepartmentById(deptCode)
  }

  return {
    departments,
    departmentsFlat,
    loading,
    error,
    reload: () => load(true),
    getDepartment
  }
}

/**
 * 获取项目信息的 composable
 */
export function useAccountProject(projectCode: Ref<string> | string) {
  const accountStore = useAccountStore()
  const projectCodeRef = isRef(projectCode) ? projectCode : ref(projectCode)

  const project = computed(() => accountStore.getProjectById(projectCodeRef.value))
  const loading = ref(false)
  const error = ref<Error | null>(null)

  const load = async (force = false) => {
    if (!projectCodeRef.value) return

    loading.value = true
    error.value = null

    try {
      await accountStore.fetchProject(projectCodeRef.value, force)
    } catch (e) {
      error.value = e as Error
    } finally {
      loading.value = false
    }
  }

  // 监听 projectCode 变化自动加载
  watch(projectCodeRef, (newProjectCode) => {
    if (newProjectCode && !accountStore.getProjectById(newProjectCode)) {
      load()
    }
  }, { immediate: true })

  return {
    project,
    loading,
    error,
    reload: () => load(true)
  }
}

/**
 * 获取用户项目的 composable
 */
export function useAccountUserProjects(uid: Ref<string> | string) {
  const accountStore = useAccountStore()
  const uidRef = isRef(uid) ? uid : ref(uid)

  const userProjects = computed(() => accountStore.getUserProjects(uidRef.value))
  const managedProjects = computed(() => userProjects.value?.managed || [])
  const joinedProjects = computed(() => userProjects.value?.joined || [])
  const loading = ref(false)
  const error = ref<Error | null>(null)

  const load = async (force = false) => {
    if (!uidRef.value) return

    loading.value = true
    error.value = null

    try {
      await accountStore.fetchUserProjects(uidRef.value, force)
    } catch (e) {
      error.value = e as Error
    } finally {
      loading.value = false
    }
  }

  // 监听 uid 变化自动加载
  watch(uidRef, (newUid) => {
    if (newUid && !accountStore.getUserProjects(newUid)) {
      load()
    }
  }, { immediate: true })

  return {
    userProjects,
    managedProjects,
    joinedProjects,
    loading,
    error,
    reload: () => load(true)
  }
}

/**
 * 搜索用户的 composable
 */
export function useAccountUserSearch() {
  const accountStore = useAccountStore()

  const searchKeyword = ref('')
  const deptCode = ref<string>()
  const users = computed(() => accountStore.allUsers)
  const loading = computed(() => accountStore.usersLoading)
  const error = ref<Error | null>(null)

  const search = async () => {
    error.value = null

    try {
      await accountStore.fetchUsers({
        search: searchKeyword.value || undefined,
        dept_code: deptCode.value
      })
    } catch (e) {
      error.value = e as Error
    }
  }

  // 防抖搜索
  const debouncedSearch = useDebounceFn(search, 500)

  watch([searchKeyword, deptCode], () => {
    debouncedSearch()
  })

  // 初始加载
  onMounted(() => {
    if (accountStore.allUsers.length === 0) {
      search()
    }
  })

  return {
    searchKeyword,
    deptCode,
    users,
    loading,
    error,
    search
  }
}

/**
 * 搜索项目的 composable
 */
export function useAccountProjectSearch() {
  const accountStore = useAccountStore()

  const searchKeyword = ref('')
  const deptCode = ref<string>()
  const leaderUid = ref<string>()
  const status = ref<number>(1)
  const git_projects = computed(() => accountStore.allProjects)
  const loading = computed(() => accountStore.projectsLoading)
  const error = ref<Error | null>(null)

  const search = async () => {
    error.value = null

    try {
      await accountStore.fetchProjects({
        search: searchKeyword.value || undefined,
        dept_code: deptCode.value,
        leader_uid: leaderUid.value,
        status: status.value
      })
    } catch (e) {
      error.value = e as Error
    }
  }

  // 防抖搜索
  const debouncedSearch = useDebounceFn(search, 500)

  watch([searchKeyword, deptCode, leaderUid, status], () => {
    debouncedSearch()
  })

  // 初始加载
  onMounted(() => {
    if (accountStore.allProjects.length === 0) {
      search()
    }
  })

  return {
    searchKeyword,
    deptCode,
    leaderUid,
    status,
    git_projects,
    loading,
    error,
    search
  }
}
