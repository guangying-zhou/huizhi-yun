/**
 * 全局快捷文档创建 composable
 * 在任意页面按 Ctrl+K / ⌘+K 打开快捷创建模态窗口
 */

import { useEventListener } from '@vueuse/core'
import { format, getISOWeek, getISOWeekYear } from 'date-fns'

interface DeptTreeNode {
  deptCode: string
  name: string
  orgType?: string
  children?: DeptTreeNode[]
}

interface FlatDept {
  deptCode: string
  name: string
}

interface CreateDocResponse {
  data?: {
    uuid?: string
  }
}

// ---------- 全局共享状态 ----------
const isOpen = ref(false)
const departments = ref<FlatDept[]>([])
const departmentsLoading = ref(false)

interface ProjectOption {
  projectCode: string
  name: string
}
const git_projects = ref<ProjectOption[]>([])
const projectsLoading = ref(false)

interface PrivateFolderOption {
  id: number
  name: string
  parent_id: number | null
}
const privateFolders = ref<PrivateFolderOption[]>([])
const privateFoldersLoading = ref(false)

const isCreating = ref(false)

export function useQuickCreateDoc() {
  const toast = useToast()
  const { user, userRealname, userNickname } = useAuth()
  const { departmentsCache, setDepartmentsCache } = useUserDepartmentsCache()
  const accountStore = useAccountStore()

  const uid = computed(() => user.value || '')

  // ---------- 部门相关 ----------

  const flattenDepts = (nodes: DeptTreeNode[]): FlatDept[] => {
    const result: FlatDept[] = []
    const walk = (list: DeptTreeNode[]) => {
      for (const n of list) {
        if (n.children?.length) {
          walk(n.children)
        } else {
          result.push({ deptCode: n.deptCode, name: n.name })
        }
      }
    }
    walk(nodes)
    return result
  }

  const loadDepartments = async () => {
    if (departments.value.length > 0) return

    // 尝试缓存
    const cached = departmentsCache.value
    if (cached?.departments?.length) {
      departments.value = flattenDepts(cached.departments)
      return
    }

    if (!uid.value) return
    departmentsLoading.value = true
    try {
      const response = await $fetch<{
        code: number
        data: { departments: DeptTreeNode[], primaryDeptCode: string | null }
      }>('/api/account/user-departments', {
        params: { uid: uid.value }
      })
      if (response.code === 0 && response.data) {
        setDepartmentsCache({
          departments: response.data.departments,
          primaryDeptCode: response.data.primaryDeptCode
        })
        departments.value = flattenDepts(response.data.departments)
      }
    } catch (err) {
      console.error('[QuickCreateDoc] Failed to load departments:', err)
    } finally {
      departmentsLoading.value = false
    }
  }

  // ---------- 项目相关 ----------
  const collectLeafProjects = (list: { projectCode: string, name: string, isGroup: number, subProjects?: unknown[] }[]): ProjectOption[] => {
    const result: ProjectOption[] = []
    for (const p of list) {
      // 只收集叶子节点（非 group 或 没有子项目的 group）
      if (!p.isGroup || !(p.subProjects as unknown[])?.length) {
        result.push({ projectCode: p.projectCode, name: p.name })
      }
      if ((p.subProjects as typeof list)?.length) {
        result.push(...collectLeafProjects(p.subProjects as typeof list))
      }
    }
    return result
  }

  const loadProjects = async () => {
    if (git_projects.value.length > 0) return
    if (!uid.value) return

    projectsLoading.value = true
    try {
      const userProjects = await accountStore.fetchUserProjects(uid.value)
      if (userProjects) {
        const all = [
          ...collectLeafProjects(userProjects.managed || []),
          ...collectLeafProjects(userProjects.joined || [])
        ]
        // 去重
        const seen = new Set<string>()
        git_projects.value = all.filter((p) => {
          if (seen.has(p.projectCode)) return false
          seen.add(p.projectCode)
          return true
        })
      }
    } catch (err) {
      console.error('[QuickCreateDoc] Failed to load git_projects:', err)
    } finally {
      projectsLoading.value = false
    }
  }

  // ---------- 个人目录相关 ----------
  const loadPrivateFolders = async () => {
    if (privateFolders.value.length > 0) return
    if (!uid.value) return

    privateFoldersLoading.value = true
    try {
      const response = await $fetch<{ data?: { items?: PrivateFolderOption[] } }>('/api/folders', {
        query: {
          folder_type: 'private',
          owner_uid: uid.value,
          limit: 500
        }
      })
      privateFolders.value = response?.data?.items || []
    } catch (err) {
      console.error('[QuickCreateDoc] Failed to load private folders:', err)
    } finally {
      privateFoldersLoading.value = false
    }
  }

  // ---------- 创建文档逻辑 ----------
  const createDocument = async (params: {
    title?: string // 可选，因为工作日志和周报不需要手填标题
    docType: 'private' | 'project' | 'department' | 'worklog' | 'weekly'
    projectCode?: string
    deptCode?: string
    folderId?: number | null
  }) => {
    // 除了工作日志和周报，其他类型必须有标题
    if (!['worklog', 'weekly'].includes(params.docType) && !params.title?.trim()) {
      toast.add({ title: '请输入文档标题', color: 'warning' })
      return
    }

    isCreating.value = true
    try {
      let docUuid = ''

      if (params.docType === 'worklog') {
        const now = new Date()
        const result = await $fetch<CreateDocResponse>('/api/worklogs/create', {
          method: 'POST',
          body: {
            owner_uid: uid.value,
            owner_realname: userRealname.value || userNickname.value || uid.value,
            date: format(now, 'yyyyMMdd')
          }
        })
        docUuid = result?.data?.uuid || ''
      } else if (params.docType === 'weekly') {
        const now = new Date()
        const result = await $fetch<CreateDocResponse>('/api/personal-weekly-reports/create', {
          method: 'POST',
          body: {
            owner_uid: uid.value,
            owner_realname: userRealname.value || userNickname.value || uid.value,
            year: String(getISOWeekYear(now)),
            week: String(getISOWeek(now))
          }
        })
        docUuid = result?.data?.uuid || ''
      } else {
        const body: Record<string, unknown> = {
          title: params.title?.trim() || '',
          doc_type: params.docType,
          owner_uid: uid.value
        }
        if (params.folderId !== undefined) {
          body.folder_id = params.folderId
        }
        if (params.docType === 'project' && params.projectCode) {
          body.project_code = params.projectCode
        }
        if (params.docType === 'department' && params.deptCode) {
          body.dept_code = params.deptCode
        }

        const result = await $fetch<CreateDocResponse>('/api/documents', {
          method: 'POST',
          body
        })
        docUuid = result?.data?.uuid || ''
      }

      if (docUuid) {
        toast.add({ title: '文档创建成功', color: 'success' })
        isOpen.value = false
        navigateTo(`/documents/${docUuid}`)
      } else {
        toast.add({ title: '创建文档失败', color: 'error' })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '创建文档失败'
      toast.add({ title: message, color: 'error' })
    } finally {
      isCreating.value = false
    }
  }

  // ---------- 全局快捷键 ----------
  let shortcutRegistered = false
  const registerShortcut = () => {
    if (!import.meta.client || shortcutRegistered) return
    shortcutRegistered = true

    useEventListener(window, 'keydown', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        isOpen.value = !isOpen.value
      }
    })
  }

  return {
    isOpen,
    departments,
    departmentsLoading,
    git_projects,
    projectsLoading,
    privateFolders,
    privateFoldersLoading,
    isCreating,
    loadDepartments,
    loadProjects,
    loadPrivateFolders,
    createDocument,
    registerShortcut
  }
}
