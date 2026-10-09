import { sharedApiPath } from '../utils/sharedApiPath'
import type { Department } from '../types/account'
import { isReservedDirectorySubject, UNASSIGNED_OWNER_LABEL, UNASSIGNED_OWNER_UID } from '../../shared/utils/reservedDirectorySubject'

/** Read only Foundation directory; caches are confined to the current Host identity. */
export function useHostDirectoryLabels(uids: Ref<string[]>, enabled?: Ref<boolean>) {
  const scope = useState<string>('enterprise-cache-scope', () => '')
  const names = ref<Record<string, string>>({})
  const tree = ref<Department[]>([])
  const userDepartments = ref<Record<string, string>>({})
  const directoryError = ref(false)
  let epoch = 0
  let departmentLoaded = false
  let departmentsAttempted = false
  let departmentsPending = false
  const attemptedUsers = new Set<string>()
  const pendingUsers = new Set<string>()
  async function refresh(retry = true) {
    const current = epoch
    if (!scope.value || enabled?.value === false) return
    if (retry) {
      attemptedUsers.clear()
      if (!departmentsPending) departmentsAttempted = false
      directoryError.value = false
    }
    // Reserved subjects are not Directory users: never looked up, and never a
    // reason to flag the directory as unavailable.
    const missing = [...new Set(uids.value.filter(Boolean))].filter(uid => !isReservedDirectorySubject(uid)).filter(uid => !names.value[uid] && !pendingUsers.has(uid) && !attemptedUsers.has(uid))
    const jobs: Promise<void>[] = []
    if (missing.length) jobs.push((async () => {
      missing.forEach((uid) => {
        pendingUsers.add(uid)
        attemptedUsers.add(uid)
      })
      try {
        // Host registers only the batch lookup; per-uid paths are not exposed.
        const response = await $fetch<{ code: number, data: Array<{ uid: string, realName?: string, real_name?: string, nickname?: string, deptName?: string, deptCode?: string, department?: { name?: string } }> }>(sharedApiPath('/api/directory/users/batch'), { method: 'POST', body: { uids: missing } })
        if (current !== epoch) return
        if (response.code !== 0 || !Array.isArray(response.data)) throw Error('directory_unavailable')
        for (const user of response.data) {
          if (missing.includes(user.uid)) {
            names.value[user.uid] = user.realName || user.real_name || user.nickname || '未设置姓名'
            userDepartments.value[user.uid] = user.deptName || user.department?.name || user.deptCode || ''
          }
        }
        if (missing.some(uid => !names.value[uid])) directoryError.value = true
      } catch {
        if (current === epoch) directoryError.value = true
      } finally {
        if (current === epoch) missing.forEach(uid => pendingUsers.delete(uid))
      }
    })())
    if (!departmentLoaded && !departmentsPending && !departmentsAttempted) jobs.push((async () => {
      departmentsPending = true
      departmentsAttempted = true
      try {
        const response = await $fetch<{ code: number, data: { tree: Department[] } }>(sharedApiPath('/api/directory/departments'))
        if (current !== epoch) return
        if (response.code !== 0 || !Array.isArray(response.data?.tree)) throw Error('directory_unavailable')
        tree.value = response.data.tree
        departmentLoaded = true
      } catch {
        if (current === epoch) directoryError.value = true
      } finally {
        if (current === epoch) departmentsPending = false
      }
    })())
    await Promise.all(jobs)
  }
  function clear() {
    epoch++
    names.value = {}
    userDepartments.value = {}
    tree.value = []
    departmentLoaded = false
    pendingUsers.clear()
    attemptedUsers.clear()
    departmentsPending = false
    departmentsAttempted = false
  }
  watch(scope, clear, { flush: 'sync' })
  watch(() => enabled?.value, (value) => {
    if (value === false) clear()
  }, { flush: 'sync' })
  onMounted(() => {
    void refresh(false)
  })
  watch([uids, scope, () => enabled?.value], () => {
    void refresh(false)
  })
  onScopeDispose(() => {
    epoch++
  })
  const departments = computed(() => {
    const output: Record<string, string> = {}
    const visit = (nodes: Department[]) => nodes.forEach((n) => {
      output[n.deptCode] = n.name
      if (n.children) visit(n.children)
    })
    visit(tree.value)
    return output
  })
  return { tree, directoryError, refresh, userDepartment: (uid: unknown) => {
    const value = userDepartments.value[String(uid)] || ''
    return departments.value[value] || value
  }, userName: (uid: unknown) => !uid || String(uid) === UNASSIGNED_OWNER_UID ? UNASSIGNED_OWNER_LABEL : names.value[String(uid)] || (isReservedDirectorySubject(uid) ? '系统' : '姓名加载中或不可用'), departmentName: (code: unknown) => code ? departments.value[String(code)] || '部门加载中或不可用' : '未分配部门' }
}
