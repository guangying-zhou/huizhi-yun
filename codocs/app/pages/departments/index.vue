<script setup lang="ts">
import type { ProjectDocsTreeItem } from '~/types'

// 文档记录类型
interface DocRecord {
  uuid: string
  title: string
  folder_id: number | null
  star_flag?: number
  readonly_flag?: number
  publish_info?: string | Record<string, unknown>
  updated_at?: string
  owner_uid?: string
  doc_type?: string
  dept_code?: string
  content?: string
  ai_abstract?: string
  deleted_at?: string
  [key: string]: unknown
}

// 文件夹记录类型
interface FolderRecord {
  id: number
  name: string
  parent_id: number | null
  folder_type?: string
  dept_code?: string
  [key: string]: unknown
}

// API 菜单项类型
interface MenuItem {
  label: string
  icon: string
  color?: 'error'
  onSelect: () => void
}

interface DepartmentMembersResponse {
  code: number
  data?: {
    managerId?: string | null
    leaderId?: string | null
    parentManagerId?: string | null
    parentLeaderId?: string | null
    members?: Array<{ uid: string, realName: string }>
  }
}

interface PublishReviewRecord {
  id: number
  review_type?: string | null
  extra?: {
    sendTo?: string
  } | null
  send_records?: Array<{
    receiver_name?: string | null
    sent_date?: string | null
    confirmed_at?: string | null
  }>
}

definePageMeta({
  layout: 'default'
})

const toast = useToast()
const apiFetch = useRequestFetch()
const { user, userDeptCode } = useAuth()
const { setPayload: setDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()
const { departmentsCache, setDepartmentsCache } = useUserDepartmentsCache()
const { setHeaderActions, clearHeaderActions } = useLayoutHeaderActions()
const uid = computed(() => user.value || 'user1')
const currentUid = computed(() => String(user.value || '').trim())
const deptCode = ref<string>('')
const isDepartmentManager = ref(false)
const departmentCanWrite = ref(false)
const departmentAccessPending = ref(false)
const pendingDeptShareCount = ref(0)

// 部门树相关状态
interface DeptTreeNode {
  deptCode: string
  name: string
  orgType?: string
  children?: DeptTreeNode[]
}
const userDepartments = ref<DeptTreeNode[]>([])

// 扁平化部门列表（用于下拉框，只包含叶子节点）
const flatDepartments = computed(() => {
  const result: Array<{ deptCode: string, name: string, icon: string }> = []

  const flatten = (nodes: DeptTreeNode[]) => {
    for (const node of nodes) {
      // 如果有子节点，递归处理子节点（不添加父节点）
      if (node.children && node.children.length > 0) {
        flatten(node.children)
      } else {
        // 只添加叶子节点（没有子部门的部门）
        result.push({
          deptCode: node.deptCode,
          name: node.name,
          icon: node.orgType === 'committee' ? 'i-lucide-users' : 'i-lucide-building'
        })
      }
    }
  }

  flatten(userDepartments.value)

  // 调试日志
  if (import.meta.dev) {
    console.log('[flatDepartments]', result)
  }

  return result
})

const hasMultipleDepts = computed(() => {
  // 如果扁平化后的部门列表大于1个，显示下拉框
  return flatDepartments.value.length > 1
})

const isDepartmentReadonlyViewer = computed(() => {
  return departmentAccessPending.value ? false : !departmentCanWrite.value
})

const ensureDepartmentWritable = (message = '当前身份仅可查看该部门文档') => {
  if (departmentCanWrite.value) return true

  toast.add({
    title: message,
    color: 'warning'
  })
  return false
}

const ensureDepartmentManager = (message: string) => {
  if (isDepartmentManager.value) return true

  toast.add({
    title: message,
    color: 'warning'
  })
  return false
}

const loadDepartmentAccess = async () => {
  if (!currentUid.value || !deptCode.value) {
    isDepartmentManager.value = false
    departmentCanWrite.value = false
    return
  }

  departmentAccessPending.value = true
  try {
    const response = await apiFetch<DepartmentMembersResponse>('/api/account/department-members', {
      params: { deptCode: deptCode.value }
    })
    const data = response.data
    const actorUid = currentUid.value

    const isDeptLeader = actorUid === data?.leaderId
    const isDeptManager = actorUid === data?.managerId
    const isDeptMember = !!data?.members?.some(member => member.uid === actorUid)
    const isParentReadonlyRole = actorUid === data?.parentManagerId
      || actorUid === data?.parentLeaderId

    const isWritableMember = isDeptManager
      || isDeptMember
    const isReadonlyRole = isDeptLeader
      || (!isWritableMember && isParentReadonlyRole)

    isDepartmentManager.value = isDeptManager
    departmentCanWrite.value = !isReadonlyRole && isWritableMember
  } catch (error) {
    console.error('[Departments] Failed to resolve department access:', error)
    isDepartmentManager.value = false
    departmentCanWrite.value = false
  } finally {
    departmentAccessPending.value = false
  }
}

// 获取用户关联的部门（含管理/分管的子部门树）
const initDeptCode = async () => {
  if (!user.value) return

  const cachedDepartments = departmentsCache.value
  if (cachedDepartments?.departments?.length) {
    userDepartments.value = cachedDepartments.departments

    let cached: string | null = null
    if (import.meta.client) {
      try {
        cached = localStorage.getItem('coworks_dept')
      } catch { /* ignore */ }
    }

    const isValidDept = (nodes: DeptTreeNode[], code: string): boolean => {
      for (const n of nodes) {
        if (n.deptCode === code) return true
        if (n.children?.length && isValidDept(n.children, code)) return true
      }
      return false
    }

    if (cached && isValidDept(userDepartments.value, cached)) {
      deptCode.value = cached
    } else if (cachedDepartments.primaryDeptCode) {
      deptCode.value = cachedDepartments.primaryDeptCode
    } else if (userDepartments.value.length > 0) {
      deptCode.value = userDepartments.value[0]?.deptCode ?? ''
    }
  }

  if (deptCode.value) return

  try {
    const response = await apiFetch<{ code: number, data: { departments: DeptTreeNode[], primaryDeptCode: string | null } }>('/api/account/user-departments', {
      params: { uid: user.value }
    })

    if (response.code === 0 && response.data) {
      userDepartments.value = response.data.departments || []
      setDepartmentsCache({
        departments: userDepartments.value,
        primaryDeptCode: response.data.primaryDeptCode || null
      })

      // 优先使用缓存的部门（仅客户端）
      let cached: string | null = null
      if (import.meta.client) {
        try {
          cached = localStorage.getItem('coworks_dept')
        } catch { /* ignore */ }
      }

      // 验证缓存的部门是否在用户可用部门列表中
      const isValidDept = (nodes: DeptTreeNode[], code: string): boolean => {
        for (const n of nodes) {
          if (n.deptCode === code) return true
          if (n.children?.length && isValidDept(n.children, code)) return true
        }
        return false
      }

      if (cached && isValidDept(userDepartments.value, cached)) {
        deptCode.value = cached
      } else if (response.data.primaryDeptCode) {
        deptCode.value = response.data.primaryDeptCode
      } else if (userDepartments.value.length > 0) {
        deptCode.value = userDepartments.value[0]?.deptCode ?? ''
      }
    }
  } catch (error) {
    console.error('[Departments] Failed to fetch user departments:', error)
  }

  // 兜底：如果 API 没返回，使用 cookie 中的部门ID
  if (!deptCode.value && userDeptCode.value) {
    deptCode.value = userDeptCode.value
  }
}

// 初始化部门ID
await initDeptCode()

// Tree state - 选中的节点可以是文件夹或文件
const selectedNodeId = ref<string>('root') // 'root', 'folder-{id}', 'doc-{uuid}'
const selectedNodeType = ref<'root' | 'folder' | 'document'>('root')
const expandedFolders = ref<Set<number>>(new Set())

// Preview state
const previewContent = ref('')
const previewAbstract = ref('')
const previewDoc = ref<DocRecord | null>(null)
const previewPublishRecord = ref<PublishReviewRecord | null>(null)
const previewLoading = ref(false)
const showPublishRecord = ref(false)
const EDITOR_RETURN_PREVIEW_KEY = 'codocs:departments:return-preview'

// 当前选中的部门对象（用于下拉框）
const selectedDept = computed({
  get: () => flatDepartments.value.find(d => d.deptCode === deptCode.value) || undefined,
  set: (dept) => {
    if (dept && dept.deptCode !== deptCode.value) {
      switchDepartment(dept.deptCode)
    }
  }
})

// 切换部门
const switchDepartment = (newDeptCode: string) => {
  if (newDeptCode === deptCode.value) return
  deptCode.value = newDeptCode
  // 缓存选中的部门
  try {
    if (import.meta.client) localStorage.setItem('coworks_dept', newDeptCode)
  } catch { /* ignore */ }
  // 重置选中状态和预览
  resetSelectionAndPreview()
  expandedFolders.value = new Set()
  // 如果回收站打开，重新加载
  if (showRecycleBin.value) {
    loadTrashDocuments()
  }
}

// Modal states
const showNewDocModal = ref(false)
const showNewFolderModal = ref(false)
const newDocName = ref('')
const newFolderName = ref('')
const isCreating = ref(false)

// Upload state
const fileInput = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)

// Mobile Sidebar
const showMobileSidebar = ref(false)
const { panelWidth, panelCollapsed, onResizeStart, showPanel } = useResizablePanel(240)

// Inline editing
const editingId = ref<string | null>(null) // 'folder-{id}' or 'doc-{uuid}'
const editingName = ref('')

interface RestoreDocRecord {
  uuid: string
  title: string
  doc_type: string
  owner_uid?: string
  folder_id?: number | null
  dept_code?: string
  project_code?: string
}

const toRestoreRecord = (doc: DocRecord | null): RestoreDocRecord | null => {
  if (!doc) return null
  return {
    uuid: doc.uuid,
    title: doc.title,
    doc_type: String(doc.doc_type || 'department'),
    owner_uid: doc.owner_uid,
    folder_id: typeof doc.folder_id === 'number' ? doc.folder_id : undefined,
    dept_code: doc.dept_code,
    project_code: undefined
  }
}

const resetSelectionAndPreview = () => {
  selectedNodeId.value = 'root'
  selectedNodeType.value = 'root'
  previewContent.value = ''
  previewAbstract.value = ''
  previewDoc.value = null
}

// Recycle bin state
const showRecycleBin = ref(false)
const showPublishedDocuments = ref(false)

// 页面标题（依赖 showPublishedDocuments 和 showRecycleBin）
const pageTitle = computed(() => {
  const base = showPublishedDocuments.value ? '已发布文档' : '部门协同文档'
  return showRecycleBin.value ? `${base} - 回收站` : base
})
usePageTitle(pageTitle)

const { setRefresh } = usePageActions()
setRefresh(() => {
  refreshFolders()
  refreshDocs()
})

const trashDocuments = ref<DocRecord[]>([])
const trashLoading = ref(false)

// Restore modal state
const showRestoreModal = ref(false)
const restoreDoc = ref<RestoreDocRecord | null>(null)

// Fetch trash documents
const { fetchTrashDocuments: fetchTrash, formatDeletedAt, formatDocLocation } = useRecycleBin()
const loadTrashDocuments = async () => {
  trashLoading.value = true
  try {
    const result = await fetchTrash({
      type: 'department',
      dept_code: deptCode.value
    })
    trashDocuments.value = result.map(doc => ({
      ...doc,
      folder_id: doc.folder_id ?? null
    })) as DocRecord[]
  } finally {
    trashLoading.value = false
  }
}

// Watch recycle bin toggle
watch(showRecycleBin, (show) => {
  resetSelectionAndPreview()
  if (show) {
    loadTrashDocuments()
  }
})

watch(showPublishedDocuments, () => {
  resetSelectionAndPreview()
  expandedFolders.value = new Set()
})

// Fetch all folders for department
const fetchAllFolders = async () => {
  if (!user.value || !deptCode.value) return []
  const response = await apiFetch<{ data: { items: FolderRecord[] } }>('/api/folders', {
    query: {
      folder_type: 'department',
      dept_code: deptCode.value
    }
  })
  return response?.data?.items || []
}

// Fetch all documents for department
const fetchAllDocuments = async () => {
  if (!user.value || !deptCode.value) return []
  const response = await apiFetch<{ data: { items: DocRecord[] } }>('/api/documents', {
    query: {
      type: 'department',
      dept_code: deptCode.value,
      exclude_weekly_reports: '1',
      published_mode: showPublishedDocuments.value ? 'published' : 'unpublished'
    }
  })
  return response?.data?.items || []
}

const { data: allFolders, pending: foldersPending, refresh: refreshFolders } = await useAsyncData(
  'dept-folders',
  fetchAllFolders,
  {
    watch: [user, deptCode],
    immediate: true,
    getCachedData: () => undefined
  }
)

const { data: allDocuments, pending: docsPending, refresh: refreshDocs } = await useAsyncData(
  'dept-documents',
  fetchAllDocuments,
  {
    watch: [user, deptCode, showPublishedDocuments],
    immediate: true,
    getCachedData: () => undefined
  }
)

const loading = computed(() => docsPending.value || foldersPending.value)

const refreshPendingDeptShareCount = async () => {
  if (!deptCode.value || !departmentCanWrite.value) {
    pendingDeptShareCount.value = 0
    return
  }

  try {
    const res = await $fetch<{ data?: unknown[] }>('/api/dept-shares', {
      params: { deptCode: deptCode.value }
    })
    pendingDeptShareCount.value = Array.isArray(res.data) ? res.data.length : 0
  } catch {
    pendingDeptShareCount.value = 0
  }
}

// Watch for user authentication
watch([user, deptCode], async ([newUser, newDeptCode]) => {
  if (newUser && newDeptCode) {
    loadDepartmentAccess()
    await Promise.all([refreshFolders(), refreshDocs()])
    await refreshPreviewAfterEditorReturn()
  }
}, { immediate: true })

watch([deptCode, departmentCanWrite], () => {
  refreshPendingDeptShareCount()
}, { immediate: true })

// Build combined tree (folders + documents)
const buildTreeItems = (parentId: number | null): ProjectDocsTreeItem[] => {
  const folders = allFolders.value || []
  const documents = allDocuments.value || []
  const items: ProjectDocsTreeItem[] = []

  // 1. 添加子文件夹
  const subFolders = folders.filter((f: FolderRecord) => f.parent_id === parentId)
  subFolders.forEach((folder: FolderRecord) => {
    items.push({
      type: 'folder',
      id: folder.id,
      nodeId: `folder-${folder.id}`,
      name: folder.name,
      data: folder,
      children: buildTreeItems(folder.id) // 递归构建子节点
    })
  })

  // 2. 添加该文件夹下的文档
  const docs = documents.filter((d: DocRecord) => {
    // 注意：folder_id 可能是 null 或 undefined
    if (parentId === null) {
      return d.folder_id === null || d.folder_id === undefined
    }
    return d.folder_id === parentId
  })
  docs.forEach((doc: DocRecord) => {
    items.push({
      type: 'document',
      id: doc.uuid,
      nodeId: `doc-${doc.uuid}`,
      name: doc.title,
      data: doc
    })
  })

  return items
}

const treeItems = computed<ProjectDocsTreeItem[]>(() => {
  if (showPublishedDocuments.value) {
    return (allDocuments.value || []).map((doc: DocRecord) => ({
      type: 'document',
      id: doc.uuid,
      nodeId: `doc-${doc.uuid}`,
      name: doc.title,
      data: doc
    }))
  }
  return buildTreeItems(null) // 根目录的子节点
})

// Toggle folder expansion
const toggleFolder = (folderId: number) => {
  if (expandedFolders.value.has(folderId)) {
    expandedFolders.value.delete(folderId)
  } else {
    expandedFolders.value.add(folderId)
  }
  expandedFolders.value = new Set(expandedFolders.value)
}

// Select node (root, folder, or document)
const selectNode = async (nodeId: string, nodeType: 'root' | 'folder' | 'document', data?: DocRecord | FolderRecord) => {
  // 如果已选中同一个文档，不重复加载
  if (nodeType === 'document' && selectedNodeId.value === nodeId && previewDoc.value) {
    return
  }

  selectedNodeId.value = nodeId
  selectedNodeType.value = nodeType

  // Close sidebar on mobile
  showMobileSidebar.value = false

  if (nodeType === 'document' && data) {
    // 加载文档预览
    await loadDocumentPreview(data)
  } else {
    // 选中根目录或文件夹，清空预览
    previewContent.value = ''
    previewAbstract.value = ''
    previewDoc.value = null
  }
}

// Load document preview
const loadDocumentPreview = async (doc: DocRecord | FolderRecord) => {
  previewDoc.value = doc as DocRecord
  previewPublishRecord.value = null
  previewLoading.value = true
  previewContent.value = ''

  try {
    const query = showRecycleBin.value ? '?include_deleted=1' : ''
    const response = await $fetch<{ success: boolean, data: DocRecord | null }>(`/api/documents/${(doc as DocRecord).uuid}${query}`)
    if (response.success && response.data) {
      previewDoc.value = response.data
      previewContent.value = response.data.content || ''
      previewAbstract.value = response.data.ai_abstract || ''

      if (getPublishInfo(response.data)) {
        try {
          const reviewRes = await $fetch<{ code: number, data: PublishReviewRecord | null }>(`/api/reviews/by-document/${response.data.uuid}`)
          previewPublishRecord.value = reviewRes.data || null
        } catch (error) {
          console.warn('[Departments] Failed to load publish review record:', error)
          previewPublishRecord.value = null
        }
      }
    }
  } catch {
    toast.add({
      title: '加载失败',
      description: '无法加载文档内容',
      color: 'error'
    })
  } finally {
    previewLoading.value = false
  }
}

// Start inline editing
const startEdit = (id: string, name: string) => {
  if (!ensureDepartmentWritable()) return
  editingId.value = id
  editingName.value = name
}

// Save inline edit
const saveEdit = async () => {
  if (!editingId.value || !editingName.value.trim()) {
    editingId.value = null
    return
  }

  try {
    if (editingId.value.startsWith('folder-')) {
      const folderId = parseInt(editingId.value.replace('folder-', ''))
      await $fetch(`/api/folders/${folderId}`, {
        method: 'PATCH',
        body: { name: editingName.value.trim() }
      })
      toast.add({ title: '文件夹已重命名', color: 'success' })
      await refreshFolders()
    } else if (editingId.value.startsWith('doc-')) {
      const docUuid = editingId.value.replace('doc-', '')
      await $fetch(`/api/documents/${docUuid}`, {
        method: 'PATCH',
        body: { title: editingName.value.trim() }
      })
      toast.add({ title: '文档已重命名', color: 'success' })
      await refreshDocs()
    }
  } catch (err: unknown) {
    toast.add({ title: err instanceof Error ? err.message : '重命名失败', color: 'error' })
  } finally {
    editingId.value = null
  }
}

const cancelEdit = () => {
  editingId.value = null
  editingName.value = ''
}

// Get current folder ID (for creating new items)
const currentFolderId = computed<number | null>(() => {
  if (selectedNodeType.value === 'root') return null
  if (selectedNodeType.value === 'folder') {
    const id = selectedNodeId.value.replace('folder-', '')
    return parseInt(id)
  }
  if (selectedNodeType.value === 'document' && previewDoc.value) {
    return previewDoc.value.folder_id
  }
  return null
})

// Create document
const createDocument = async () => {
  if (!ensureDepartmentWritable()) return

  if (!newDocName.value.trim()) {
    toast.add({ title: '请输入文档名称', color: 'warning' })
    return
  }

  if (!deptCode.value) {
    toast.add({ title: '无法获取部门信息', color: 'error' })
    return
  }

  isCreating.value = true
  try {
    const { data, error } = await useFetch('/api/documents', {
      method: 'POST',
      body: {
        title: newDocName.value.trim(),
        doc_type: 'department',
        dept_code: deptCode.value,
        owner_uid: uid.value,
        folder_id: currentFolderId.value
      }
    })

    if (error.value) {
      throw new Error(error.value.message || '创建文档失败')
    }

    toast.add({ title: '文档创建成功', color: 'success' })
    showNewDocModal.value = false
    newDocName.value = ''
    await refreshDocs()

    const docUUId = (data.value as { data?: { uuid?: string } } | null)?.data?.uuid
    if (docUUId) {
      await navigateToEdit(docUUId)
    }
  } catch (err: unknown) {
    toast.add({ title: err instanceof Error ? err.message : '创建文档失败', color: 'error' })
  } finally {
    isCreating.value = false
  }
}

// Create folder
const createFolder = async () => {
  if (!ensureDepartmentManager('仅部门经理可创建目录')) return

  if (!newFolderName.value.trim()) {
    toast.add({ title: '请输入文件夹名称', color: 'warning' })
    return
  }

  if (!deptCode.value) {
    toast.add({ title: '无法获取部门信息', color: 'error' })
    return
  }

  isCreating.value = true
  try {
    const { error } = await useFetch('/api/folders', {
      method: 'POST',
      body: {
        name: newFolderName.value.trim(),
        folder_type: 'department',
        dept_code: deptCode.value,
        owner_uid: uid.value,
        parent_id: currentFolderId.value
      }
    })

    if (error.value) {
      throw new Error(error.value.message || '创建文件夹失败')
    }

    toast.add({ title: '文件夹创建成功', color: 'success' })
    showNewFolderModal.value = false
    newFolderName.value = ''

    // Expand parent folder
    if (currentFolderId.value !== null) {
      expandedFolders.value.add(currentFolderId.value)
      expandedFolders.value = new Set(expandedFolders.value)
    }

    await refreshFolders()
  } catch (err: unknown) {
    toast.add({ title: err instanceof Error ? err.message : '创建文件夹失败', color: 'error' })
  } finally {
    isCreating.value = false
  }
}

// Upload files
const triggerUpload = () => {
  if (!ensureDepartmentWritable()) return
  fileInput.value?.click()
}

const handleFileUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return

  const files = Array.from(input.files)
  const validFiles = files.filter(f => f.name.toLowerCase().endsWith('.md'))

  if (validFiles.length === 0) {
    toast.add({ title: '请选择 .md 文件', color: 'warning' })
    input.value = ''
    return
  }

  if (!deptCode.value) {
    toast.add({ title: '无法获取部门信息', color: 'error' })
    input.value = ''
    return
  }

  isUploading.value = true
  const formData = new FormData()
  formData.append('doc_type', 'department')
  formData.append('dept_code', deptCode.value)
  formData.append('owner_uid', uid.value)
  if (currentFolderId.value) {
    formData.append('folder_id', String(currentFolderId.value))
  }

  validFiles.forEach((file) => {
    formData.append('files', file)
  })

  try {
    const result = await $fetch<{ success: number, failed: number }>('/api/documents/upload', {
      method: 'POST',
      body: formData
    })

    if (result.success > 0) {
      toast.add({ title: `成功上传 ${result.success} 个文档`, color: 'success' })
      await refreshDocs()
    }

    if (result.failed > 0) {
      toast.add({ title: `${result.failed} 个文档上传失败`, color: 'error' })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '上传失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    isUploading.value = false
    input.value = ''
  }
}

// Delete confirmation
const showDeleteConfirm = ref(false)
const deleteTarget = ref<{ type: 'folder' | 'document', id: number | string, name: string } | null>(null)
const isDeleting = ref(false)

const confirmDelete = (type: 'folder' | 'document', id: number | string, name: string) => {
  if (type === 'folder' && !ensureDepartmentManager('仅部门经理可删除目录')) return
  if (type === 'document' && !ensureDepartmentManager('仅部门经理可删除文档')) return
  deleteTarget.value = { type, id, name }
  showDeleteConfirm.value = true
}

const executeDelete = async () => {
  if (!deleteTarget.value) return

  const target = deleteTarget.value
  const targetId = String(target.id)
  const isDeletingCurrentPreviewDoc = target.type === 'document'
    && (
      previewDoc.value?.uuid === targetId
      || selectedNodeId.value === targetId
      || selectedNodeId.value === `doc-${targetId}`
    )

  isDeleting.value = true
  try {
    if (target.type === 'folder') {
      await $fetch(`/api/folders/${target.id}`, { method: 'DELETE' })
      toast.add({ title: '文件夹已删除', color: 'success' })
      await refreshFolders()
    } else {
      await $fetch(`/api/documents/${target.id}`, { method: 'DELETE' })
      toast.add({ title: '文档已删除', color: 'success' })
      await refreshDocs()
    }

    // 如果删除的是当前选中的项，回到根目录
    if ((target.type === 'folder' && selectedNodeId.value === `folder-${target.id}`)
      || isDeletingCurrentPreviewDoc) {
      await selectNode('root', 'root')
    }

    showDeleteConfirm.value = false
    deleteTarget.value = null
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '删除失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    isDeleting.value = false
  }
}

const cancelDelete = () => {
  showDeleteConfirm.value = false
  deleteTarget.value = null
}

// Toggle home flag
const toggleHome = async (doc: DocRecord) => {
  if (!ensureDepartmentWritable()) return
  const newStatus = !doc.star_flag
  // Optimistic update
  doc.star_flag = newStatus ? 1 : 0
  try {
    await $fetch(`/api/documents/${doc.uuid}`, {
      method: 'PATCH',
      body: { star_flag: newStatus }
    })
    toast.add({ title: newStatus ? '已添加到收藏' : '已取消收藏', color: 'success' })
    await refreshDocs()
  } catch {
    // Revert on error
    doc.star_flag = !newStatus ? 1 : 0
    toast.add({ title: '操作失败', color: 'error' })
  }
}

// Toggle readonly flag
const toggleReadonly = async (doc: DocRecord) => {
  if (!ensureDepartmentManager('仅部门经理可修改部门文档只读状态')) return
  const newStatus = !doc.readonly_flag
  // Optimistic update
  doc.readonly_flag = newStatus ? 1 : 0
  try {
    await $fetch(`/api/documents/${doc.uuid}`, {
      method: 'PATCH',
      body: { readonly_flag: newStatus }
    })
    toast.add({ title: newStatus ? '已设为只读' : '已取消只读', color: 'success' })
    await refreshDocs()
  } catch {
    // Revert on error
    doc.readonly_flag = !newStatus ? 1 : 0
    toast.add({ title: '操作失败', color: 'error' })
  }
}

// Download document
const downloadDocument = (uuid: string) => {
  const link = document.createElement('a')
  link.href = `/api/documents/${uuid}/download`
  link.download = ''
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// Share Modal State
const isShareModalOpen = ref(false)
const sharingDocId = ref<string>('')
const sharingDocTitle = ref('')

// Submit Review Modal State
const showSubmitReviewModal = ref(false)
const reviewingDoc = ref<DocRecord | null>(null)

const openShareModal = (doc: DocRecord) => {
  if (!ensureDepartmentWritable()) return
  sharingDocId.value = doc.uuid
  sharingDocTitle.value = doc.title
  isShareModalOpen.value = true
}

const openSubmitReviewModal = (doc: DocRecord) => {
  if (!ensureDepartmentWritable()) return
  reviewingDoc.value = doc
  showSubmitReviewModal.value = true
}

// Move Modal State
const showMoveModal = ref(false)
const moveDoc = ref<DocRecord | null>(null)

const openMoveModal = (doc: DocRecord) => {
  if (!ensureDepartmentWritable()) return
  moveDoc.value = doc
  showMoveModal.value = true
}

const moveDocument = async (targetFolderId: number | null) => {
  if (!moveDoc.value) return
  try {
    await $fetch(`/api/documents/${moveDoc.value.uuid}`, {
      method: 'PATCH',
      body: { folder_id: targetFolderId }
    })
    toast.add({ title: '文档已移动', color: 'success' })
    await refreshDocs()
    // 回到根目录
    selectNode('root', 'root')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '移动失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    moveDoc.value = null
  }
}

// Copy Document Modal State
const showCopyModal = ref(false)
const copyDoc = ref<DocRecord | null>(null)

const openCopyModal = (doc: DocRecord) => {
  if (!ensureDepartmentWritable()) return
  copyDoc.value = doc
  showCopyModal.value = true
}

const onCopySuccess = () => {
  showCopyModal.value = false
  refreshDocs()
}

// 解析 publish_info
const getPublishInfo = (doc: DocRecord) => {
  if (!doc?.publish_info) return null
  try {
    const info = typeof doc.publish_info === 'string' ? JSON.parse(doc.publish_info) : doc.publish_info
    if (info.date && info.label) {
      const d = new Date(info.date)
      const dateStr = `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`
      return { ...info, dateStr }
    }
  } catch {
    // 旧格式兼容（纯文本 "已发布为XXX"）
    if (typeof doc.publish_info === 'string' && doc.publish_info.startsWith('已发布')) {
      return { label: doc.publish_info.replace('已发布为', ''), dateStr: '', date: '' }
    }
  }
  return null
}

const formatPublishText = (info: { dateStr: string, label: string }) => {
  if (info.dateStr) {
    return `已于${info.dateStr}发布至"${info.label}"`
  }
  return `已发布至"${info.label}"`
}

const formatPublishDateText = (dateStr?: string | null) => {
  if (!dateStr) return ''
  const value = new Date(dateStr)
  if (Number.isNaN(value.getTime())) return String(dateStr)
  return `${value.getFullYear()}年${String(value.getMonth() + 1).padStart(2, '0')}月${String(value.getDate()).padStart(2, '0')}日`
}

const getPublishDisplayText = (doc: DocRecord) => {
  const latestSend = previewPublishRecord.value?.send_records?.length
    ? previewPublishRecord.value.send_records[previewPublishRecord.value.send_records.length - 1]
    : null
  const receiverName = String(
    latestSend?.receiver_name
    || previewPublishRecord.value?.extra?.sendTo
    || ''
  ).trim()
  const sentAt = latestSend?.sent_date || latestSend?.confirmed_at || null

  if (previewPublishRecord.value?.review_type === '对外发文' && receiverName) {
    const dateLabel = formatPublishDateText(sentAt)
    return dateLabel
      ? `已于${dateLabel}发送给${receiverName}`
      : `已发送给${receiverName}`
  }

  const publishInfo = getPublishInfo(doc)
  return publishInfo ? formatPublishText(publishInfo) : ''
}

const currentBrowserTitle = computed(() => {
  if (showPublishedDocuments.value) {
    return '已发布文档'
  }

  if (selectedNodeType.value === 'root') {
    return '根目录'
  }

  return allFolders.value?.find((f: FolderRecord) => f.id === currentFolderId.value)?.name || '文件夹'
})

// 根据文档状态生成下拉菜单
const getDocMenuItems = (doc: DocRecord) => {
  const isArchived = !!getPublishInfo(doc)
  const items: MenuItem[][] = []

  if (doc.readonly_flag) {
    const readonlyItems: MenuItem[] = [{
      label: '下载',
      icon: 'i-lucide-download',
      onSelect: () => downloadDocument(doc.uuid)
    }]

    if (isArchived && departmentCanWrite.value) {
      readonlyItems.push({
        label: '复制',
        icon: 'i-lucide-copy',
        onSelect: () => openCopyModal(doc)
      })
    }

    if (isArchived) {
      return [readonlyItems]
    }

    if (!isDepartmentManager.value) {
      return []
    }

    return [readonlyItems, [{
      label: '取消只读',
      icon: 'i-lucide-lock-open',
      onSelect: () => toggleReadonly(doc)
    }]]
  }

  // 下载 + 复制
  const group1: MenuItem[] = [{
    label: '下载',
    icon: 'i-lucide-download',
    onSelect: () => downloadDocument(doc.uuid)
  }]
  if (isArchived && departmentCanWrite.value) {
    group1.push({
      label: '复制',
      icon: 'i-lucide-copy',
      onSelect: () => openCopyModal(doc)
    })
  }
  items.push(group1)

  if (!departmentCanWrite.value) {
    return items
  }

  if (!isArchived) {
    // 收藏 / 只读
    items.push([{
      label: doc.star_flag ? '取消收藏' : '收藏',
      icon: doc.star_flag ? 'i-lucide-star-off' : 'i-lucide-star',
      onSelect: () => toggleHome(doc)
    }])

    if (isDepartmentManager.value) {
      items.push([{
        label: doc.readonly_flag ? '取消只读' : '设为只读',
        icon: doc.readonly_flag ? 'i-lucide-lock-open' : 'i-lucide-lock',
        onSelect: () => toggleReadonly(doc)
      }])
    }

    // 共享 / 移动 / 发布
    items.push([{
      label: '共享/提醒',
      icon: 'i-lucide-share-2',
      onSelect: () => openShareModal(doc)
    }, {
      label: '移动到',
      icon: 'i-lucide-folder-input',
      onSelect: () => openMoveModal(doc)
    }, {
      label: '发布',
      icon: 'i-lucide-clipboard-check',
      onSelect: () => openSubmitReviewModal(doc)
    }])

    if (isDepartmentManager.value) {
      items.push([{
        label: '删除',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => confirmDelete('document', doc.uuid, doc.title)
      }])
    }
  }

  return items
}

const shouldShowDocMenu = (doc: DocRecord) => {
  return getDocMenuItems(doc).length > 0
}

const refreshPreviewAfterEditorReturn = async () => {
  if (!import.meta.client || !deptCode.value) return

  try {
    const raw = sessionStorage.getItem(EDITOR_RETURN_PREVIEW_KEY)
    if (!raw) return

    const stored = JSON.parse(raw) as { deptCode?: string, uuid?: string } | null
    if (!stored?.uuid || stored.deptCode !== deptCode.value) return

    sessionStorage.removeItem(EDITOR_RETURN_PREVIEW_KEY)

    await refreshDocs()

    const latestDoc = (allDocuments.value || []).find((doc: DocRecord) => doc.uuid === stored.uuid)
    if (!latestDoc) return

    selectedNodeId.value = stored.uuid
    selectedNodeType.value = 'document'
    await loadDocumentPreview(latestDoc)
  } catch {
    sessionStorage.removeItem(EDITOR_RETURN_PREVIEW_KEY)
  }
}

const handleDepartmentPageShow = () => {
  refreshPreviewAfterEditorReturn()
}

// Navigate to edit document
const navigateToEdit = (uuid: string) => {
  if (previewDoc.value?.uuid === uuid && previewContent.value) {
    setDocumentPreviewBootstrap(uuid, {
      content: previewContent.value,
      aiAbstract: typeof previewDoc.value.ai_abstract === 'string' ? previewDoc.value.ai_abstract : undefined
    })
  }

  if (import.meta.client && deptCode.value) {
    sessionStorage.setItem(EDITOR_RETURN_PREVIEW_KEY, JSON.stringify({
      deptCode: deptCode.value,
      uuid
    }))
  }
  navigateTo(`/documents/${uuid}`)
}

// Initialize
onMounted(() => {
  // 默认选中根目录
  selectNode('root', 'root')

  setHeaderActions([
    {
      key: 'departments-mobile-directory',
      icon: 'i-lucide-folder-tree',
      ariaLabel: '打开目录',
      title: '目录',
      color: 'primary',
      variant: 'soft',
      size: 'sm',
      square: true,
      class: 'md:hidden',
      onClick: () => {
        showMobileSidebar.value = true
      }
    }
  ])

  if (import.meta.client) {
    window.addEventListener('pageshow', handleDepartmentPageShow)
  }

  refreshPreviewAfterEditorReturn()
})

onUnmounted(() => {
  clearHeaderActions()

  if (import.meta.client) {
    window.removeEventListener('pageshow', handleDepartmentPageShow)
  }
})
</script>

<template>
  <UDashboardPanel grow>
    <!-- 页面工具栏 -->
    <div
      v-if="deptCode && departmentCanWrite && pendingDeptShareCount > 0"
      class="flex items-center gap-2 px-3 py-1 border-b border-default md:hidden"
    >
      <div class="flex-1" />
      <DepartmentPendingDeptShares
        :dept-code="deptCode"
        @accepted="refreshFolders(); refreshDocs(); refreshPendingDeptShareCount()"
      />
    </div>
    <div v-if="panelCollapsed" class="hidden md:flex items-center gap-2 px-3 py-1 border-b border-default">
      <UButton
        v-if="panelCollapsed"
        icon="i-lucide-folder-tree"
        variant="ghost"
        size="sm"
        @click="showPanel"
      >
        目录
      </UButton>
      <div class="flex-1" />
      <DepartmentPendingDeptShares
        v-if="deptCode && departmentCanWrite"
        :dept-code="deptCode"
        @accepted="refreshFolders(); refreshDocs(); refreshPendingDeptShareCount()"
      />
    </div>

    <!-- Two-column layout -->
    <div class="flex flex-1 overflow-hidden relative">
      <!-- Mobile Sidebar Overlay -->
      <div
        v-if="showMobileSidebar"
        class="absolute inset-0 bg-black/50 dark:bg-black/80 z-20 md:hidden"
        @click="showMobileSidebar = false"
      />

      <!-- Left: File Tree (Folders + Documents) -->
      <aside
        v-if="!panelCollapsed"
        class="absolute md:relative inset-y-0 left-0 z-30 border-r border-default bg-default flex flex-col overflow-y-auto transform transition-transform duration-200"
        :class="[showMobileSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0']"
        :style="{ width: panelWidth + 'px' }"
      >
        <div class="flex-1 p-2">
          <!-- 部门选择下拉框（有多个部门时显示） -->
          <div v-if="hasMultipleDepts" class="mb-2 pb-2 border-b border-default px-2">
            <label class="text-xs text-muted mb-1 block">选择部门</label>
            <USelectMenu
              v-model="selectedDept"
              :items="flatDepartments"
              label-key="name"
              placeholder="请选择部门"
              size="lg"
              class="w-full"
              :search-input="false"
            >
              <template #leading>
                <UIcon v-if="selectedDept" :name="selectedDept.icon" class="w-4 h-4" />
              </template>
            </USelectMenu>
          </div>

          <!-- Root folder -->
          <!-- <div class="flex items-center justify-between px-2 py-1 mt-1">
            <div class="group flex items-center gap-2 flex-1 py-0.5 rounded-md cursor-pointer hover:bg-elevated"
              :class="{ 'bg-primary/10 text-secondary font-medium': selectedNodeId === 'root' && !showRecycleBin }"
              @click="!showRecycleBin && selectNode('root', 'root')">
              <UIcon name="i-lucide-home" class="w-4 h-4" />
              <span class="text-sm">{{ currentDeptName }}</span>
            </div>
          </div> -->

          <!-- 页签切换：文档列表 / 回收站 -->
          <div class="px-2 mb-2 mt-1">
            <div class="flex pb-0 mb-1 space-x-4 border-b border-default">
              <button
                class="flex items-center justify-center gap-1.5 px-1 py-1.5 text-sm font-medium transition-colors border-b-2"
                :class="!showRecycleBin && !showPublishedDocuments ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-default'"
                @click="showRecycleBin = false; showPublishedDocuments = false"
              >
                <UIcon name="i-lucide-files" class="w-4 h-4" />
                文档
              </button>
              <button
                class="flex items-center justify-center gap-1.5 pl-0 pr-1 py-1.5 text-sm font-medium transition-colors border-b-2"
                :class="showPublishedDocuments && !showRecycleBin ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-default'"
                @click="showRecycleBin = false; showPublishedDocuments = true"
              >
                <UIcon name="i-lucide-archive" class="w-4 h-4" />
                已发布
              </button>
              <button
                class="flex items-center justify-center gap-1.5 px-0 py-1.5 text-sm font-medium transition-colors border-b-2"
                :class="showRecycleBin ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-default'"
                @click="showRecycleBin = true; showPublishedDocuments = false"
              >
                <UIcon name="i-lucide-trash-2" class="w-4 h-4" />
                回收站
              </button>
            </div>
          </div>

          <!-- Tree items (mixed folders and documents) -->
          <ClientOnly>
            <div v-if="!showRecycleBin">
              <div v-if="loading" class="px-2 py-4 text-sm text-muted text-center">
                加载中...
              </div>
              <div v-else-if="treeItems.length === 0" class="px-2 py-4 text-sm text-muted text-center">
                {{ showPublishedDocuments ? '暂无已发布文档' : '暂无文档' }}
              </div>
              <template v-else-if="showPublishedDocuments">
                <div
                  v-for="doc in allDocuments || []"
                  :key="doc.uuid"
                  class="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
                  :class="{ 'bg-primary/10 text-primary': selectedNodeId === doc.uuid }"
                  @click="selectNode(doc.uuid, 'document', doc)"
                >
                  <UIcon name="i-lucide-file-check-2" class="w-4 h-4 shrink-0 text-primary" />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm truncate">
                      {{ doc.title || '未命名文档' }}
                    </p>
                    <p v-if="getPublishInfo(doc)" class="text-xs text-muted truncate">
                      {{ formatPublishText(getPublishInfo(doc)!) }}
                    </p>
                  </div>
                </div>
              </template>
              <FileTreeItem
                v-for="item in treeItems"
                v-else
                :key="item.id"
                :item="item"
                :selected-id="selectedNodeId"
                :expanded-ids="expandedFolders"
                :editing-id="editingId"
                :editing-name="editingName"
                :can-mutate="departmentCanWrite"
                :can-delete="isDepartmentManager"
                @select="(id: string, type: 'folder' | 'document', data?: unknown) => selectNode(id, type, data as DocRecord | FolderRecord | undefined)"
                @toggle="toggleFolder"
                @start-edit="startEdit"
                @save-edit="saveEdit"
                @cancel-edit="cancelEdit"
                @delete="confirmDelete"
                @update:editing-name="(val) => editingName = val"
              />
            </div>

            <!-- 回收站文档列表 -->
            <div v-else class="space-y-0.5">
              <div v-if="trashLoading" class="px-2 py-2 text-xs text-muted text-center">
                正在加载...
              </div>
              <div v-else-if="trashDocuments.length === 0" class="px-2 py-2 text-xs text-muted text-center">
                回收站为空
              </div>
              <template v-else>
                <div
                  v-for="doc in trashDocuments"
                  :key="doc.uuid"
                  class="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
                  :class="{ 'bg-primary/10 text-primary': selectedNodeId === doc.uuid }"
                  @click="selectNode(doc.uuid, 'document', doc)"
                >
                  <UIcon name="i-lucide-file-x-2" class="w-4 h-4 shrink-0 text-gray-400" />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm truncate">
                      {{ doc.title || '未命名文档' }}
                    </p>
                    <p v-if="doc.deleted_at" class="text-xs text-muted truncate">
                      {{ formatDeletedAt(doc.deleted_at) }}
                    </p>
                  </div>
                  <UButton
                    v-if="doc && isDepartmentManager"
                    icon="i-lucide-archive-restore"
                    size="xs"
                    color="primary"
                    variant="ghost"
                    class="opacity-0 group-hover:opacity-100"
                    @click.stop="restoreDoc = toRestoreRecord(doc); showRestoreModal = true"
                  />
                </div>
              </template>
            </div>
          </ClientOnly>
        </div>
      </aside>
      <!-- 拖拽调整宽度把手（aside 的兄弟元素，避免随内容滚动） -->
      <div
        v-if="!panelCollapsed"
        class="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-default hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 -ml-px"
        @mousedown.prevent="onResizeStart"
      />

      <!-- Right: Preview Panel -->
      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <!-- Recycle Bin Toolbar -->
        <div
          v-if="showRecycleBin && selectedNodeType === 'document'"
          class="flex items-center justify-between px-4 py-3 border-b border-default bg-default"
        >
          <div class="flex flex-col gap-1 min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <UIcon name="i-lucide-file-x-2" class="w-5 h-5 text-gray-400 shrink-0" />
              <span class="font-medium truncate">{{ previewDoc?.title }}</span>
              <span v-if="previewDoc?.deleted_at" class="text-xs text-muted shrink-0">
                ({{ formatDeletedAt(previewDoc.deleted_at) }})
              </span>
            </div>
            <div class="flex items-center gap-1 text-xs text-muted pl-7">
              <UIcon name="i-lucide-folder" class="w-3.5 h-3.5" />
              <span v-if="previewDoc && previewDoc.folder_id">
                {{ formatDocLocation({ ...previewDoc, id: previewDoc.uuid, docType: previewDoc.doc_type || 'department', ownerUid: previewDoc.owner_uid || '' } as any) }}
              </span>
            </div>
          </div>
          <UButton
            v-if="isDepartmentManager"
            icon="i-lucide-archive-restore"
            size="sm"
            color="primary"
            @click="restoreDoc = toRestoreRecord(previewDoc); showRestoreModal = true"
          >
            恢复
          </UButton>
        </div>

        <!-- Toolbar (只在选中文档时显示) -->
        <div
          v-if="!showRecycleBin && selectedNodeType === 'document' && previewDoc"
          class="flex items-center justify-between px-4 py-3 border-b border-default bg-default"
        >
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="w-5 h-5 text-gray-500" />
            <span class="font-medium">
              {{ previewDoc.title }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <!-- 已归档文档显示归档信息 -->
            <template v-if="getPublishInfo(previewDoc)">
              <span class="text-sm text-gray-500">
                <UIcon name="i-lucide-archive" class="inline" />
                {{ getPublishDisplayText(previewDoc) }}
              </span>
              <UButton
                size="sm"
                icon="i-lucide-list-checks"
                variant="ghost"
                color="neutral"
                @click="showPublishRecord = true"
              >
                发布流程
              </UButton>
            </template>
            <!-- 未归档文档显示编辑/查看按钮 -->
            <UButton
              v-else
              :icon="previewDoc.readonly_flag || !departmentCanWrite ? 'i-lucide-eye' : 'i-lucide-edit'"
              size="sm"
              color="primary"
              @click="navigateToEdit(previewDoc.uuid)"
            >
              {{ previewDoc.readonly_flag || !departmentCanWrite ? '查看' : '编辑' }}
            </UButton>

            <UDropdownMenu v-if="shouldShowDocMenu(previewDoc)" :items="getDocMenuItems(previewDoc)">
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis"
                size="sm"
              />
            </UDropdownMenu>
          </div>
        </div>

        <!-- Preview Content -->
        <div class="flex-1 overflow-auto p-4">
          <!-- Hidden file input -->
          <input
            ref="fileInput"
            type="file"
            multiple
            accept=".md"
            class="hidden"
            @change="handleFileUpload"
          >

          <!-- 回收站模式：未选择文档时的提示 -->
          <div v-if="showRecycleBin && selectedNodeType !== 'document'" class="h-full flex items-center justify-center">
            <div class="text-center">
              <UIcon name="i-lucide-trash-2" class="w-16 h-16 text-muted mx-auto mb-4" />
              <h3 class="text-xl font-semibold text-default mb-2">
                回收站
              </h3>
              <p class="text-sm text-muted">
                从左侧列表选择已删除的文档进行预览
              </p>
              <p class="text-xs text-muted mt-2">
                文档将在删除{{ useRuntimeConfig().public.recycleDays }}天后自动清理
              </p>
            </div>
          </div>

          <!-- 选中根目录或文件夹时显示操作按钮 -->
          <div
            v-if="!showRecycleBin && (selectedNodeType === 'root' || selectedNodeType === 'folder')"
            class="h-full flex items-center justify-center p-4"
          >
            <div class="flex flex-col items-center gap-6 md:gap-8 w-full max-w-2xl">
              <div class="text-center w-full">
                <UIcon
                  :name="showPublishedDocuments ? 'i-lucide-archive' : (selectedNodeType === 'root' ? 'i-lucide-home' : 'i-lucide-folder-open')"
                  class="w-12 h-12 md:w-16 md:h-16 text-primary mx-auto mb-3 md:mb-4"
                />
                <h3 class="text-lg md:text-xl font-semibold text-default mb-2">
                  {{ currentBrowserTitle }}
                </h3>
                <p class="text-xs md:text-sm text-muted">
                  {{ showPublishedDocuments ? '从左侧选择已发布文档进行查看' : '选择一个操作来开始' }}
                </p>
              </div>

              <div
                v-if="!showPublishedDocuments"
                class="grid grid-cols-2 md:flex gap-3 md:gap-6 w-full max-w-[320px] md:max-w-none mx-auto justify-center"
              >
                <!-- 新建文档按钮 -->
                <button
                  v-if="departmentCanWrite"
                  class="group flex flex-col items-center justify-center aspect-square md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all"
                  @click="showNewDocModal = true"
                >
                  <UIcon
                    name="i-lucide-file-plus"
                    class="w-8 h-8 md:w-12 md:h-12 text-gray-400 group-hover:text-primary mb-2 md:mb-3 transition-colors"
                  />
                  <span
                    class="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400 group-hover:text-primary transition-colors"
                  >新建文档</span>
                </button>

                <!-- 新建子目录按钮 -->
                <button
                  v-if="isDepartmentManager"
                  class="group flex flex-col items-center justify-center aspect-square md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all"
                  @click="showNewFolderModal = true"
                >
                  <UIcon
                    name="i-lucide-folder-plus"
                    class="w-8 h-8 md:w-12 md:h-12 text-gray-400 group-hover:text-primary mb-2 md:mb-3 transition-colors"
                  />
                  <span
                    class="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400 group-hover:text-primary transition-colors"
                  >新建子目录</span>
                </button>

                <!-- 上传文档按钮 -->
                <button
                  v-if="departmentCanWrite"
                  class="group flex flex-col items-center justify-center aspect-square md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all"
                  @click="triggerUpload"
                >
                  <UIcon
                    name="i-lucide-upload"
                    class="w-8 h-8 md:w-12 md:h-12 text-gray-400 group-hover:text-primary mb-2 md:mb-3 transition-colors"
                  />
                  <span
                    class="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400 group-hover:text-primary transition-colors"
                  >上传文档</span>
                </button>
              </div>
              <p v-if="!showPublishedDocuments && isDepartmentReadonlyViewer" class="text-sm text-muted text-center">
                当前身份对该部门文档仅有查看权限
              </p>
            </div>
          </div>

          <!-- 文档预览 -->
          <div
            v-else-if="selectedNodeType === 'document'"
            class="max-w-4xl mx-auto bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-full p-0 relative"
          >
            <!-- Loading -->
            <div
              v-if="previewLoading"
              class="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10"
            >
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
            </div>

            <!-- AI 摘要 -->
            <div
              v-if="previewAbstract && !previewLoading"
              class="border-b border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 px-4 py-2.5 rounded-t-lg"
            >
              <div class="flex items-start gap-2">
                <UIcon name="i-lucide-sparkles" class="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <span class="text-xs font-medium text-primary">AI 摘要</span>
                  <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mt-0.5">
                    {{ previewAbstract }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Content -->
            <EditorDocLazyPreview
              v-if="previewContent && !previewLoading"
              :content="previewContent"
            />
          </div>
        </div>
      </main>
    </div>

    <!-- New Document Modal -->
    <UModal v-model:open="showNewDocModal" :ui="{ content: 'w-120' }">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                新建文档
              </h3>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                @click="showNewDocModal = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <UFormField label="文档名称">
              <UInput
                v-model="newDocName"
                placeholder="请输入文档名称"
                autofocus
                class="w-full"
                @keyup.enter="createDocument"
              />
            </UFormField>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showNewDocModal = false">
                取消
              </UButton>
              <UButton color="primary" :loading="isCreating" @click="createDocument">
                创建
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- New Folder Modal -->
    <UModal v-model:open="showNewFolderModal" :ui="{ content: 'w-120' }">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                新建文件夹
              </h3>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                @click="showNewFolderModal = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <UFormField label="文件夹名称">
              <UInput
                v-model="newFolderName"
                placeholder="请输入文件夹名称"
                autofocus
                class="w-full"
                @keyup.enter="createFolder"
              />
            </UFormField>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showNewFolderModal = false">
                取消
              </UButton>
              <UButton color="primary" :loading="isCreating" @click="createFolder">
                创建
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal v-model:open="showDeleteConfirm">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-alert-triangle" class="w-5 h-5 text-red-500" />
              <h3 class="text-lg font-semibold">
                确认删除
              </h3>
            </div>
          </template>

          <p class="text-muted">
            确定要删除{{ deleteTarget?.type === 'folder' ? '文件夹' : '文档' }}
            <strong class="text-default">"{{ deleteTarget?.name }}"</strong> 吗？
          </p>
          <p v-if="deleteTarget?.type === 'folder'" class="text-sm text-muted mt-2">
            注意：如果文件夹不为空，将无法删除。
          </p>
          <p v-if="deleteTarget?.type === 'document'" class="text-sm text-warning mt-2">
            文档将移至回收站，30天后自动清理，届时将不可恢复。
          </p>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="cancelDelete">
                取消
              </UButton>
              <UButton color="error" :loading="isDeleting" @click="executeDelete">
                删除
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- Share Modal -->
    <DocumentShareDocumentModal
      :open="isShareModalOpen"
      :doc-id="sharingDocId"
      :doc-title="sharingDocTitle"
      :dept-code="deptCode"
      @update:open="isShareModalOpen = $event"
    />

    <!-- Move Modal -->
    <MoveFolderModal
      :open="showMoveModal"
      :folders="allFolders || []"
      :current-folder-id="moveDoc?.folder_id ?? null"
      :doc-title="moveDoc?.title || ''"
      @update:open="showMoveModal = $event"
      @confirm="moveDocument"
    />

    <!-- Submit Review Modal -->
    <ReviewSubmitReviewModal
      :open="showSubmitReviewModal"
      :document-uuid="reviewingDoc?.uuid || ''"
      :dept-code="deptCode"
      @update:open="showSubmitReviewModal = $event"
      @success="() => { showSubmitReviewModal = false; reviewingDoc = null; refreshDocs() }"
    />

    <!-- Copy Document Modal -->
    <CopyDocumentModal
      :open="showCopyModal"
      :document-uuid="copyDoc?.uuid || ''"
      :document-title="copyDoc?.title || ''"
      @update:open="showCopyModal = $event"
      @success="onCopySuccess"
    />

    <!-- Restore Modal -->
    <RestoreDocumentModal
      :open="showRestoreModal"
      :doc="restoreDoc"
      @update:open="showRestoreModal = $event"
      @restored="showRestoreModal = false; restoreDoc = null; loadTrashDocuments(); refreshDocs()"
    />
    <ReviewPublishRecordModal
      v-model:open="showPublishRecord"
      :oss-path="String(previewDoc?.oss_path || '')"
      :document-uuid="String(previewDoc?.uuid || '')"
    />
  </UDashboardPanel>
</template>
