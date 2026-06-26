<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

usePageTitle('部门文件柜')

interface CabinetFile {
  id: number
  uuid: string
  filename: string
  original_name: string
  file_ext: string
  file_size: number
  oss_path: string
  owner_uid: string
  dept_code: string
  folder_id: number | null
  converted_doc_uuid: string | null
  created_at: string
  updated_at: string
}

interface CabinetListResponse {
  success: boolean
  data: { items: CabinetFile[] }
}

interface UploadResult {
  success: number
  failed: number
  items: { filename: string, status: string, message?: string }[]
}

interface PreviewResponse {
  success: boolean
  data: {
    previewable: boolean
    preview_type?: 'direct' | 'office' | 'pptx'
    preview_url?: string
    convertible?: boolean
    original_name: string
    file_ext: string
    file_size: number
  }
}

interface ToDocumentResponse {
  success: boolean
  data: {
    uuid: string
    title: string
  }
}

interface ConvertedInfoResponse {
  success: boolean
  data: {
    doc_uuid: string
    doc_title: string
    doc_path: string
  } | null
}

interface CabinetFolder {
  id: number
  name: string
  parent_id: number | null
  owner_uid: string
  dept_code: string
  sort_order: number
  created_at: string
  updated_at: string
}

interface CabinetFoldersResponse {
  success: boolean
  data: { items: CabinetFolder[] }
}

interface DeptTreeNode {
  deptCode: string
  name: string
  orgType?: string
  children?: DeptTreeNode[]
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

const toast = useToast()
const apiFetch = useRequestFetch()
const { user, userDeptCode } = useAuth()
const { setPayload: setDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()
const { departmentsCache, setDepartmentsCache } = useUserDepartmentsCache()
const uid = computed(() => user.value || 'user1')
const currentUid = computed(() => String(user.value || '').trim())

// ==================== 部门 ====================
const deptCode = ref<string>('')
const isDepartmentManager = ref(false)
const departmentCanWrite = ref(false)
const departmentAccessPending = ref(false)
const userDepartments = ref<DeptTreeNode[]>([])

const flatDepartments = computed(() => {
  const result: Array<{ deptCode: string, name: string, icon: string }> = []
  const flatten = (nodes: DeptTreeNode[]) => {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        flatten(node.children)
      } else {
        result.push({
          deptCode: node.deptCode,
          name: node.name,
          icon: node.orgType === 'committee' ? 'i-lucide-users' : 'i-lucide-building'
        })
      }
    }
  }
  flatten(userDepartments.value)
  return result
})

const hasMultipleDepts = computed(() => flatDepartments.value.length > 1)

const selectedDept = computed({
  get: () => flatDepartments.value.find(d => d.deptCode === deptCode.value) || undefined,
  set: (dept) => {
    if (dept && dept.deptCode !== deptCode.value) {
      switchDepartment(dept.deptCode)
    }
  }
})

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

    const isWritableMember = isDeptManager || isDeptMember
    const isReadonlyRole = isDeptLeader || (!isWritableMember && isParentReadonlyRole)

    isDepartmentManager.value = isDeptManager
    departmentCanWrite.value = !isReadonlyRole && isWritableMember
  } catch (error) {
    console.error('[Dept Cabinet] Failed to resolve department access:', error)
    isDepartmentManager.value = false
    departmentCanWrite.value = false
  } finally {
    departmentAccessPending.value = false
  }
}

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
      } else if (response.data.primaryDeptCode) {
        deptCode.value = response.data.primaryDeptCode
      } else if (userDepartments.value.length > 0) {
        deptCode.value = userDepartments.value[0]?.deptCode ?? ''
      }
    }
  } catch (error) {
    console.error('[Dept Cabinet] Failed to fetch user departments:', error)
  }

  if (!deptCode.value && userDeptCode.value) {
    deptCode.value = userDeptCode.value
  }
}

await initDeptCode()

const switchDepartment = (newDeptCode: string) => {
  if (newDeptCode === deptCode.value) return
  deptCode.value = newDeptCode
  try {
    if (import.meta.client) localStorage.setItem('coworks_dept', newDeptCode)
  } catch { /* ignore */ }
  currentFolderId.value = null
  folderPath.value = []
  deselectFile()
  refresh()
  refreshFolderList()
}

// ==================== 文件夹 ====================
const currentFolderId = ref<number | null>(null)
const folderPath = ref<CabinetFolder[]>([]) // 面包屑路径
const allFolders = ref<CabinetFolder[]>([])

// 当前目录下的子文件夹
const currentSubFolders = computed(() => {
  return allFolders.value.filter(f => f.parent_id === currentFolderId.value)
})

// 获取文件夹列表
const fetchFolderList = async () => {
  if (!deptCode.value) return []
  const response = await $fetch<CabinetFoldersResponse>('/api/dept-cabinet/folders', {
    query: { dept_code: deptCode.value }
  })
  return response?.data?.items || []
}

const refreshFolderList = async () => {
  allFolders.value = await fetchFolderList()
}

// 进入文件夹
const enterFolder = (folder: CabinetFolder) => {
  currentFolderId.value = folder.id
  folderPath.value = buildFolderPath(folder.id)
  deselectFile()
  refresh()
}

// 返回上级目录
const goToFolder = (folderId: number | null) => {
  currentFolderId.value = folderId
  folderPath.value = folderId ? buildFolderPath(folderId) : []
  deselectFile()
  refresh()
}

// 构建面包屑路径
const buildFolderPath = (folderId: number): CabinetFolder[] => {
  const path: CabinetFolder[] = []
  let currentId: number | null = folderId
  while (currentId) {
    const folder = allFolders.value.find(f => f.id === currentId)
    if (!folder) break
    path.unshift(folder)
    currentId = folder.parent_id
  }
  return path
}

// 新建文件夹
const showNewFolderModal = ref(false)
const newFolderName = ref('')
const isCreatingFolder = ref(false)

const openNewFolderModal = () => {
  if (!ensureWritable()) return
  newFolderName.value = ''
  showNewFolderModal.value = true
}

const createFolder = async () => {
  if (!newFolderName.value.trim()) return
  isCreatingFolder.value = true
  try {
    await $fetch('/api/dept-cabinet/folders', {
      method: 'POST',
      body: {
        name: newFolderName.value.trim(),
        dept_code: deptCode.value,
        parent_id: currentFolderId.value,
        owner_uid: uid.value
      }
    })
    toast.add({ title: '文件夹创建成功', color: 'success' })
    showNewFolderModal.value = false
    await refreshFolderList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || error.message || '创建失败', color: 'error' })
  } finally {
    isCreatingFolder.value = false
  }
}

// 重命名文件夹
const renamingFolderId = ref<number | null>(null)
const renamingFolderName = ref('')

const startRenameFolder = (folder: CabinetFolder) => {
  if (!ensureWritable()) return
  renamingFolderId.value = folder.id
  renamingFolderName.value = folder.name
}

const executeRenameFolder = async () => {
  if (!renamingFolderId.value || !renamingFolderName.value.trim()) return
  try {
    await $fetch(`/api/dept-cabinet/folders/${renamingFolderId.value}`, {
      method: 'PATCH',
      body: { name: renamingFolderName.value.trim() }
    })
    toast.add({ title: '重命名成功', color: 'success' })
    await refreshFolderList()
    // 更新面包屑
    if (currentFolderId.value) {
      folderPath.value = buildFolderPath(currentFolderId.value)
    }
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || error.message || '重命名失败', color: 'error' })
  } finally {
    renamingFolderId.value = null
  }
}

const cancelRenameFolder = () => {
  renamingFolderId.value = null
}

// 重命名文件
const renamingFileUuid = ref<string | null>(null)
const renamingFileName = ref('')

const startRenameFile = (file: CabinetFile) => {
  if (!ensureWritable()) return
  renamingFileUuid.value = file.uuid
  // 去掉扩展名编辑
  renamingFileName.value = file.original_name.replace(/\.[^.]+$/, '')
}

const executeRenameFile = async (file: CabinetFile) => {
  if (!renamingFileUuid.value || !renamingFileName.value.trim()) {
    renamingFileUuid.value = null
    return
  }
  const newName = renamingFileName.value.trim() + '.' + file.file_ext
  if (newName === file.original_name) {
    renamingFileUuid.value = null
    return
  }
  try {
    await $fetch(`/api/dept-cabinet/${file.uuid}`, {
      method: 'PATCH',
      body: { filename: newName }
    })
    file.original_name = newName
    toast.add({ title: '重命名成功', color: 'success' })
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || error.message || '重命名失败', color: 'error' })
  } finally {
    renamingFileUuid.value = null
  }
}

const cancelRenameFile = () => {
  renamingFileUuid.value = null
}

// 删除文件夹
const showDeleteFolderConfirm = ref(false)
const deleteFolderTarget = ref<CabinetFolder | null>(null)
const isDeletingFolder = ref(false)

const confirmDeleteFolder = (folder: CabinetFolder) => {
  if (!ensureWritable()) return
  deleteFolderTarget.value = folder
  showDeleteFolderConfirm.value = true
}

const executeDeleteFolder = async () => {
  if (!deleteFolderTarget.value) return
  isDeletingFolder.value = true
  try {
    await $fetch(`/api/dept-cabinet/folders/${deleteFolderTarget.value.id}`, { method: 'DELETE' })
    toast.add({ title: '文件夹已删除', color: 'success' })
    await refreshFolderList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || error.message || '删除失败', color: 'error' })
  } finally {
    isDeletingFolder.value = false
    showDeleteFolderConfirm.value = false
    deleteFolderTarget.value = null
  }
}

// 移动文件到文件夹
const showMoveModal = ref(false)
const moveTarget = ref<CabinetFile | null>(null)
const moveToFolderId = ref<number | null>(null)

const openMoveModal = (file: CabinetFile) => {
  if (!ensureWritable()) return
  moveTarget.value = file
  moveToFolderId.value = file.folder_id
  showMoveModal.value = true
}

const executeMove = async () => {
  if (!moveTarget.value) return
  try {
    await $fetch(`/api/dept-cabinet/${moveTarget.value.uuid}`, {
      method: 'PATCH',
      body: { folder_id: moveToFolderId.value }
    })
    toast.add({ title: '文件已移动', color: 'success' })
    showMoveModal.value = false
    await refresh()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || error.message || '移动失败', color: 'error' })
  }
}

// 权限
const { hasPermission } = usePermissions()
const isAdmin = computed(() => hasPermission('departments', 'admin'))

// ==================== 文件柜 ====================
const { panelWidth, panelCollapsed, onResizeStart } = useResizablePanel(260)
const showMobileSidebar = ref(false)

// Upload state
const fileInput = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)
const uploadProgress = ref('')

// Selection & Preview state
const selectedFileUuid = ref<string | null>(null)
const previewFile = ref<CabinetFile | null>(null)
const previewData = ref<PreviewResponse['data'] | null>(null)
const previewLoading = ref(false)
const showingPreview = ref(false)
const convertedInfo = ref<ConvertedInfoResponse['data']>(null)

// 发布 PDF 到公司目录
const showPublishModal = ref(false)
const publishTarget = ref('')
const publishing = ref(false)
const publishTargets = [
  { label: '公司制度', value: 'rules' },
  { label: '通知公告', value: 'notices' },
  { label: '企业文化', value: 'culture' },
  { label: '法务合规', value: 'legal' },
  { label: '技术规范', value: 'tech-specs' },
  { label: '公司知识库', value: 'knowledge' },
  { label: '文档模板', value: 'templates' }
]

const handlePublishPdf = async () => {
  if (!previewFile.value || !publishTarget.value) return
  publishing.value = true
  try {
    await $fetch('/api/dept-cabinet/publish', {
      method: 'POST',
      body: {
        fileUuid: previewFile.value.uuid,
        targetCategory: publishTarget.value
      }
    })
    toast.add({ title: '发布成功', color: 'success' })
    showPublishModal.value = false
    publishTarget.value = ''
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || '发布失败', color: 'error' })
  } finally {
    publishing.value = false
  }
}

// 查看转存文档模式
const viewingDoc = ref(false)
const viewingDocContent = ref('')
const viewingDocLoading = ref(false)
let viewingDocRequestId = 0

// Delete state
const showDeleteConfirm = ref(false)
const deleteTarget = ref<CabinetFile | null>(null)
const isDeleting = ref(false)

// Fetch files
const fetchFiles = async () => {
  if (!deptCode.value) return []
  const query: Record<string, unknown> = { dept_code: deptCode.value }
  if (currentFolderId.value !== null) {
    query.folder_id = currentFolderId.value
  }
  const response = await $fetch<CabinetListResponse>('/api/dept-cabinet', {
    query
  })
  return response?.data?.items || []
}

const { data: files, pending, refresh } = await useAsyncData(
  'dept-cabinet-files',
  fetchFiles,
  {
    watch: [deptCode, currentFolderId],
    immediate: true,
    getCachedData: () => undefined
  }
)

// 初始加载文件夹列表
await refreshFolderList()

// 加载部门权限
watch(deptCode, () => {
  if (deptCode.value) loadDepartmentAccess()
}, { immediate: true })

// File icon mapping
const getFileIcon = (ext: string): string => {
  const iconMap: Record<string, string> = {
    'pdf': 'i-lucide-file-text',
    'doc': 'i-lucide-file-type',
    'docx': 'i-lucide-file-type',
    'ppt': 'i-lucide-presentation',
    'pptx': 'i-lucide-presentation',
    'xls': 'i-lucide-file-spreadsheet',
    'xlsx': 'i-lucide-file-spreadsheet',
    'zip': 'i-lucide-file-archive',
    'rar': 'i-lucide-file-archive',
    '7z': 'i-lucide-file-archive',
    'png': 'i-lucide-file-image',
    'jpg': 'i-lucide-file-image',
    'jpeg': 'i-lucide-file-image',
    'gif': 'i-lucide-file-image',
    'webp': 'i-lucide-file-image',
    'svg': 'i-lucide-file-image',
    'mp4': 'i-lucide-file-video',
    'mp3': 'i-lucide-file-audio',
    'wav': 'i-lucide-file-audio',
    'txt': 'i-lucide-file-text',
    'csv': 'i-lucide-file-spreadsheet',
    'json': 'i-lucide-file-json',
    'xml': 'i-lucide-file-code',
    'html': 'i-lucide-file-code',
    'css': 'i-lucide-file-code',
    'js': 'i-lucide-file-code',
    'ts': 'i-lucide-file-code',
    'java': 'i-lucide-file-code',
    'py': 'i-lucide-file-code',
    'go': 'i-lucide-file-code',
    'rs': 'i-lucide-file-code',
    'sql': 'i-lucide-file-code',
    'sh': 'i-lucide-file-terminal'
  }
  return iconMap[ext] || 'i-lucide-file'
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`

  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`
}

const isImageExt = (ext: string): boolean => {
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext)
}

// Select file
const selectFile = async (file: CabinetFile) => {
  if (selectedFileUuid.value === file.uuid && previewFile.value) return

  selectedFileUuid.value = file.uuid
  previewFile.value = file
  previewLoading.value = true
  previewData.value = null
  convertedInfo.value = null
  showingPreview.value = false
  resetViewingDocState()
  showMobileSidebar.value = false

  try {
    const response = await $fetch<PreviewResponse>(`/api/dept-cabinet/${file.uuid}/preview`)
    if (response.success) {
      previewData.value = response.data
    }
  } catch {
    toast.add({ title: '获取文件信息失败', color: 'error' })
  } finally {
    previewLoading.value = false
  }

  if (file.converted_doc_uuid) {
    try {
      const info = await $fetch<ConvertedInfoResponse>(`/api/dept-cabinet/${file.uuid}/converted-info`)
      if (info.success && info.data) {
        convertedInfo.value = info.data
      }
    } catch {
      // 忽略
    }
  }
}

const openPreviewContent = () => {
  showingPreview.value = true
}

const resetViewingDocState = () => {
  viewingDocRequestId += 1
  viewingDoc.value = false
  viewingDocLoading.value = false
  viewingDocContent.value = ''
}

const backToFileInfo = () => {
  showingPreview.value = false
  resetViewingDocState()
}

const openConvertedDoc = async () => {
  if (!convertedInfo.value) return

  const requestId = ++viewingDocRequestId
  viewingDoc.value = true
  showingPreview.value = false
  viewingDocLoading.value = true
  viewingDocContent.value = ''

  try {
    const response = await $fetch<{ success: boolean, data: { content?: string } }>(`/api/documents/${convertedInfo.value.doc_uuid}`)
    if (requestId !== viewingDocRequestId) return

    if (response.success && response.data) {
      viewingDocContent.value = response.data.content || ''
    }
  } catch {
    if (requestId !== viewingDocRequestId) return
    toast.add({ title: '加载文档失败', color: 'error' })
    resetViewingDocState()
  } finally {
    if (requestId === viewingDocRequestId) {
      viewingDocLoading.value = false
    }
  }
}

const navigateToConvertedDoc = () => {
  if (!convertedInfo.value) return

  if (viewingDoc.value && viewingDocContent.value) {
    setDocumentPreviewBootstrap(convertedInfo.value.doc_uuid, {
      content: viewingDocContent.value
    })
  }

  navigateTo(`/documents/${convertedInfo.value.doc_uuid}`)
}

const deselectFile = () => {
  selectedFileUuid.value = null
  previewFile.value = null
  previewData.value = null
  convertedInfo.value = null
  showingPreview.value = false
  resetViewingDocState()
}

// Upload
const ensureWritable = () => {
  if (departmentCanWrite.value) return true
  toast.add({ title: '当前身份仅可查看该部门文件柜', color: 'warning' })
  return false
}

const triggerUpload = () => {
  if (!ensureWritable()) return
  fileInput.value?.click()
}

const handleFileUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return

  const fileList = Array.from(input.files)

  const oversized = fileList.filter(f => f.size > 100 * 1024 * 1024)
  if (oversized.length > 0) {
    toast.add({
      title: `${oversized.map(f => f.name).join(', ')} 超过 100MB 限制`,
      color: 'error'
    })
    input.value = ''
    return
  }

  const mdFiles = fileList.filter(f => f.name.toLowerCase().endsWith('.md'))
  if (mdFiles.length > 0) {
    toast.add({
      title: 'Markdown 文件请使用文档管理功能',
      color: 'warning'
    })
  }

  const validFiles = fileList.filter(f => !f.name.toLowerCase().endsWith('.md'))
  if (validFiles.length === 0) {
    input.value = ''
    return
  }

  isUploading.value = true
  uploadProgress.value = `正在上传 ${validFiles.length} 个文件...`

  const formData = new FormData()
  formData.append('owner_uid', uid.value)
  formData.append('dept_code', deptCode.value)
  if (currentFolderId.value !== null) {
    formData.append('folder_id', String(currentFolderId.value))
  }
  validFiles.forEach(file => formData.append('files', file))

  try {
    const result = await $fetch<UploadResult>('/api/dept-cabinet/upload', {
      method: 'POST',
      body: formData
    })

    if (result.success > 0) {
      toast.add({ title: `成功上传 ${result.success} 个文件`, color: 'success' })
      await refresh()
    }
    if (result.failed > 0) {
      const failedItems = result.items.filter(i => i.status === 'error')
      const msg = failedItems.map(i => `${i.filename}: ${i.message}`).join('; ')
      toast.add({ title: `${result.failed} 个文件上传失败`, description: msg, color: 'error' })
    }
  } catch (err: unknown) {
    const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err
      ? Number((err as { statusCode?: unknown }).statusCode)
      : undefined
    const statusMessage = typeof err === 'object' && err !== null && 'statusMessage' in err
      ? String((err as { statusMessage?: unknown }).statusMessage || '')
      : ''
    const message = statusCode === 413
      ? '上传失败：当前服务器上传大小限制小于 100MB，请联系管理员调整网关或 Nginx 的 client_max_body_size 配置'
      : err instanceof Error
        ? err.message
        : statusMessage || '上传失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    isUploading.value = false
    uploadProgress.value = ''
    input.value = ''
  }
}

// Download
const downloadFile = (uuid: string) => {
  const link = document.createElement('a')
  link.href = `/api/dept-cabinet/${uuid}/download`
  link.download = ''
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// Delete
const confirmDelete = (file: CabinetFile) => {
  if (!ensureWritable()) return
  deleteTarget.value = file
  showDeleteConfirm.value = true
}

const executeDelete = async () => {
  if (!deleteTarget.value) return
  isDeleting.value = true

  try {
    await $fetch(`/api/dept-cabinet/${deleteTarget.value.uuid}`, { method: 'DELETE' })
    toast.add({ title: '文件已删除', color: 'success' })

    if (previewFile.value?.uuid === deleteTarget.value.uuid) {
      deselectFile()
    }

    await refresh()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '删除失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    isDeleting.value = false
    showDeleteConfirm.value = false
    deleteTarget.value = null
  }
}

// Convert to document modal
const isConverting = ref(false)
const showConvertModal = ref(false)
const convertDocName = ref('')
const convertFolderId = ref<number | null>(null)
const convertTargetFile = ref<CabinetFile | null>(null)
const convertError = ref('')
const convertNameInput = ref<{ inputRef?: { el?: HTMLInputElement } } | null>(null)

interface FolderRecord {
  id: number
  name: string
  parent_id: number | null
}

// 获取部门文件夹列表（用于转存时选择目录）
const { data: deptFolders, refresh: refreshFolders } = await useAsyncData(
  'dept-cabinet-folders',
  async () => {
    if (!deptCode.value) return []
    const response = await apiFetch<{ data: { items: FolderRecord[] } }>('/api/folders', {
      query: { folder_type: 'department', dept_code: deptCode.value }
    })
    return response?.data?.items || []
  },
  { watch: [deptCode], immediate: true, getCachedData: () => undefined }
)

const openConvertModal = (file: CabinetFile) => {
  if (!ensureWritable()) return
  convertTargetFile.value = file
  convertDocName.value = file.original_name.replace(/\.[^.]+$/, '')
  convertFolderId.value = null
  convertError.value = ''
  showConvertModal.value = true
  refreshFolders()
}

const executeConvert = async () => {
  if (!convertTargetFile.value || !convertDocName.value.trim()) return

  isConverting.value = true
  try {
    const result = await $fetch<ToDocumentResponse>(`/api/dept-cabinet/${convertTargetFile.value.uuid}/to-document`, {
      method: 'POST',
      body: {
        title: convertDocName.value.trim(),
        folder_id: convertFolderId.value
      }
    })
    if (result.success && result.data) {
      toast.add({
        title: `已转存为文档「${result.data.title}」`,
        color: 'success'
      })
      showConvertModal.value = false

      if (previewFile.value) {
        previewFile.value.converted_doc_uuid = result.data.uuid
      }
      try {
        const info = await $fetch<ConvertedInfoResponse>(`/api/dept-cabinet/${convertTargetFile.value!.uuid}/converted-info`)
        if (info.success && info.data) {
          convertedInfo.value = info.data
        }
      } catch {
        convertedInfo.value = {
          doc_uuid: result.data.uuid,
          doc_title: result.data.title,
          doc_path: '部门文档/' + result.data.title + '.md'
        }
      }
      await refresh()
    }
  } catch (err: unknown) {
    const error = err as { data?: { message?: string, statusCode?: number }, message?: string }
    const message = error.data?.message || error.message || '转存失败'
    if (message.includes('同名文档')) {
      convertError.value = message
      nextTick(() => {
        const el = convertNameInput.value?.inputRef?.el
          || (convertNameInput.value as unknown as { $el?: HTMLElement })?.$el?.querySelector?.('input')
        if (el instanceof HTMLInputElement) {
          el.focus()
          el.select()
        }
      })
    } else {
      toast.add({ title: message, color: 'error' })
    }
  } finally {
    isConverting.value = false
  }
}

// Drag and drop
const isDragging = ref(false)

const handleDragOver = (e: DragEvent) => {
  e.preventDefault()
  isDragging.value = true
}

const handleDragLeave = () => {
  isDragging.value = false
}

const handleDrop = async (e: DragEvent) => {
  e.preventDefault()
  isDragging.value = false

  if (!ensureWritable()) return
  if (!e.dataTransfer?.files?.length) return

  const dt = new DataTransfer()
  Array.from(e.dataTransfer.files).forEach(f => dt.items.add(f))

  if (fileInput.value) {
    fileInput.value.files = dt.files
    fileInput.value.dispatchEvent(new Event('change'))
  }
}
</script>

<template>
  <UDashboardPanel grow>
    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      multiple
      accept=".doc,.docx,.ppt,.pptx,.pdf,.txt,.csv,.rtf,.zip,.rar,.7z,.png,.jpg,.jpeg,.gif,.bmp,.webp,.svg,.mp4,.mp3,.wav,.json,.xml,.yaml,.yml,.html,.css,.js,.ts,.java,.py,.go,.rs,.c,.cpp,.h,.sql,.sh,.bat,.tar,.gz,.mov,.xls,.xlsx"
      class="hidden"
      @change="handleFileUpload"
    >

    <!-- Two-column layout -->
    <div
      class="flex flex-1 overflow-hidden relative"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <!-- Drag overlay -->
      <div
        v-if="isDragging"
        class="absolute inset-0 z-50 bg-primary/10 flex items-center justify-center pointer-events-none"
      >
        <div class="bg-default rounded-2xl p-4 shadow-lg border-2 border-dashed border-primary">
          <UIcon name="i-lucide-upload" class="w-12 h-12 text-primary mx-auto mb-3" />
          <p class="text-lg font-medium text-primary">
            释放鼠标上传文件
          </p>
        </div>
      </div>

      <!-- Mobile Sidebar Overlay -->
      <div
        v-if="showMobileSidebar"
        class="absolute inset-0 bg-black/50 dark:bg-black/80 z-20 md:hidden"
        @click="showMobileSidebar = false"
      />

      <!-- Left: File List -->
      <aside
        v-if="!panelCollapsed"
        class="absolute md:relative inset-y-0 left-0 z-30 border-r border-default bg-default flex flex-col overflow-y-auto transform transition-transform duration-200"
        :class="[showMobileSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0']"
        :style="{ width: panelWidth + 'px' }"
      >
        <div class="flex-1">
          <!-- 部门选择 -->
          <div v-if="hasMultipleDepts" class="px-4 pt-2 pb-1">
            <label class="text-xs text-muted mb-1 block">选择部门</label>
            <USelectMenu
              v-model="selectedDept"
              :items="flatDepartments"
              label-key="name"
              placeholder="请选择部门"
              size="lg"
              class="w-full"
            >
              <template #leading>
                <UIcon v-if="selectedDept" :name="selectedDept.icon" class="size-4 text-muted" />
              </template>
            </USelectMenu>
          </div>

          <!-- 面包屑导航 -->
          <div v-if="currentFolderId !== null" class="flex items-center gap-0.5 px-2 pt-2 pb-1 text-xs text-muted overflow-x-auto">
            <button
              class="shrink-0 hover:text-primary transition-colors px-1 py-0.5 rounded hover:bg-primary/5"
              @click="goToFolder(null)"
            >
              根目录
            </button>
            <template v-for="(bf, idx) in folderPath" :key="bf.id">
              <UIcon name="i-lucide-chevron-right" class="w-3 h-3 shrink-0" />
              <button
                v-if="idx < folderPath.length - 1"
                class="shrink-0 hover:text-primary transition-colors px-1 py-0.5 rounded hover:bg-primary/5 truncate max-w-24"
                :title="bf.name"
                @click="goToFolder(bf.id)"
              >
                {{ bf.name }}
              </button>
              <span v-else class="text-default font-medium truncate max-w-24" :title="bf.name">{{ bf.name }}</span>
            </template>
          </div>

          <!-- 操作按钮栏 -->
          <div v-if="departmentCanWrite" class="flex items-center gap-1 px-2 pt-1.5 pb-0.5">
            <UButton
              icon="i-lucide-folder-plus"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="openNewFolderModal"
            >
              新建目录
            </UButton>
          </div>

          <!-- Loading -->
          <div v-if="pending" class="px-2 py-8 text-sm text-muted text-center">
            <UIcon name="i-lucide-loader-2" class="w-5 h-5 text-primary animate-spin mx-auto mb-2" />
            加载中...
          </div>

          <!-- Upload progress -->
          <div v-else-if="isUploading" class="px-2 py-8 text-sm text-muted text-center">
            <UIcon name="i-lucide-loader-2" class="w-5 h-5 text-primary animate-spin mx-auto mb-2" />
            {{ uploadProgress }}
          </div>

          <!-- Empty (no folders and no files) -->
          <div v-else-if="currentSubFolders.length === 0 && (!files || files.length === 0)" class="px-4 py-8 text-center">
            <UIcon name="i-lucide-archive" class="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
            <p class="text-sm text-muted mb-3">
              {{ currentFolderId !== null ? '当前目录为空' : '部门文件柜是空的' }}
            </p>
            <UButton
              v-if="departmentCanWrite"
              icon="i-lucide-upload"
              color="primary"
              size="sm"
              @click="triggerUpload"
            >
              上传文件
            </UButton>
          </div>

          <!-- Folder & File list -->
          <div v-else class="p-1">
            <!-- 子文件夹 -->
            <template v-if="currentSubFolders.length > 0">
              <div
                v-for="folder in currentSubFolders"
                :key="'folder-' + folder.id"
                class="group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 text-default cursor-pointer"
                @click="renamingFolderId === folder.id ? undefined : enterFolder(folder)"
              >
                <div class="w-8 h-8 rounded-md flex items-center justify-center shrink-0 bg-amber-50 dark:bg-amber-950">
                  <UIcon name="i-lucide-folder" class="w-4 h-4 text-amber-500" />
                </div>
                <div v-if="renamingFolderId === folder.id" class="min-w-0 flex-1 flex items-center gap-1" @click.stop>
                  <input
                    v-model="renamingFolderName"
                    class="flex-1 text-sm bg-transparent border border-primary rounded px-1.5 py-0.5 outline-none min-w-0"
                    autofocus
                    @keyup.enter="executeRenameFolder"
                    @keyup.escape="cancelRenameFolder"
                    @blur="executeRenameFolder"
                  >
                </div>
                <div v-else class="min-w-0 flex-1">
                  <p class="text-sm font-medium truncate" :title="folder.name">
                    {{ folder.name }}
                  </p>
                </div>
                <!-- 文件夹操作菜单 -->
                <UDropdownMenu
                  v-if="departmentCanWrite && renamingFolderId !== folder.id"
                  :items="[
                    [{
                      label: '重命名',
                      icon: 'i-lucide-pencil',
                      onSelect: () => startRenameFolder(folder)
                    }],
                    [{
                      label: '删除',
                      icon: 'i-lucide-trash-2',
                      color: 'error' as const,
                      onSelect: () => confirmDeleteFolder(folder)
                    }]
                  ]"
                >
                  <UButton
                    class="opacity-0 group-hover:opacity-100 shrink-0"
                    icon="i-lucide-ellipsis"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    @click.stop
                  />
                </UDropdownMenu>
              </div>
            </template>

            <!-- 分隔线（有文件夹又有文件时） -->
            <div v-if="currentSubFolders.length > 0 && files && files.length > 0" class="border-t border-default my-1" />

            <!-- 文件列表 -->
            <div v-if="files && files.length > 0" class="px-2 py-1.5 text-xs text-muted">
              共 {{ files.length }} 个文件
            </div>
            <div
              v-for="file in files"
              :key="file.uuid"
              class="group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer"
              :class="[
                selectedFileUuid === file.uuid
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-default'
              ]"
              @click="selectFile(file)"
            >
              <div
                class="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                :class="selectedFileUuid === file.uuid ? 'bg-primary/20' : 'bg-gray-100 dark:bg-gray-800'"
              >
                <UIcon
                  :name="getFileIcon(file.file_ext)"
                  class="w-4 h-4"
                  :class="selectedFileUuid === file.uuid ? 'text-primary' : 'text-gray-500'"
                />
              </div>
              <!-- 重命名编辑态 -->
              <div v-if="renamingFileUuid === file.uuid" class="min-w-0 flex-1 flex items-center gap-0.5" @click.stop>
                <input
                  v-model="renamingFileName"
                  class="flex-1 text-sm bg-transparent border border-primary rounded px-1.5 py-0.5 outline-none min-w-0"
                  autofocus
                  @keyup.enter="executeRenameFile(file)"
                  @keyup.escape="cancelRenameFile"
                  @blur="executeRenameFile(file)"
                >
                <span class="text-xs text-muted shrink-0">.{{ file.file_ext }}</span>
              </div>
              <!-- 正常显示态 -->
              <div v-else class="min-w-0 flex-1" @dblclick.stop="startRenameFile(file)">
                <p class="text-sm font-medium truncate" :title="file.original_name">
                  {{ file.original_name }}
                </p>
                <p class="text-xs text-muted">
                  {{ formatSize(file.file_size) }} · {{ formatDate(file.created_at) }}
                </p>
              </div>
              <!-- 文件操作菜单 -->
              <UDropdownMenu
                v-if="departmentCanWrite && renamingFileUuid !== file.uuid"
                :items="[
                  [{
                     label: '重命名',
                     icon: 'i-lucide-pencil',
                     onSelect: () => startRenameFile(file)
                   },
                   {
                     label: '移动到...',
                     icon: 'i-lucide-folder-input',
                     onSelect: () => openMoveModal(file)
                   }],
                  [{
                    label: '删除',
                    icon: 'i-lucide-trash-2',
                    color: 'error' as const,
                    onSelect: () => confirmDelete(file)
                  }]
                ]"
              >
                <UButton
                  class="opacity-0 group-hover:opacity-100 shrink-0"
                  icon="i-lucide-ellipsis"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click.stop
                />
              </UDropdownMenu>
            </div>
          </div>
        </div>
      </aside>

      <!-- Resize handle -->
      <div
        v-if="!panelCollapsed"
        class="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-default hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 -ml-px"
        @mousedown.prevent="onResizeStart"
      />

      <!-- Right: Preview Panel -->
      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <!-- Toolbar (选中文件时显示) -->
        <div
          v-if="previewFile"
          class="flex flex-col sm:flex-row sm:items-center justify-between px-0 py-0 border-b border-default bg-default gap-3 sm:gap-0"
        >
          <div class="flex items-center gap-1 text-sm font-medium overflow-hidden">
            <UButton
              class="md:hidden shrink-0 mr-1"
              icon="i-lucide-menu"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="showMobileSidebar = true"
            />
            <button
              class="text-primary hover:underline transition-colors px-1 py-0.5 rounded hover:bg-primary/5"
              @click="deselectFile"
            >
              文件柜
            </button>
            <UIcon name="i-lucide-chevron-right" class="w-3.5 h-3.5 text-muted shrink-0" />
            <button
              class="flex items-center gap-1.5 px-1 py-0.5 min-w-0"
              :class="viewingDoc ? 'text-primary hover:underline hover:bg-primary/5 rounded' : ''"
              @click="viewingDoc ? backToFileInfo() : undefined"
            >
              <UIcon :name="getFileIcon(previewFile.file_ext)" class="w-4 h-4 text-gray-500 shrink-0" />
              <span class="truncate" :class="viewingDoc ? '' : 'text-default'" :title="previewFile.original_name">
                {{ previewFile.original_name }}
              </span>
            </button>
            <!-- 查看文档模式：显示文档名 -->
            <template v-if="viewingDoc && convertedInfo">
              <UIcon name="i-lucide-chevron-right" class="w-3.5 h-3.5 text-muted shrink-0" />
              <div class="flex items-center gap-1.5 px-1 py-0.5 min-w-0">
                <UIcon name="i-lucide-file-text" class="w-4 h-4 text-gray-500 shrink-0" />
                <span class="text-default truncate" :title="convertedInfo.doc_title + '.md'">
                  {{ convertedInfo.doc_title }}.md
                </span>
              </div>
            </template>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <!-- 查看转存文档模式 -->
            <template v-if="viewingDoc">
              <UButton
                icon="i-lucide-edit"
                size="sm"
                color="primary"
                @click="navigateToConvertedDoc"
              >
                编辑文档
              </UButton>
              <UButton
                icon="i-lucide-x"
                size="sm"
                color="neutral"
                variant="ghost"
                title="关闭"
                @click="backToFileInfo"
              />
            </template>
            <!-- 原文件预览模式 -->
            <template v-else-if="showingPreview">
              <span class="text-xs text-muted hidden sm:inline">
                {{ previewFile.file_ext.toUpperCase() }} · {{ formatSize(previewFile.file_size) }}
              </span>
              <UButton
                v-if="convertedInfo"
                icon="i-lucide-file-text"
                size="sm"
                color="primary"
                variant="outline"
                @click="openConvertedDoc"
              >
                查看文档
              </UButton>
              <UButton
                v-else-if="previewData?.convertible && departmentCanWrite"
                icon="i-lucide-file-output"
                size="sm"
                color="neutral"
                variant="outline"
                @click="openConvertModal(previewFile)"
              >
                转存
              </UButton>
              <UButton
                v-if="isAdmin && previewFile?.file_ext === 'pdf'"
                icon="i-lucide-send"
                size="xs"
                color="primary"
                variant="outline"
                @click="showPublishModal = true"
              >
                发布
              </UButton>
              <UButton
                icon="i-lucide-x"
                size="sm"
                color="neutral"
                variant="ghost"
                title="关闭预览"
                @click="backToFileInfo"
              />
            </template>
            <!-- 文件信息卡片模式 -->
            <UDropdownMenu
              v-else-if="departmentCanWrite"
              :items="[
                [{
                  label: '移动到...',
                  icon: 'i-lucide-folder-input',
                  onSelect: () => openMoveModal(previewFile!)
                }],
                [{
                  label: '删除',
                  icon: 'i-lucide-trash-2',
                  color: 'error' as const,
                  onSelect: () => confirmDelete(previewFile!)
                }]
              ]"
            >
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
        <div class="flex-1 overflow-auto pt-2 px-0">
          <!-- No file selected: empty state -->
          <div
            v-if="!previewFile"
            class="h-full flex items-center justify-center p-4"
          >
            <div class="flex flex-col items-center gap-6 md:gap-8 w-full max-w-2xl">
              <div class="text-center w-full">
                <UIcon
                  name="i-lucide-archive"
                  class="w-12 h-12 md:w-16 md:h-16 text-primary mx-auto mb-3 md:mb-4"
                />
                <h3 class="text-lg md:text-xl font-semibold text-default mb-2">
                  部门文件柜
                </h3>
                <p class="text-xs md:text-sm text-muted">
                  存储部门共享的 Word、PPT、PDF 等非 Markdown 文件
                </p>
              </div>

              <div v-if="departmentCanWrite" class="flex gap-3 md:gap-6 justify-center">
                <button
                  class="group flex flex-col items-center justify-center w-32 h-32 md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all"
                  @click="triggerUpload"
                >
                  <UIcon
                    name="i-lucide-upload"
                    class="w-8 h-8 md:w-12 md:h-12 text-gray-400 group-hover:text-primary mb-2 md:mb-3 transition-colors"
                  />
                  <span class="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400 group-hover:text-primary transition-colors">上传文件</span>
                </button>
              </div>

              <p class="text-xs text-muted">
                {{ departmentCanWrite ? '支持拖拽上传，单文件不超过 100MB' : '当前身份仅可查看该部门文件柜' }}
              </p>
            </div>
          </div>

          <!-- Viewing converted document -->
          <div
            v-else-if="viewingDoc"
            class="max-w-4xl mx-auto bg-default shadow-sm rounded-lg min-h-full relative border border-default"
          >
            <div
              v-if="viewingDocLoading"
              class="absolute inset-0 flex items-center justify-center bg-default/80 backdrop-blur-sm z-10 rounded-lg"
            >
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
            </div>
            <EditorDocLazyPreview
              v-if="viewingDocContent && !viewingDocLoading"
              :content="viewingDocContent"
            />
          </div>

          <!-- File selected -->
          <div v-else class="max-w-5xl mx-auto w-full relative">
            <!-- Loading -->
            <div
              v-if="previewLoading"
              class="flex items-center justify-center py-24"
            >
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
            </div>

            <!-- File info card (default view after selecting) -->
            <div
              v-else-if="previewData && !showingPreview"
              class="flex items-center justify-center py-8"
            >
              <div class="bg-default border border-default shadow-sm rounded-xl p-8 w-full max-w-md text-center">
                <UIcon
                  :name="getFileIcon(previewData.file_ext)"
                  class="w-20 h-20 text-dimmed mx-auto mb-6"
                />
                <p class="text-lg font-medium text-default mb-1">
                  {{ previewData.original_name }}
                </p>
                <p class="text-sm text-muted mb-1">
                  {{ previewData.file_ext.toUpperCase() }} · {{ formatSize(previewData.file_size) }}
                </p>
                <p class="text-xs text-muted mb-8">
                  上传于 {{ formatDate(previewFile!.created_at) }}
                </p>

                <div class="flex items-center justify-center gap-3">
                  <UButton
                    v-if="previewData.previewable"
                    icon="i-lucide-eye"
                    color="primary"
                    size="lg"
                    @click="openPreviewContent"
                  >
                    预览
                  </UButton>
                  <UButton
                    icon="i-lucide-download"
                    :color="previewData.previewable ? 'neutral' : 'primary'"
                    :variant="previewData.previewable ? 'outline' : 'solid'"
                    size="lg"
                    @click="downloadFile(previewFile!.uuid)"
                  >
                    下载文件
                  </UButton>
                </div>

                <!-- 已转存提示 -->
                <div v-if="convertedInfo" class="mt-4 pt-4 border-t border-default">
                  <div class="flex items-center gap-2 text-sm text-success mb-3">
                    <UIcon name="i-lucide-check-circle" class="w-4 h-4 shrink-0" />
                    <span>本文件已转存为「{{ convertedInfo.doc_path }}」</span>
                  </div>
                  <UButton
                    icon="i-lucide-file-text"
                    color="primary"
                    variant="outline"
                    @click="openConvertedDoc"
                  >
                    查看文档
                  </UButton>
                </div>

                <!-- 转存文档按钮（未转存时显示） -->
                <div v-else-if="previewData.convertible && departmentCanWrite" class="mt-6 pt-6 border-t border-default">
                  <p class="text-xs text-muted mb-3">
                    转换为 Markdown 格式，保存到「部门文档」
                  </p>
                  <UButton
                    icon="i-lucide-file-output"
                    color="neutral"
                    variant="outline"
                    @click="openConvertModal(previewFile!)"
                  >
                    转存文档
                  </UButton>
                </div>

                <p v-if="!previewData.previewable && !previewData.convertible && !convertedInfo" class="text-xs text-muted mt-6">
                  该文件类型暂不支持在线预览
                </p>
              </div>
            </div>

            <!-- Preview content (shown after clicking "预览") -->
            <div
              v-else-if="previewData && showingPreview"
              class="bg-default border border-default shadow-sm rounded-lg min-h-full"
            >
              <CabinetPptxPreview
                v-if="previewData.preview_type === 'pptx' && previewData.preview_url"
                :src="previewData.preview_url"
                :filename="previewData.original_name"
              />

              <!-- Image preview -->
              <div
                v-else-if="isImageExt(previewData.file_ext)"
                class="flex items-center justify-center p-4"
              >
                <img
                  :src="previewData.preview_url"
                  :alt="previewData.original_name"
                  class="max-w-full max-h-[calc(100vh-118px)] object-contain rounded"
                >
              </div>

              <!-- PDF preview -->
              <div
                v-else-if="previewData.file_ext === 'pdf'"
                class="w-full"
              >
                <iframe
                  :src="`${previewData.preview_url}#toolbar=0&view=FitH`"
                  class="w-full h-[calc(100vh-90px)] rounded-b-lg border-0"
                />
              </div>

              <!-- Video preview -->
              <div
                v-else-if="previewData.file_ext === 'mp4'"
                class="flex items-center justify-center p-4"
              >
                <video
                  controls
                  :src="previewData.preview_url"
                  class="max-w-full max-h-[calc(100vh-118px)] rounded"
                />
              </div>

              <!-- Audio preview -->
              <div
                v-else-if="['mp3', 'wav'].includes(previewData.file_ext)"
                class="flex items-center justify-center p-8"
              >
                <div class="w-full max-w-md text-center">
                  <UIcon name="i-lucide-file-audio" class="w-16 h-16 text-primary mx-auto mb-4" />
                  <p class="text-default font-medium mb-4">
                    {{ previewData.original_name }}
                  </p>
                  <audio controls :src="previewData.preview_url" class="w-full" />
                </div>
              </div>

              <!-- Text/code preview (iframe) -->
              <div v-else class="w-full">
                <iframe
                  :src="previewData.preview_url"
                  class="w-full h-[calc(100vh-90px)] rounded-b-lg border-0"
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- Delete Confirmation -->
    <UModal v-model:open="showDeleteConfirm" title="确认删除">
      <template #body>
        <p class="text-sm text-default">
          确定要删除文件 <strong>{{ deleteTarget?.original_name }}</strong> 吗？
        </p>
      </template>
      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="showDeleteConfirm = false">
            取消
          </UButton>
          <UButton
            color="error"
            :loading="isDeleting"
            @click="executeDelete"
          >
            删除
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Convert to Document Modal -->
    <UModal v-model:open="showConvertModal">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                转存文档
              </h3>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                @click="showConvertModal = false"
              />
            </div>
            <p class="text-sm text-muted mt-1">
              将文件转换为 Markdown 格式，保存到「部门文档」
            </p>
          </template>

          <div class="space-y-4">
            <UFormField label="文档名称" :error="convertError">
              <UInput
                ref="convertNameInput"
                v-model="convertDocName"
                placeholder="请输入文档名称"
                autofocus
                :color="convertError ? 'error' : undefined"
                @input="convertError = ''"
                @keyup.enter="executeConvert"
              />
            </UFormField>

            <UFormField label="保存到">
              <div class="max-h-48 overflow-y-auto border border-default rounded-lg">
                <!-- 根目录 -->
                <button
                  class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
                  :class="convertFolderId === null ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-elevated'"
                  @click="convertFolderId = null"
                >
                  <UIcon name="i-lucide-home" class="w-4 h-4 shrink-0" />
                  <span>根目录（部门文档）</span>
                </button>
                <!-- 文件夹列表 -->
                <button
                  v-for="folder in (deptFolders || [])"
                  :key="folder.id"
                  class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
                  :class="convertFolderId === folder.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-elevated'"
                  :style="{ paddingLeft: (folder.parent_id ? 36 : 12) + 'px' }"
                  @click="convertFolderId = folder.id"
                >
                  <UIcon name="i-lucide-folder" class="w-4 h-4 shrink-0" />
                  <span class="truncate">{{ folder.name }}</span>
                </button>
              </div>
            </UFormField>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showConvertModal = false">
                取消
              </UButton>
              <UButton
                color="primary"
                :loading="isConverting"
                :disabled="!convertDocName.trim()"
                @click="executeConvert"
              >
                转存
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
    <!-- New Folder Modal -->
    <UModal v-model:open="showNewFolderModal" title="新建目录" :ui="{ content: 'w-96' }">
      <template #body>
        <UInput
          v-model="newFolderName"
          placeholder="请输入目录名称"
          autofocus
          class="w-full"
          @keyup.enter="createFolder"
        />
      </template>
      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="showNewFolderModal = false">
            取消
          </UButton>
          <UButton
            color="primary"
            :loading="isCreatingFolder"
            :disabled="!newFolderName.trim()"
            @click="createFolder"
          >
            创建
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Delete Folder Confirmation -->
    <UModal v-model:open="showDeleteFolderConfirm" title="确认删除目录">
      <template #body>
        <p class="text-sm text-default">
          确定要删除目录 <strong>{{ deleteFolderTarget?.name }}</strong> 吗？
        </p>
        <p class="text-xs text-muted mt-2">
          仅空目录可以删除
        </p>
      </template>
      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="showDeleteFolderConfirm = false">
            取消
          </UButton>
          <UButton
            color="error"
            :loading="isDeletingFolder"
            @click="executeDeleteFolder"
          >
            删除
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Move File Modal -->
    <UModal v-model:open="showMoveModal" title="移动文件" :ui="{ content: 'w-96' }">
      <template #body>
        <p class="text-sm text-muted mb-3">
          将 <strong class="text-default">{{ moveTarget?.original_name }}</strong> 移动到：
        </p>
        <div class="max-h-64 overflow-y-auto border border-default rounded-lg">
          <!-- 根目录 -->
          <button
            class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
            :class="moveToFolderId === null ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-elevated'"
            @click="moveToFolderId = null"
          >
            <UIcon name="i-lucide-home" class="w-4 h-4 shrink-0" />
            <span>根目录</span>
          </button>
          <!-- 文件夹列表（树形展示） -->
          <button
            v-for="folder in allFolders"
            :key="folder.id"
            class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
            :class="moveToFolderId === folder.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-elevated'"
            :style="{ paddingLeft: (folder.parent_id ? 36 : 12) + 'px' }"
            @click="moveToFolderId = folder.id"
          >
            <UIcon name="i-lucide-folder" class="w-4 h-4 shrink-0 text-amber-500" />
            <span class="truncate">{{ folder.name }}</span>
          </button>
        </div>
      </template>
      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="showMoveModal = false">
            取消
          </UButton>
          <UButton
            color="primary"
            :disabled="moveToFolderId === moveTarget?.folder_id"
            @click="executeMove"
          >
            移动
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 发布 PDF 弹窗 -->
    <UModal v-model:open="showPublishModal" title="发布文件" :ui="{ content: 'sm:max-w-md' }">
      <template #body>
        <div class="space-y-4 p-4">
          <p class="text-sm text-muted">
            将 <span class="font-medium text-default">{{ previewFile?.original_name }}</span> 发布到公司文档目录
          </p>
          <UFormField label="发布目标" required>
            <USelectMenu
              v-model="publishTarget"
              :items="publishTargets"
              value-key="value"
              label-key="label"
              placeholder="请选择目标分类"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="showPublishModal = false">
            取消
          </UButton>
          <UButton
            color="primary"
            :loading="publishing"
            :disabled="!publishTarget"
            @click="handlePublishPdf"
          >
            确认发布
          </UButton>
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
