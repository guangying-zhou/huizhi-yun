<script setup lang="ts">
import { nextTick } from 'vue'
import type { Project } from '~/types/account'
import type { Folder, ProjectDocument, ProjectDocsTreeItem, ProjectFileItem } from '~/types'

definePageMeta({
  layout: 'default'
})

usePageTitle('项目组文档')

interface ProjectFolderRecord extends Folder {
  parent_id?: number | null
  parentId?: number | null
}

interface PublishInfoRecord {
  date: string
  label: string
  dateStr?: string
}

interface ProjectDocRecord extends ProjectDocument {
  uuid: string
  title: string
  name?: string
  folder_id?: number | null
  folderId?: number | null
  parent_id?: number | null
  parentId?: number | null
  star_flag?: number
  readonly_flag?: number
  publish_info?: string | PublishInfoRecord
  ai_abstract?: string
  deleted_at?: string
}

interface ListResponse<T> {
  data?: {
    items: T[]
  }
}

interface DocumentDetailResponse {
  success: boolean
  data?: {
    uuid?: string
    content?: string
    ai_abstract?: string
  }
}

interface UploadDocumentsResponse {
  success: number
  failed: number
}

interface CreateDocumentResponse {
  data?: {
    uuid?: string
  }
}

interface MenuActionItem {
  label: string
  icon: string
  onSelect: () => void
  color?: 'error'
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'object' && error !== null) {
    if ('data' in error && typeof error.data === 'object' && error.data !== null && 'message' in error.data) {
      const message = error.data.message
      if (typeof message === 'string' && message) {
        return message
      }
    }

    if ('message' in error && typeof error.message === 'string' && error.message) {
      return error.message
    }
  }

  return fallback
}

const accountStore = useAccountStore()
const toast = useToast()
const apiFetch = useRequestFetch()
const { user } = useAuth()
const { setPayload: setDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()
const uid = computed(() => user.value || 'user1')
const projectGroups = ref<Project[]>([])
const projectGroupsLoading = ref(false)
const refreshingProjectGroups = ref(false)

const docsLoading = computed(() => accountStore.docsLoading)

// Tree state - 选中的节点可以是文件夹或文件
const selectedNodeId = ref<string>('root') // 'root','project-{id}', 'folder-{id}', 'doc-{uuid}'
const selectedNodeType = ref<'root' | 'project' | 'folder' | 'document'>('root')
const expandedFolders = ref<Set<number>>(new Set())
const selectedProject = ref<Project | null>(null)

// Preview state
const previewContent = ref('')
const previewAbstract = ref('')
const previewDoc = ref<ProjectDocRecord | null>(null)
const previewLoading = ref(false)

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

// Toolbar title editing (right panel)
const toolbarEditing = ref(false)
const toolbarEditName = ref('')
const toolbarInputRef = ref<HTMLInputElement | null>(null)

// Recycle bin state
const showRecycleBin = ref(false)
const trashDocuments = ref<(ProjectDocRecord & { [key: string]: unknown })[]>([])
const trashLoading = ref(false)

// Restore modal record type (matches RestoreDocumentModal props)
interface RestoreDocRecord {
  uuid: string
  title: string
  doc_type: string
  owner_uid?: string
  folder_id?: number | null
  dept_code?: string
  project_code?: string
}

const toRestoreRecord = (doc: ProjectDocRecord | null): RestoreDocRecord | null => {
  if (!doc) return null
  return {
    uuid: doc.uuid,
    title: doc.title || doc.name || '',
    doc_type: String(doc['doc_type'] || doc.docType || 'project'),
    owner_uid: doc.ownerUid,
    folder_id: doc.folder_id ?? doc.folderId,
    project_code: String(doc.projectCode || '')
  }
}

// Restore modal state
const showRestoreModal = ref(false)
const restoreDoc = ref<RestoreDocRecord | null>(null)

// Fetch trash documents
const { fetchTrashDocuments: fetchTrash, formatDeletedAt, formatDocLocation } = useRecycleBin()
const loadTrashDocuments = async () => {
  trashLoading.value = true
  try {
    // 加载所有项目的回收站文档（不指定 project_code）
    const docs = await fetchTrash({
      type: 'project'
      // 不传 project_code，获取所有项目的回收站文档
    })
    trashDocuments.value = (docs || []).filter(doc => doc.uuid) as (ProjectDocRecord & { [key: string]: unknown })[]
  } finally {
    trashLoading.value = false
  }
}

// Watch recycle bin toggle
watch(showRecycleBin, async (show) => {
  if (show) {
    // 切换到回收站模式时，加载所有项目的回收站文档
    await nextTick()
    loadTrashDocuments()
  } else {
    // 切换回正常模式时，清空回收站数据
    await nextTick()
    trashDocuments.value = []
  }
})

const collectLeaderProjectCodes = (projects: Project[], currentUid: string, ids: Set<string>) => {
  projects.forEach((project) => {
    if (project.leaderUid === currentUid) {
      ids.add(project.projectCode)
    }
    if (project.subProjects?.length) {
      collectLeaderProjectCodes(project.subProjects, currentUid, ids)
    }
  })
}

const managedProjectCodes = computed(() => {
  const currentUid = user.value
  const ids = new Set<string>()
  if (!currentUid) return ids

  const userProjects = accountStore.getUserProjects(currentUid)
  ;(userProjects?.managed || []).forEach(project => ids.add(project.projectCode))
  collectLeaderProjectCodes(projectGroups.value, currentUid, ids)

  return ids
})

const managedProjectCodeList = computed(() => Array.from(managedProjectCodes.value))

const isManagedProject = (project: Project) => managedProjectCodes.value.has(project.projectCode)

const loadProjectGroups = async (force = false) => {
  if (!force && projectGroups.value.length > 0) return

  projectGroupsLoading.value = true
  try {
    const response = await accountStore.fetchProjects({
      only_group: 'true',
      include_template: 'false'
    })
    projectGroups.value = response?.items || []
  } finally {
    projectGroupsLoading.value = false
  }
}

const loadProjectDocsTree = async (project: Project, force = false) => {
  if (!force && Array.isArray(project.docsTree)) return

  project.docsLoading = true
  try {
    const [foldersResponse, docsResponse] = await Promise.all([
      $fetch<{ success?: boolean, code?: number, data?: ProjectDocsTreeItem[] }>(
        `/api/folders/list/${encodeURIComponent(project.projectCode)}`
      ),
      $fetch<{ success?: boolean, code?: number, data?: ProjectDocsTreeItem[] }>(
        `/api/documents/project/${encodeURIComponent(project.projectCode)}`
      )
    ])

    const folders = foldersResponse.data || []
    const docs = docsResponse.data || []
    project.docsTree = accountStore.buildTreeItems(folders, docs, null)
  } finally {
    project.docsLoading = false
  }
}

// 当前选中的项目
const currentProject = computed(() => accountStore.selectedProject)

// 当前用户是否是项目负责人
const isProjectOwner = computed(() => {
  if (!currentProject.value) return false
  return currentProject.value.leaderUid === uid.value
})

// 是否为叶子节点项目（没有子项）
const isStrictLeafProject = computed(() => {
  if (!currentProject.value) return false
  return !currentProject.value.subProjects || currentProject.value.subProjects.length === 0
})

// 是否允许创建文档或上传文档（叶子节点 或 根项目且当前用户是项目负责人）
const canCreateDoc = computed(() => {
  return isStrictLeafProject.value || isProjectOwner.value
})

// 是否允许新建子目录（须同时满足：是叶子节点、且是项目负责人）
const canCreateFolder = computed(() => {
  return isStrictLeafProject.value && isProjectOwner.value
})

// Fetch all folders
const fetchProjectFolders = async () => {
  if (!user.value) return []
  const response = await apiFetch<ListResponse<ProjectFolderRecord>>('/api/folders', {
    query: {
      folder_type: 'project',
      project_code: currentProject.value?.projectCode,
      owner_uid: uid.value
    }
  })
  return response?.data?.items || []
}

// Fetch all documents
const fetchProjectDocuments = async () => {
  if (!user.value) return []
  const response = await apiFetch<ListResponse<ProjectDocRecord>>('/api/documents', {
    query: {
      type: 'project',
      project_code: currentProject.value?.projectCode,
      owner_uid: uid.value
    }
  })
  return response?.data?.items || []
}

const { data: projectFolders, refresh: refreshFolders } = await useAsyncData(
  'my-project-folders',
  fetchProjectFolders,
  {
    watch: [user, currentProject],
    immediate: true,
    getCachedData: () => undefined
  }
)

const { refresh: refreshDocs } = await useAsyncData(
  'my-project-docs',
  fetchProjectDocuments,
  {
    watch: [user, currentProject],
    immediate: true,
    getCachedData: () => undefined
  }
)

// Watch for user authentication
watch(user, (newUser) => {
  if (newUser) {
    refreshFolders()
    refreshDocs()
  }
}, { immediate: true })
// Toggle project expansion
const toggleProject = async (project: Project) => {
  project.isExpanded = !project.isExpanded
  if (project.isExpanded) {
    await loadProjectDocsTree(project)
  }
  // 不需要在这里加载回收站文档，因为已经在 watch(showRecycleBin) 中一次性加载了所有项目的文档
}

// 选择项目
const selectProject = async (project: Project) => {
  accountStore.selectedProject = project
  selectedProject.value = project
  await loadProjectDocsTree(project)
  // 不需要在这里加载，已在 watch 中处理
}

const refreshCurrentProjectDocsTree = async () => {
  if (currentProject.value) {
    await loadProjectDocsTree(currentProject.value, true)
  }
}

const refreshCurrentProjectDocs = async () => {
  await Promise.all([
    refreshFolders(),
    refreshDocs(),
    refreshCurrentProjectDocsTree()
  ])
}

// Select node
const selectNode = async (
  nodeId: string,
  nodeType: 'root' | 'project' | 'folder' | 'document',
  data?: Project | ProjectFolderRecord | ProjectDocRecord,
  project?: Project
) => {
  // 如果已选中同一个文档，不重复加载
  if (nodeType === 'document' && selectedNodeId.value === nodeId && previewDoc.value) {
    return
  }

  selectedNodeId.value = nodeId
  selectedNodeType.value = nodeType

  // Close sidebar on mobile
  showMobileSidebar.value = false

  // 如果提供了项目上下文，且与当前选中的项目不同，则切换项目
  if (project && (!currentProject.value || currentProject.value.projectCode !== project.projectCode)) {
    await selectProject(project)
  }

  if (nodeType === 'project') {
    await selectProject(data as Project)
  } else if (nodeType === 'document' && data) {
    await loadDocumentPreview(data as ProjectDocRecord)
    accountStore.selectDocument(data as unknown as ProjectFileItem)
  } else {
    previewContent.value = ''
    previewAbstract.value = ''
    previewDoc.value = null
  }
}

// Load document preview
const loadDocumentPreview = async (doc: ProjectDocRecord) => {
  previewDoc.value = doc
  previewLoading.value = true
  previewContent.value = ''

  try {
    const query = showRecycleBin.value ? '?include_deleted=1' : ''
    const response = await $fetch<DocumentDetailResponse>(`/api/documents/${doc.uuid}${query}`)
    if (response.success && response.data) {
      previewContent.value = response.data.content || ''
      previewAbstract.value = response.data.ai_abstract || ''
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

// Toolbar title double-click rename
const startToolbarEdit = () => {
  if (!previewDoc.value || getPublishInfo(previewDoc.value)) return
  toolbarEditing.value = true
  toolbarEditName.value = previewDoc.value.title || previewDoc.value.name || ''
  nextTick(() => {
    toolbarInputRef.value?.focus()
    toolbarInputRef.value?.select()
  })
}

const saveToolbarEdit = async () => {
  if (!toolbarEditName.value.trim() || !previewDoc.value) {
    toolbarEditing.value = false
    return
  }
  const newTitle = toolbarEditName.value.trim()
  const oldTitle = previewDoc.value.title || previewDoc.value.name
  if (newTitle === oldTitle) {
    toolbarEditing.value = false
    return
  }
  try {
    await $fetch(`/api/documents/${previewDoc.value.uuid}`, {
      method: 'PATCH',
      body: { title: newTitle }
    })
    previewDoc.value.title = newTitle
    previewDoc.value.name = newTitle
    toast.add({ title: '文档已重命名', color: 'success' })
    await refreshCurrentProjectDocs()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '重命名失败'), color: 'error' })
  } finally {
    toolbarEditing.value = false
  }
}

const cancelToolbarEdit = () => {
  toolbarEditing.value = false
  toolbarEditName.value = ''
}

// Get current folder ID (for creating new items)
const currentFolderId = computed<number | null>(() => {
  if (selectedNodeType.value === 'root') return null
  if (selectedNodeType.value === 'project') return null
  if (selectedNodeType.value === 'folder') {
    const id = selectedNodeId.value.replace('folder-', '')
    return parseInt(id)
  }
  if (selectedNodeType.value === 'document' && previewDoc.value) {
    return previewDoc.value.parentId ?? previewDoc.value.folderId ?? previewDoc.value.folder_id ?? null
  }
  return null
})

// Build breadcrumb path from project root to current folder
const breadcrumbPath = computed<{ type: 'project' | 'folder', id: string | number, name: string }[]>(() => {
  if (!currentProject.value) return []

  // Base: Project root
  const path: { type: 'project' | 'folder', id: string | number, name: string }[] = [
    { type: 'project', id: currentProject.value.projectCode, name: currentProject.value.name }
  ]

  if (selectedNodeType.value === 'root' || selectedNodeType.value === 'project') return path

  const folderId = currentFolderId.value
  if (folderId === null) return path

  // Walk up the parent chain
  const folders = projectFolders.value || []
  const chain: { type: 'folder', id: number, name: string }[] = []
  let currentId: number | null = folderId
  while (currentId !== null) {
    const folder = folders.find(f => f.id === currentId)
    if (!folder) break
    chain.unshift({ type: 'folder', id: folder.id, name: folder.name })
    currentId = folder.parentId ?? folder.parent_id ?? null
  }
  return [...path, ...chain]
})

// Navigate breadcrumb
const navigateBreadcrumb = (crumb: { type: 'project' | 'folder', id: string | number, name: string }) => {
  if (crumb.type === 'project') {
    const project = accountStore.getSelectedProject()
    if (project) {
      selectNode(`project-${project.projectCode}`, 'project', project)
    }
  } else {
    const folderId = crumb.id as number
    const folder = (projectFolders.value || []).find(f => f.id === folderId)
    if (folder) {
      selectNode(`folder-${folderId}`, 'folder', folder)
      // Ensure all ancestor folders are expanded
      let parentId: number | null | undefined = folder.parent_id
      while (parentId != null) {
        expandedFolders.value.add(parentId)
        const parent = (projectFolders.value || []).find(f => f.id === parentId)
        parentId = parent ? parent.parent_id : null
      }
      expandedFolders.value = new Set(expandedFolders.value)
    }
  }
}

// Create document
const createDocument = async () => {
  if (!newDocName.value.trim()) {
    toast.add({ title: '请输入文档名称', color: 'warning' })
    return
  }

  isCreating.value = true
  try {
    const { data, error } = await useFetch<CreateDocumentResponse>('/api/documents', {
      method: 'POST',
      body: {
        title: newDocName.value.trim(),
        doc_type: 'project',
        owner_uid: uid.value,
        project_code: currentProject.value?.projectCode,
        folder_id: currentFolderId.value
      }
    })

    if (error.value) {
      throw new Error(error.value.message || '创建文档失败')
    }

    toast.add({ title: '文档创建成功', color: 'success' })
    showNewDocModal.value = false
    newDocName.value = ''
    await refreshCurrentProjectDocs()

    const docUUId = data.value?.data?.uuid
    if (docUUId) {
      await navigateToEdit(docUUId)
    }
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '创建文档失败'), color: 'error' })
  } finally {
    isCreating.value = false
  }
}

// Create folder
const createFolder = async () => {
  if (!newFolderName.value.trim()) {
    toast.add({ title: '请输入文件夹名称', color: 'warning' })
    return
  }

  isCreating.value = true
  try {
    const { error } = await useFetch('/api/folders', {
      method: 'POST',
      body: {
        name: newFolderName.value.trim(),
        folder_type: 'project',
        owner_uid: uid.value,
        project_code: currentProject.value?.projectCode,
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

    await refreshCurrentProjectDocs()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '创建文件夹失败'), color: 'error' })
  } finally {
    isCreating.value = false
  }
}

// Upload files
const triggerUpload = () => {
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

  isUploading.value = true
  const formData = new FormData()
  formData.append('doc_type', 'project')
  formData.append('owner_uid', uid.value)
  if (currentProject.value?.projectCode) {
    formData.append('project_code', currentProject.value.projectCode)
  }
  if (currentFolderId.value) {
    formData.append('folder_id', String(currentFolderId.value))
  }

  validFiles.forEach((file) => {
    formData.append('files', file)
  })

  try {
    const result = await $fetch<UploadDocumentsResponse>('/api/documents/upload', {
      method: 'POST',
      body: formData
    })

    if (result.success > 0) {
      toast.add({ title: `成功上传 ${result.success} 个文档`, color: 'success' })
      await refreshCurrentProjectDocs()
    }

    if (result.failed > 0) {
      toast.add({ title: `${result.failed} 个文档上传失败`, color: 'error' })
    }
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '上传失败'), color: 'error' })
  } finally {
    isUploading.value = false
    input.value = ''
  }
}

// Delete confirmation
const showDeleteConfirm = ref(false)
const deleteTarget = ref<{ type: 'project' | 'folder' | 'document', id: number | string, name: string } | null>(null)
const isDeleting = ref(false)

const confirmDelete = (type: 'project' | 'folder' | 'document', id: number | string, name: string) => {
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
      await refreshCurrentProjectDocs()
    } else if (target.type === 'document') {
      await $fetch(`/api/documents/${target.id}`, { method: 'DELETE' })
      toast.add({ title: '文档已删除', color: 'success' })
      await refreshCurrentProjectDocs()
    } else {
      toast.add({ title: '项目删除功能暂未开放', color: 'warning' })
      showDeleteConfirm.value = false
      return
    }

    // 如果删除的是当前选中的项，回到根目录
    if ((target.type === 'folder' && selectedNodeId.value === `folder-${target.id}`)
      || isDeletingCurrentPreviewDoc) {
      await selectNode('root', 'root')
    }

    showDeleteConfirm.value = false
    deleteTarget.value = null
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '删除失败'), color: 'error' })
  } finally {
    isDeleting.value = false
  }
}

const cancelDelete = () => {
  showDeleteConfirm.value = false
  deleteTarget.value = null
}

// Toggle home flag
const toggleHome = async (doc: ProjectDocRecord) => {
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
const toggleReadonly = async (doc: ProjectDocRecord) => {
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

const openShareModal = (doc: ProjectDocRecord) => {
  sharingDocId.value = doc.uuid
  sharingDocTitle.value = doc.title
  isShareModalOpen.value = true
}

// Copy Document Modal State
const showCopyModal = ref(false)
const copyDoc = ref<ProjectDocRecord | null>(null)

const openCopyModal = (doc: ProjectDocRecord) => {
  copyDoc.value = doc
  showCopyModal.value = true
}

const onCopySuccess = () => {
  showCopyModal.value = false
  refreshCurrentProjectDocs()
}

// 解析 publish_info
const getPublishInfo = (doc: ProjectDocRecord | null | undefined) => {
  if (!doc?.publish_info) return null
  try {
    const info = typeof doc.publish_info === 'string' ? JSON.parse(doc.publish_info) as PublishInfoRecord : doc.publish_info
    if (info.date && info.label) {
      const d = new Date(info.date)
      const dateStr = `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`
      return { ...info, dateStr }
    }
  } catch {
    if (typeof doc.publish_info === 'string' && doc.publish_info.startsWith('已发布')) {
      return { label: doc.publish_info.replace('已发布为', ''), dateStr: '', date: '' }
    }
  }
  return null
}

const formatPublishText = (info: { dateStr: string, label: string } | null) => {
  if (!info) return ''
  if (info.dateStr) {
    return `已于${info.dateStr}发布至"${info.label}"`
  }
  return `已发布至"${info.label}"`
}

// 根据文档状态生成下拉菜单
const getDocMenuItems = (doc: ProjectDocRecord) => {
  const isArchived = !!getPublishInfo(doc)
  const items: MenuActionItem[][] = []

  const group1: MenuActionItem[] = [{
    label: '下载',
    icon: 'i-lucide-download',
    onSelect: () => downloadDocument(doc.uuid)
  }]
  if (isArchived) {
    group1.push({
      label: '复制',
      icon: 'i-lucide-copy',
      onSelect: () => openCopyModal(doc)
    })
  }
  items.push(group1)

  if (!isArchived) {
    items.push([{
      label: doc.star_flag ? '取消收藏' : '收藏',
      icon: doc.star_flag ? 'i-lucide-star-off' : 'i-lucide-star',
      onSelect: () => toggleHome(doc)
    }, {
      label: doc.readonly_flag ? '取消只读' : '设为只读',
      icon: doc.readonly_flag ? 'i-lucide-lock-open' : 'i-lucide-lock',
      onSelect: () => toggleReadonly(doc)
    }])

    items.push([{
      label: '共享',
      icon: 'i-lucide-share-2',
      onSelect: () => openShareModal(doc)
    }])

    items.push([{
      label: '删除',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => confirmDelete('document', doc.uuid, doc.title)
    }])
  }

  return items
}

// Navigate to edit document
const navigateToEdit = (uuid: string) => {
  if (previewDoc.value?.uuid === uuid && previewContent.value) {
    setDocumentPreviewBootstrap(uuid, {
      content: previewContent.value,
      aiAbstract: previewAbstract.value
    })
  }

  navigateTo(`/documents/${uuid}`)
}

// Initialize
onMounted(async () => {
  const uid = user.value
  if (!uid) {
    toast.add({
      title: '未登录',
      description: '请先登录后再访问',
      color: 'warning'
    })
    return
  }

  try {
    await Promise.all([
      loadProjectGroups(),
      accountStore.fetchUserProjects(uid)
    ])
  } catch (error) {
    console.error('======error=====', error)
    toast.add({
      title: '加载失败',
      description: '获取项目列表失败',
      color: 'error'
    })
  }

  // if (currentParentProjectCode.value) {
  //   selectedNodeId.value = `project-${currentParentProjectCode.value}`
  //   selectedNodeType.value = 'project'
  // }
  // Restore selection if project is already selected
  if (accountStore.getSelectedProject() && accountStore.getSelectedProject()!.projectCode) {
    const project = accountStore.getSelectedProject()
    const projectCode = project!.projectCode
    if (project && project.isGroup) {
      selectedNodeId.value = `project-${projectCode}`
      selectedNodeType.value = 'project'
      selectProject(project)
    } else {
      selectNode('root', 'root')
    }
  }
  if (accountStore.getSelectedDocument() && accountStore.getSelectedDocument()!.uuid) {
    const doc = accountStore.getSelectedDocument() as unknown as ProjectDocRecord
    // 仅定位到文档所在目录，不恢复文档预览
    const folderId = doc.parentId ?? doc.folderId ?? doc.folder_id
    if (folderId) {
      selectedNodeId.value = `folder-${folderId}`
      selectedNodeType.value = 'folder'
    }
    accountStore.$patch({ selectedProjectDoc: null })
  }
})

const refreshProjectGroups = async () => {
  const currentUid = user.value
  if (!currentUid || refreshingProjectGroups.value) return

  refreshingProjectGroups.value = true
  try {
    await Promise.all([
      loadProjectGroups(true),
      accountStore.fetchUserProjects(currentUid, true)
    ])
    toast.add({
      title: '项目列表已刷新',
      color: 'success'
    })
  } catch {
    toast.add({
      title: '刷新失败',
      description: '获取项目列表失败',
      color: 'error'
    })
  } finally {
    refreshingProjectGroups.value = false
  }
}
</script>

<template>
  <UDashboardPanel grow>
    <div class="flex justify-end gap-2 px-4 py-2 border-b border-default">
      <UButton
        class="md:hidden"
        icon="i-lucide-folder-tree"
        variant="soft"
        color="primary"
        size="sm"
        @click="showMobileSidebar = true"
      >
        目录
      </UButton>
      <UButton
        v-if="panelCollapsed"
        class="hidden md:flex"
        icon="i-lucide-folder-tree"
        variant="ghost"
        size="sm"
        @click="showPanel"
      >
        目录
      </UButton>
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
          <!-- 页签切换：文档列表 / 回收站 -->
          <div class="px-2 mb-2 mt-1">
            <div class="flex pb-0 mb-1 space-x-4 border-b border-default">
              <button
                class="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors border-b-2"
                :class="!showRecycleBin ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-default'"
                @click="showRecycleBin = false"
              >
                <UIcon name="i-lucide-files" class="w-4 h-4" />
                文档列表
              </button>
              <button
                class="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors border-b-2"
                :class="showRecycleBin ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-default'"
                @click="showRecycleBin = true"
              >
                <UIcon name="i-lucide-trash-2" class="w-4 h-4" />
                回收站
              </button>
            </div>
          </div>

          <!-- 项目树 -->
          <div class="space-y-0.5">
            <div class="flex items-center justify-between px-2 py-1">
              <span class="text-xs font-semibold text-muted uppercase tracking-wider">
                GitLab 项目组 ({{ projectGroups.length }})
              </span>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-refresh-cw"
                :loading="refreshingProjectGroups || projectGroupsLoading"
                aria-label="刷新项目组列表"
                @click="refreshProjectGroups"
              />
            </div>

            <template v-if="projectGroups.length > 0">
              <ProjectTreeItem
                v-for="project in projectGroups"
                :key="project.projectCode"
                :project="project"
                :docs-loading="docsLoading"
                :is-selected="selectedNodeId === `project-${project.projectCode}`"
                :is-managed="isManagedProject(project)"
                :managed-project-codes="managedProjectCodeList"
                :selected-node-id="selectedNodeId"
                :is-expanded="project.isExpanded"
                :only-group="true"
                :show-recycle-bin="showRecycleBin"
                :trash-documents="trashDocuments"
                :trash-loading="trashLoading"
                @select="(id: string, type: 'root' | 'project' | 'folder' | 'document', data?: unknown, p?: unknown) => selectNode(id, type, data as Project | ProjectFolderRecord | ProjectDocRecord | undefined, p as Project | undefined)"
                @toggle="(project) => toggleProject(project)"
                @delete="(type, id, name) => confirmDelete(type, id, name)"
                @restore="(doc: Record<string, unknown>) => { restoreDoc = toRestoreRecord(doc as ProjectDocRecord); showRestoreModal = true }"
                @renamed="refreshCurrentProjectDocs()"
              />
            </template>

            <!-- 无项目 -->
            <div
              v-else-if="!projectGroupsLoading"
              class="flex flex-col items-center justify-center py-12 text-center"
            >
              <UIcon name="i-lucide-folder-open" class="w-12 h-12 text-muted mb-3" />
              <p class="text-sm text-muted">
                暂无项目组
              </p>
            </div>

            <div
              v-else
              class="flex flex-col items-center justify-center py-12 text-center"
            >
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 text-muted mb-3 animate-spin" />
              <p class="text-sm text-muted">
                正在加载项目组
              </p>
            </div>
          </div>
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
              <span class="font-medium truncate">{{ previewDoc?.title || previewDoc?.name }}</span>
              <span v-if="previewDoc?.deleted_at" class="text-xs text-muted shrink-0">
                ({{ formatDeletedAt(previewDoc.deleted_at) }})
              </span>
            </div>
            <div class="flex items-center gap-1 text-xs text-muted pl-7">
              <UIcon name="i-lucide-folder" class="w-3.5 h-3.5" />
              <span>{{ previewDoc ? formatDocLocation(previewDoc) : '' }}</span>
            </div>
          </div>
          <UButton
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
          <div class="flex items-center gap-1.5 text-sm font-medium overflow-hidden">
            <template v-for="(crumb, index) in breadcrumbPath" :key="crumb.id ?? 'root'">
              <UIcon
                v-if="index > 0"
                name="i-lucide-chevron-right"
                class="w-3.5 h-3.5 text-muted shrink-0"
              />
              <button
                class="text-primary hover:underline transition-colors px-1 py-0.5 rounded hover:bg-primary/5 truncate max-w-37.5"
                @click="navigateBreadcrumb(crumb)"
              >
                {{ crumb.name }}
              </button>
            </template>
            <UIcon
              v-if="breadcrumbPath.length > 0"
              name="i-lucide-chevron-right"
              class="w-3.5 h-3.5 text-muted shrink-0"
            />
            <div class="flex items-center gap-1.5 px-1 py-0.5 min-w-0">
              <UIcon name="i-lucide-file-text" class="w-4 h-4 text-gray-500 shrink-0" />
              <!-- 双击编辑文档名 -->
              <div v-if="toolbarEditing" class="flex items-center gap-1 min-w-0">
                <input
                  ref="toolbarInputRef"
                  v-model="toolbarEditName"
                  class="text-sm px-1.5 py-0.5 border border-primary rounded bg-default outline-none min-w-30"
                  @keyup.enter="saveToolbarEdit"
                  @keyup.escape="cancelToolbarEdit"
                  @blur="saveToolbarEdit"
                >
              </div>
              <span
                v-else
                class="text-default truncate cursor-pointer hover:text-primary transition-colors"
                :title="(previewDoc?.title || previewDoc?.name) + '（双击重命名）'"
                @dblclick="startToolbarEdit"
              >{{ previewDoc?.title || previewDoc?.name }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <!-- 已归档文档显示归档信息 -->
            <template v-if="getPublishInfo(previewDoc)">
              <span class="text-sm text-gray-500">
                <UIcon name="i-lucide-archive" class="inline" />
                {{ formatPublishText(getPublishInfo(previewDoc)) }}
              </span>
            </template>
            <!-- 未归档文档显示编辑按钮 -->
            <UButton
              v-else
              icon="i-lucide-edit"
              size="sm"
              color="primary"
              @click="navigateToEdit(previewDoc.uuid)"
            >
              编辑
            </UButton>

            <UDropdownMenu :items="getDocMenuItems(previewDoc)">
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
                展开项目以查看已删除的文档
              </p>
              <p class="text-xs text-muted mt-2">
                文档将在删除{{ useRuntimeConfig().public.recycleDays }}天后自动清理
              </p>
            </div>
          </div>

          <div v-if="!showRecycleBin && selectedNodeType === 'root'" class="h-full flex items-center justify-center p-4">
            <div class="flex flex-col items-center gap-6 md:gap-8">
              <div class="text-center">
                <UIcon name="i-lucide-home" class="w-12 h-12 md:w-16 md:h-16 text-primary mx-auto mb-3 md:mb-4" />
                <h3 class="text-lg md:text-xl font-semibold text-default mb-2">
                  项目文档
                </h3>
                <p class="text-xs md:text-sm text-muted">
                  请选择一个项目开始
                </p>
              </div>
            </div>
          </div>

          <!-- 选中根目录或文件夹时显示操作按钮 -->
          <div
            v-if="!showRecycleBin && (selectedNodeType === 'project' || selectedNodeType === 'folder')"
            class="h-full flex items-center justify-center p-4"
          >
            <div class="flex flex-col items-center gap-6 md:gap-8 w-full max-w-2xl">
              <div class="text-center w-full">
                <UIcon
                  :name="selectedNodeType === 'project' ? 'i-lucide-home' : 'i-lucide-folder-open'"
                  class="w-12 h-12 md:w-16 md:h-16 text-primary mx-auto mb-3 md:mb-4"
                />

                <!-- Breadcrumb as title -->
                <nav
                  v-if="breadcrumbPath.length > 1"
                  class="flex items-center justify-center gap-1 text-lg md:text-xl font-semibold mb-2 flex-wrap"
                >
                  <template
                    v-for="(crumb, index) in breadcrumbPath"
                    :key="`${crumb.type}-${crumb.id}`"
                  >
                    <UIcon
                      v-if="index > 0"
                      name="i-lucide-chevron-right"
                      class="w-3 h-3 md:w-4 md:h-4 text-muted shrink-0"
                    />
                    <button
                      v-if="index < breadcrumbPath.length - 1"
                      class="text-primary hover:underline transition-colors px-1 py-0.5 rounded hover:bg-primary/5 break-all line-clamp-1"
                      @click="navigateBreadcrumb(crumb)"
                    >
                      {{ crumb.name }}
                    </button>
                    <span v-else class="text-default break-all line-clamp-2 max-w-50 md:max-w-none text-left">{{ crumb.name }}</span>
                  </template>
                </nav>
                <h3 v-else class="text-lg md:text-xl font-semibold text-default mb-2">
                  {{ breadcrumbPath[0]?.name || '项目文档根目录' }}
                </h3>
                <p class="text-xs md:text-sm text-muted">
                  请选择一个操作来开始
                </p>
              </div>

              <div class="grid grid-cols-2 md:flex gap-3 md:gap-6 w-full max-w-[320px] md:max-w-none mx-auto justify-center">
                <!-- 新建文档按钮 -->
                <button
                  v-if="canCreateDoc"
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
                  v-if="canCreateFolder"
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
                  v-if="canCreateDoc"
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
            <EditorMilkdownEditor
              v-if="previewContent && !previewLoading"
              :model-value="previewContent"
              :show-sidebar="false"
              readonly
              container-height="100%"
            />
          </div>
        </div>
      </main>
    </div>

    <!-- New Document Modal -->
    <UModal v-model:open="showNewDocModal">
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
    <UModal v-model:open="showNewFolderModal">
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
            确定要删除{{ deleteTarget?.type === 'folder' ? '文件夹' : (deleteTarget?.type === 'project' ? '项目'
              : '文档') }}
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
      @update:open="isShareModalOpen = $event"
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
      @restored="showRestoreModal = false; restoreDoc = null; loadTrashDocuments(); refreshCurrentProjectDocs()"
    />
  </UDashboardPanel>
</template>
