<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import CommonEmptyState from '@hzy/foundation/app/components/common/EmptyState.vue'
import { documentLoadErrorMessage } from '../../utils/departmentDocumentWriteError'

import MyDocumentSpaceHeader from '../../components/MyDocumentSpaceHeader.vue'
import type { ProjectDocsTreeItem } from '../../types'
import { useDocumentDownload } from '../../composables/useDocumentDownload'
import { useDocumentPreviewBootstrap } from '../../composables/useDocumentPreviewBootstrap'
import { useLayoutHeaderActions } from '../../composables/useLayoutHeaderActions'
import { useResizablePanel } from '../../composables/useResizablePanel'
import { useCodocsModule } from '../../../layer/useCodocsModule'
import { createCreationAttempt, fingerprintUploadFiles } from '../../../layer/creationAttempt.mjs'

definePageMeta({ hostContentInset: false })

usePageTitle('我的文档')

// Record types for API responses
const { hasPermission } = usePermissions()
const canCreateDocument = computed(() => hasPermission('documents', 'create'))
const canEditDocument = computed(() => hasPermission('documents', 'edit'))
const canDeleteDocument = computed(() => hasPermission('documents', 'delete'))
const canExportDocument = computed(() => hasPermission('documents', 'export'))

interface FolderRecord {
  id: number
  name: string
  parent_id: number | null
  folder_type: string
  owner_uid: string
  sort_order?: number
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

interface DocRecord {
  uuid: string
  title: string
  folder_id: number | null
  star_flag: number
  readonly_flag: number
  owner_uid: string
  doc_type: string
  content?: string
  ai_abstract?: string
  publish_info?: string
  updated_at?: string
  created_at?: string
  [key: string]: unknown
}

interface UploadResult {
  success: number
  failed: number
}

interface DocDetailResponse {
  success: boolean
  data: {
    content?: string
    ai_abstract?: string
  }
}

interface WorklogResponse {
  success: boolean
  data: {
    uuid: string
    existed?: boolean
  }
}

interface CreateDocResponse {
  data?: {
    uuid?: string
  }
}

const toast = useToast()
const apiFetch = useRequestFetch()
const { moduleUrl, documentUrl, cacheKey, hosted } = useCodocsModule()
const documentCreationAttempt = createCreationAttempt()
const folderCreationAttempt = createCreationAttempt()
const documentRecycleAttempt = createCreationAttempt()
const uploadAttempt = createCreationAttempt()
const { user, userRealname } = useAuth()
const { setPayload: setDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()
const { setHeaderActions, clearHeaderActions } = useLayoutHeaderActions()
const { downloadDocument } = useDocumentDownload()
const uid = computed(() => user.value || 'user1')

// Tree state - 选中的节点可以是文件夹或文件
const selectedNodeId = ref<string>('root') // 'root', 'folder-{id}', 'doc-{uuid}'
const selectedNodeType = ref<'root' | 'project' | 'folder' | 'document'>('root')
const expandedFolders = ref<Set<number>>(new Set())

// Preview state
const previewContent = ref('')
const previewAbstract = ref('')
const previewDoc = ref<DocRecord | null>(null)
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
const { panelWidth, panelCollapsed, onResizeStart } = useResizablePanel(240)
function openDirectoryPanel() {
  panelCollapsed.value = false
  showMobileSidebar.value = true
}

// Inline editing
const editingId = ref<string | null>(null) // 'folder-{id}' or 'doc-{uuid}'
const editingName = ref('')

const PAGE_SIZE = 20
interface FolderPage { items: FolderRecord[], total: number, page: number, pageSize: number, parentChain: { id: number, name: string, parent_id: number | null }[] }
interface DocumentPage { items: DocRecord[], total: number, page: number, pageSize: number }
const rootFolderPage = ref(1)
const rootDocumentPage = ref(1)
const childPages = ref<Record<number, { folders?: FolderPage, documents?: DocumentPage, folderPage: number, documentPage: number, loading: boolean, error: string }>>({})
const childRequestIds = new Map<number, number>()
let childRequestSequence = 0
const folderPaths = ref<Record<number, { id: number, name: string }[]>>({})

function validatePage<T>(response: { data?: { items?: T[], total?: number, page?: number, pageSize?: number } } | undefined, page: number): { items: T[], total: number, page: number, pageSize: number } {
  const value = response?.data
  if (!Array.isArray(value?.items) || !Number.isSafeInteger(value?.total) || (value?.total || 0) < 0 || value?.page !== page || value?.pageSize !== PAGE_SIZE || value.items.length > PAGE_SIZE) {
    throw new Error('目录分页响应无效')
  }
  return value as { items: T[], total: number, page: number, pageSize: number }
}
async function fetchFolderPage(parentId: number | null, page: number): Promise<FolderPage> {
  if (!user.value) return { items: [], total: 0, page, pageSize: PAGE_SIZE, parentChain: [] }
  const actor = uid.value
  const response = await apiFetch<{ data: FolderPage }>(moduleUrl('/api/folders'), {
    query: { folder_type: 'private', owner_uid: actor, parent_id: parentId === null ? 'null' : String(parentId), page, pageSize: PAGE_SIZE }
  })
  if (actor !== uid.value) throw new Error('目录会话已变化')
  const value = validatePage<FolderRecord>(response, page)
  if (!Array.isArray(response?.data?.parentChain) || response.data.parentChain.length > 64
    || value.items.some(folder => !Number.isSafeInteger(folder.id) || folder.id < 1 || folder.parent_id !== parentId || typeof folder.name !== 'string')) {
    throw new Error('目录层级响应无效')
  }
  return { ...value, parentChain: response.data.parentChain }
}
function rememberFolderPaths(page: FolderPage) {
  const paths = { ...folderPaths.value }
  for (const folder of page.items) paths[folder.id] = [...page.parentChain.map(part => ({ id: part.id, name: part.name })), { id: folder.id, name: folder.name }]
  folderPaths.value = paths
}
async function fetchDocumentPage(parentId: number | null, page: number): Promise<DocumentPage> {
  if (!user.value) return { items: [], total: 0, page, pageSize: PAGE_SIZE }
  const actor = uid.value
  const response = await apiFetch<{ data: DocumentPage }>(moduleUrl('/api/documents'), {
    // The Enterprise Host derives the owner from the verified session.
    query: { type: 'private', ...(hosted ? {} : { owner: actor }), folder_id: parentId === null ? 'null' : String(parentId), exclude_worklogs: 1, page, pageSize: PAGE_SIZE }
  })
  if (actor !== uid.value) throw new Error('文档会话已变化')
  const value = validatePage<DocRecord>(response, page)
  if (value.items.some(doc => typeof doc.uuid !== 'string' || doc.folder_id !== parentId)) throw new Error('文档目录响应无效')
  return value
}
const { data: rootFolders, pending: foldersPending, error: rootFolderError, refresh: refreshRootFolders } = await useAsyncData(
  cacheKey('my-private-root-folders'), () => fetchFolderPage(null, rootFolderPage.value),
  { watch: [user, rootFolderPage], immediate: true, lazy: true, getCachedData: () => undefined }
)
const { data: rootDocuments, pending: docsPending, error: rootDocumentError, refresh: refreshRootDocs } = await useAsyncData(
  cacheKey('my-private-root-docs'), () => fetchDocumentPage(null, rootDocumentPage.value),
  { watch: [user, rootDocumentPage], immediate: true, lazy: true, getCachedData: () => undefined }
)
const loading = computed(() => docsPending.value || foldersPending.value)
async function loadChild(parentId: number, kind?: 'folder' | 'document', page?: number) {
  const old = childPages.value[parentId]
  const folderPage = kind === 'folder' ? page || 1 : old?.folderPage || 1
  const documentPage = kind === 'document' ? page || 1 : old?.documentPage || 1
  const request = ++childRequestSequence
  childRequestIds.set(parentId, request)
  childPages.value = { ...childPages.value, [parentId]: { ...old, folderPage, documentPage, loading: true, error: '' } }
  try {
    const [folders, documents] = await Promise.all([fetchFolderPage(parentId, folderPage), fetchDocumentPage(parentId, documentPage)])
    if (childRequestIds.get(parentId) !== request || !expandedFolders.value.has(parentId)) return
    const folderLast = Math.max(1, Math.ceil(folders.total / PAGE_SIZE))
    const documentLast = Math.max(1, Math.ceil(documents.total / PAGE_SIZE))
    if (folderPage > folderLast) {
      void loadChild(parentId, 'folder', folderLast)
      return
    }
    if (documentPage > documentLast) {
      void loadChild(parentId, 'document', documentLast)
      return
    }
    rememberFolderPaths(folders)
    childPages.value = { ...childPages.value, [parentId]: { folders, documents, folderPage, documentPage, loading: false, error: '' } }
  } catch (cause) {
    if (childRequestIds.get(parentId) !== request || !expandedFolders.value.has(parentId)) return
    childPages.value = { ...childPages.value, [parentId]: { ...old, folderPage, documentPage, loading: false, error: (cause as Error)?.message || '目录加载失败' } }
  }
}
async function retryRootDocuments() {
  await Promise.all([refreshFolders(), refreshDocs()])
}

async function refreshFolders() {
  await refreshRootFolders()
  await Promise.all([...expandedFolders.value].map(id => loadChild(id)))
}
async function refreshDocs() {
  await refreshRootDocs()
  await Promise.all([...expandedFolders.value].map(id => loadChild(id)))
}
watch(user, () => {
  rootFolderPage.value = 1
  rootDocumentPage.value = 1
  expandedFolders.value = new Set()
  childPages.value = {}
  childRequestIds.clear()
  folderPaths.value = {}
  selectedNodeId.value = 'root'
  selectedNodeType.value = 'root'
  previewDoc.value = null
  previewContent.value = ''
  previewAbstract.value = ''
})
function buildTreeItems(parentId: number | null, seen = new Set<number>()): ProjectDocsTreeItem[] {
  const page = parentId === null ? { folders: rootFolders.value, documents: rootDocuments.value } : childPages.value[parentId]
  const folders = page?.folders?.items || []
  const documents = page?.documents?.items || []
  const items: ProjectDocsTreeItem[] = []
  for (const folder of folders) {
    if (seen.has(folder.id) || seen.size >= 64) continue
    const next = new Set(seen)
    next.add(folder.id)
    const child = childPages.value[folder.id]
    items.push({ type: 'folder', id: folder.id, nodeId: `folder-${folder.id}`, name: folder.name, data: folder,
      children: child ? buildTreeItems(folder.id, next) : [], folderTotal: child?.folders?.total ?? Number(folder.folderCount || 0), documentTotal: child?.documents?.total ?? Number(folder.documentCount || 0),
      folderPage: child?.folderPage || 1, documentPage: child?.documentPage || 1, childrenLoading: child?.loading, childrenError: child?.error })
  }
  for (const doc of documents) items.push({ type: 'document', id: doc.uuid, nodeId: `doc-${doc.uuid}`, name: doc.title, data: doc })
  return items
}
const treeItems = computed<ProjectDocsTreeItem[]>(() => buildTreeItems(null))
watch(rootFolders, (page) => {
  if (!page) return
  const lastPage = Math.max(1, Math.ceil(page.total / PAGE_SIZE))
  if (rootFolderPage.value > lastPage) rootFolderPage.value = lastPage
  else rememberFolderPaths(page)
}, { immediate: true })
watch(rootDocuments, (page) => {
  if (!page) return
  const lastPage = Math.max(1, Math.ceil(page.total / PAGE_SIZE))
  if (rootDocumentPage.value > lastPage) rootDocumentPage.value = lastPage
})
function toggleFolder(folderId: number) {
  const next = new Set(expandedFolders.value)
  if (next.has(folderId)) {
    next.delete(folderId)
    childRequestIds.delete(folderId)
  } else {
    next.add(folderId)
    if (!childPages.value[folderId]) void loadChild(folderId)
  }
  expandedFolders.value = next
}
function changeChildPage(folderId: number, kind: 'folder' | 'document', page: number) {
  if (!Number.isSafeInteger(page) || page < 1 || !expandedFolders.value.has(folderId)) return
  void loadChild(folderId, kind, page)
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
    await loadDocumentPreview(data as DocRecord)
  } else {
    // 选中根目录或文件夹，清空预览
    previewContent.value = ''
    previewAbstract.value = ''
    previewDoc.value = null
  }
}

// Load document preview
const loadDocumentPreview = async (doc: DocRecord) => {
  previewDoc.value = doc
  previewLoading.value = true
  previewContent.value = ''

  try {
    const response = await $fetch<DocDetailResponse>(moduleUrl(`/api/documents/${doc.uuid}`))
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

// Start inline editing
const startEdit = (id: string, name: string) => {
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
      await $fetch(moduleUrl(`/api/folders/${folderId}`), {
        method: 'PATCH',
        body: { name: editingName.value.trim() }
      })
      toast.add({ title: '文件夹已重命名', color: 'success' })
      await refreshFolders()
    } else if (editingId.value.startsWith('doc-')) {
      const docUuid = editingId.value.replace('doc-', '')
      await $fetch(moduleUrl(`/api/documents/${docUuid}`), {
        method: 'PATCH',
        body: { title: editingName.value.trim() }
      })
      toast.add({ title: '文档已重命名', color: 'success' })
      await refreshDocs()
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '重命名失败'
    toast.add({ title: message, color: 'error' })
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

// Only a verified folder page contributes ancestors; current-page omissions cannot
// erase the selected path or silently make a move destination selectable.
const breadcrumbPath = computed<{ id: number | null, name: string }[]>(() => {
  const root = [{ id: null, name: '我的文档' }]
  const folderId = currentFolderId.value
  return folderId === null ? root : [...root, ...(folderPaths.value[folderId] || [])]
})
function navigateBreadcrumb(folderId: number | null) {
  if (folderId === null) {
    void selectNode('root', 'root')
    return
  }
  const chain = folderPaths.value[folderId]
  if (!chain) return
  for (const ancestor of chain.slice(0, -1)) {
    if (!expandedFolders.value.has(ancestor.id)) {
      expandedFolders.value = new Set([...expandedFolders.value, ancestor.id])
      void loadChild(ancestor.id)
    }
  }
  void selectNode(`folder-${folderId}`, 'folder')
}

// Create document
const createDocument = async () => {
  if (!newDocName.value.trim()) {
    toast.add({ title: '请输入文档名称', color: 'warning' })
    return
  }

  isCreating.value = true
  try {
    const body = {
      title: newDocName.value.trim(),
      doc_type: 'private',
      owner_uid: uid.value,
      folder_id: currentFolderId.value
    }
    const key = documentCreationAttempt.keyFor(cacheKey('document-create'), body)
    const data = await apiFetch<CreateDocResponse>(moduleUrl('/api/documents'), {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body
    })
    documentCreationAttempt.complete(key)

    toast.add({ title: '文档创建成功', color: 'success' })
    showNewDocModal.value = false
    newDocName.value = ''
    await refreshDocs()

    const docUUId = data?.data?.uuid
    if (docUUId) {
      await navigateToEdit(docUUId)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '创建文档失败'
    toast.add({ title: message, color: 'error' })
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
    const body = { name: newFolderName.value.trim(), folder_type: 'private', owner_uid: uid.value, parent_id: currentFolderId.value }
    const key = folderCreationAttempt.keyFor(cacheKey('folder-create'), body)
    const { error } = await useFetch(moduleUrl('/api/folders'), {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body
    })

    if (error.value) {
      throw new Error(error.value.message || '创建文件夹失败')
    }
    folderCreationAttempt.complete(key)

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
    const message = err instanceof Error ? err.message : '创建文件夹失败'
    toast.add({ title: message, color: 'error' })
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

  if (validFiles.length > 30 || validFiles.some(file => file.size > 10 * 1024 * 1024)
    || validFiles.reduce((total, file) => total + file.size, 0) > 30 * 1024 * 1024) {
    toast.add({ title: '每批最多 30 个文件，单个 10 MiB、总计 30 MiB', color: 'warning' })
    input.value = ''
    return
  }

  isUploading.value = true
  const formData = new FormData()
  formData.append('doc_type', 'private')
  formData.append('owner_uid', uid.value)
  if (currentFolderId.value) {
    formData.append('folder_id', String(currentFolderId.value))
  }

  validFiles.forEach((file) => {
    formData.append('files', file)
  })

  try {
    const key = uploadAttempt.keyFor(cacheKey('document-upload'), {
      folder_id: currentFolderId.value,
      owner_uid: uid.value,
      files: await fingerprintUploadFiles(validFiles)
    })
    const result = await $fetch<UploadResult>(moduleUrl('/api/documents/upload'), {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: formData
    })
    if (result.failed === 0) uploadAttempt.complete(key)

    if (result.success > 0) {
      toast.add({ title: `成功上传 ${result.success} 个文档`, color: 'success' })
      await refreshDocs()
    }

    if (result.failed > 0) {
      toast.add({ title: `${result.failed} 个文档上传失败，请重新选择同一批文件重试`, color: 'error' })
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
const { confirm } = useConfirm()
const deleteTarget = ref<{ type: 'folder' | 'document', id: number | string, name: string } | null>(null)
const isDeleting = ref(false)

const confirmDelete = async (type: 'folder' | 'document', id: number | string, name: string) => {
  if (isDeleting.value) return
  const owner = uid.value
  if (!await confirm({ title: type === 'folder' ? '删除文件夹' : '移至回收站', message: `确认删除${type === 'folder' ? '文件夹' : '文档'}「${name}」？${type === 'folder' ? '只能删除空文件夹，删除后不可恢复。' : '文档将移至回收站，可在回收站恢复。'}`, tone: type === 'folder' ? 'danger' : 'warning', confirmLabel: '删除' })) return
  if (uid.value !== owner || isDeleting.value) return
  deleteTarget.value = { type, id, name }
  await executeDelete()
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
      // The tree is re-read only after the server confirms; a rejected delete
      // leaves the folder in place and reports why below.
      await $fetch(moduleUrl(`/api/folders/${target.id}`), { method: 'DELETE' })
      toast.add({ title: '文件夹已删除', color: 'success' })
      await refreshFolders()
    } else {
      const key = documentRecycleAttempt.keyFor(cacheKey('document-recycle'), { uuid: targetId })
      await $fetch(moduleUrl(`/api/documents/${target.id}`), { method: 'DELETE', headers: { 'Idempotency-Key': key } })
      documentRecycleAttempt.complete(key)
      toast.add({ title: '文档已删除', color: 'success' })
      await refreshDocs()
    }

    // 如果删除的是当前选中的项，回到根目录
    if ((target.type === 'folder' && selectedNodeId.value === `folder-${target.id}`)
      || isDeletingCurrentPreviewDoc) {
      await selectNode('root', 'root')
    }

    deleteTarget.value = null
  } catch (err: unknown) {
    toast.add({ title: target.type === 'folder' ? '删除文件夹失败' : '删除文档失败', description: deleteFailureMessage(err), color: 'error' })
  } finally {
    isDeleting.value = false
  }
}

function deleteFailureMessage(error: unknown) {
  const failure = error as { statusCode?: number, status?: number, data?: { message?: string, statusMessage?: string } }
  const status = Number(failure?.statusCode || failure?.status || 0)
  if (status === 401) return '登录状态已失效，请刷新页面或重新登录后重试。'
  if (status === 403) return failure.data?.message || '没有删除该对象的权限。'
  return failure?.data?.message || failure?.data?.statusMessage || '服务暂时无法完成删除，请稍后重试。'
}

// Toggle star flag (收藏)
const toggleHome = async (doc: DocRecord) => {
  const newStatus = !doc.star_flag
  // Optimistic update
  doc.star_flag = newStatus ? 1 : 0
  try {
    await $fetch(moduleUrl(`/api/documents/${doc.uuid}`), {
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
  const newStatus = !doc.readonly_flag
  // Optimistic update
  doc.readonly_flag = newStatus ? 1 : 0
  try {
    await $fetch(moduleUrl(`/api/documents/${doc.uuid}`), {
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

// Share Modal State
const isShareModalOpen = ref(false)
const sharingDocId = ref<string>('')
const sharingDocTitle = ref('')

const openShareModal = () => {
  const doc = previewDoc.value
  if (!doc) return
  sharingDocId.value = doc.uuid
  sharingDocTitle.value = doc.title
  isShareModalOpen.value = true
}

// Transfer Modal State
const isTransferModalOpen = ref(false)
const transferDocId = ref<string>('')
const transferDocTitle = ref('')

const openTransferModal = () => {
  const doc = previewDoc.value
  if (!doc) return
  transferDocId.value = doc.uuid
  transferDocTitle.value = doc.title
  isTransferModalOpen.value = true
}

const handleTransferSubmitted = async () => {
  isTransferModalOpen.value = false
  transferDocId.value = ''
  transferDocTitle.value = ''
  await refreshDocs()
}

// Move Modal State
const showMoveModal = ref(false)
const moveDoc = ref<DocRecord | null>(null)

const openMoveModal = (doc: DocRecord) => {
  moveDoc.value = doc
  showMoveModal.value = true
}

const moveDocument = async (targetFolderId: number | null) => {
  if (!moveDoc.value) return
  try {
    await $fetch(moduleUrl(`/api/documents/${moveDoc.value.uuid}`), {
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

// Navigate to edit document
const navigateToEdit = async (uuid: string) => {
  if (previewDoc.value?.uuid === uuid && previewContent.value) {
    setDocumentPreviewBootstrap(uuid, {
      content: previewContent.value,
      aiAbstract: previewAbstract.value
    })
  }

  // 清空预览内容
  previewContent.value = ''
  previewDoc.value = null

  // 等待下一帧再导航，确保编辑器清理
  await nextTick()
  navigateTo(documentUrl(uuid))
}

// 快速日志：创建/打开今天的工作日志
const isCreatingLog = ref(false)
const quickLog = async () => {
  isCreatingLog.value = true
  try {
    const today = new Date()
    const dateKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    const res = await $fetch<WorklogResponse>(moduleUrl('/api/worklogs/create'), {
      method: 'POST',
      body: {
        owner_uid: uid.value,
        owner_realname: userRealname.value || undefined,
        date: dateKey
      }
    })
    if (res.success && res.data) {
      const query = res.data.existed ? {} : { new: '1' }
      navigateTo({ path: documentUrl(res.data.uuid), query })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '创建日志失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    isCreatingLog.value = false
  }
}

// Owned-document menu uses the same explicit actions as the Host BFF.
const documentMenuItems = computed<DropdownMenuItem[][]>(() => {
  const doc = previewDoc.value
  if (!doc) return []
  const groups: DropdownMenuItem[][] = []
  if (canExportDocument.value) groups.push([{ label: '下载', icon: 'i-lucide-download', onSelect: () => downloadDocument(doc.uuid) }])
  if (canEditDocument.value) groups.push([
    { label: doc.star_flag ? '取消收藏' : '收藏', icon: doc.star_flag ? 'i-lucide-star-off' : 'i-lucide-star', onSelect: () => toggleHome(doc) },
    { label: doc.readonly_flag ? '取消只读' : '设为只读', icon: doc.readonly_flag ? 'i-lucide-lock-open' : 'i-lucide-lock', onSelect: () => toggleReadonly(doc) }
  ], [
    { label: '共享', icon: 'i-lucide-share-2', onSelect: () => openShareModal() },
    { label: '移交', icon: 'i-lucide-folder-up', onSelect: () => openTransferModal() },
    { label: '移动到', icon: 'i-lucide-folder-input', onSelect: () => openMoveModal(doc) }
  ])
  if (canDeleteDocument.value) groups.push([{ label: '删除', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => confirmDelete('document', doc.uuid, doc.title) }])
  return groups
})

// Initialize
onMounted(() => {
  // 默认选中根目录
  selectNode('root', 'root')

  setHeaderActions([
    {
      key: 'mydocs-mobile-directory',
      icon: 'i-lucide-folder-tree',
      ariaLabel: '打开目录',
      title: '目录',
      color: 'primary',
      variant: 'soft',
      size: 'sm',
      square: true,
      class: 'md:hidden',
      onClick: openDirectoryPanel
    }
  ])
})

onBeforeUnmount(() => {
  clearHeaderActions()
})
</script>

<template>
  <UDashboardPanel grow>
    <div class="px-4 pt-4 sm:px-6 sm:pt-6">
      <MyDocumentSpaceHeader description="管理个人文档、文件夹与常用资料。">
        <template #actions>
          <UButton
            :class="panelCollapsed ? '' : 'md:hidden'"
            icon="i-lucide-folder-tree"
            aria-label="打开文档目录"
            color="neutral"
            variant="outline"
            @click="openDirectoryPanel"
          >
            目录
          </UButton>
        </template>
      </MyDocumentSpaceHeader>
      <p
        v-if="loading"
        role="status"
        aria-live="polite"
        class="py-2 text-sm text-muted"
      >
        正在加载文档目录…
      </p>
      <div v-else-if="rootFolderError || rootDocumentError" class="flex flex-wrap items-center gap-2 py-2">
        <UAlert class="min-w-0 flex-1" color="error" title="文档目录加载失败，请重试" />
        <UButton color="neutral" variant="outline" @click="retryRootDocuments">
          重新加载
        </UButton>
      </div>
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
          <!-- Tree items (mixed folders and documents) -->
          <ClientOnly>
            <div>
              <div v-if="loading" class="px-2 py-4 text-sm text-muted text-center">
                加载中...
              </div>
              <CommonEmptyState
                v-else-if="rootFolderError || rootDocumentError"
                title="无法读取文档目录"
                :description="documentLoadErrorMessage(rootFolderError || rootDocumentError)"
              >
                <UButton color="neutral" variant="outline" @click="retryRootDocuments">
                  重试
                </UButton>
              </CommonEmptyState>
              <CommonEmptyState v-else-if="!rootFolderError && !rootDocumentError && treeItems.length === 0" title="暂无文档" description="首次使用可新建文档，再从文档内共享给同事协同编辑。" />
              <FileTreeItem
                v-for="item in treeItems"
                v-else
                :key="item.id"
                :item="item"
                :selected-id="selectedNodeId"
                :expanded-ids="expandedFolders"
                :can-mutate="canEditDocument"
                :can-delete="canDeleteDocument"
                :editing-id="editingId"
                :editing-name="editingName"
                @select="(id: string, type: 'folder' | 'document', data?: unknown) => selectNode(id, type, data as DocRecord | FolderRecord | undefined)"
                @toggle="toggleFolder"
                @page="changeChildPage"
                @retry-children="(id: number) => loadChild(id)"
                @start-edit="startEdit"
                @save-edit="saveEdit"
                @cancel-edit="cancelEdit"
                @delete="confirmDelete"
                @update:editing-name="(val) => editingName = val"
              />
              <div v-if="rootFolders || rootDocuments" class="space-y-1 px-2 py-2 text-xs text-muted" @click.stop>
                <span>根目录：{{ rootFolders?.total || 0 }} 个文件夹，{{ rootDocuments?.total || 0 }} 篇文档</span>
                <UPagination
                  v-if="(rootFolders?.total || 0) > PAGE_SIZE"
                  v-model:page="rootFolderPage"
                  :total="rootFolders?.total || 0"
                  :items-per-page="PAGE_SIZE"
                  :sibling-count="0"
                  show-edges
                />
                <UPagination
                  v-if="(rootDocuments?.total || 0) > PAGE_SIZE"
                  v-model:page="rootDocumentPage"
                  :total="rootDocuments?.total || 0"
                  :items-per-page="PAGE_SIZE"
                  :sibling-count="0"
                  show-edges
                />
              </div>
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
      <main class="flex-1 flex flex-col overflow-hidden bg-default">
        <!-- Toolbar (只在选中文档时显示) -->
        <div
          v-if="selectedNodeType === 'document' && previewDoc"
          class="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 border-b border-default bg-default gap-3 sm:gap-0"
        >
          <div class="flex items-center gap-1.5 text-sm font-medium overflow-hidden">
            <UButton
              class="md:hidden shrink-0 mr-1"
              icon="i-lucide-menu"
              variant="ghost"
              color="neutral"
              size="xs"
              aria-label="打开文档目录"
              @click="openDirectoryPanel"
            />
            <template v-for="(crumb, index) in breadcrumbPath" :key="crumb.id ?? 'root'">
              <UIcon
                v-if="index > 0"
                name="i-lucide-chevron-right"
                class="w-3.5 h-3.5 text-muted shrink-0"
              />
              <button
                class="text-primary hover:underline transition-colors px-1 py-0.5 rounded hover:bg-primary/5 truncate max-w-37.5"
                @click="navigateBreadcrumb(crumb.id)"
              >
                {{ crumb.name }}
              </button>
            </template>
            <UIcon name="i-lucide-chevron-right" class="w-3.5 h-3.5 text-muted shrink-0" />
            <div class="flex items-center gap-1.5 px-1 py-0.5 min-w-0">
              <UIcon name="i-lucide-file-text" class="w-4 h-4 text-muted shrink-0" />
              <span class="text-default truncate" :title="previewDoc?.title">{{ previewDoc?.title
              }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <!-- 选中文档时显示编辑按钮和下拉菜单 -->
            <UButton
              :icon="previewDoc.readonly_flag || !canEditDocument ? 'i-lucide-eye' : 'i-lucide-edit'"
              size="sm"
              color="primary"
              @click="navigateToEdit(previewDoc.uuid)"
            >
              {{ previewDoc.readonly_flag || !canEditDocument ? '查看' : '编辑' }}
            </UButton>

            <UDropdownMenu v-if="documentMenuItems.length" :items="documentMenuItems">
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

          <div
            v-if="selectedNodeType === 'root' || selectedNodeType === 'folder'"
            class="h-full flex items-center justify-center p-4"
          >
            <div class="flex flex-col items-center gap-6 md:gap-8 w-full max-w-2xl">
              <div class="text-center w-full">
                <UIcon
                  name="i-lucide-folder-open"
                  class="w-12 h-12 md:w-16 md:h-16 text-primary mx-auto mb-3 md:mb-4"
                />
                <!-- Breadcrumb as title -->
                <nav
                  v-if="breadcrumbPath.length > 1"
                  class="flex items-center justify-center gap-1 text-lg md:text-xl font-semibold mb-2 flex-wrap"
                >
                  <template v-for="(crumb, index) in breadcrumbPath" :key="crumb.id ?? 'root'">
                    <UIcon
                      v-if="index > 0"
                      name="i-lucide-chevron-right"
                      class="w-3 h-3 md:w-4 md:h-4 text-muted shrink-0"
                    />
                    <button
                      v-if="index < breadcrumbPath.length - 1"
                      class="text-primary hover:underline transition-colors px-1 py-0.5 rounded hover:bg-primary/5 break-all line-clamp-1"
                      @click="navigateBreadcrumb(crumb.id)"
                    >
                      {{ crumb.name }}
                    </button>
                    <span
                      v-else
                      class="text-default break-all line-clamp-2 max-w-50 md:max-w-none text-left"
                    >{{
                      crumb.name }}</span>
                  </template>
                </nav>
                <h3 v-else class="text-lg md:text-xl font-semibold text-default mb-2">
                  我的文档
                </h3>
                <p class="text-xs md:text-sm text-muted">
                  选择一个操作来开始
                </p>
              </div>

              <div
                class="grid grid-cols-2 md:flex gap-3 md:gap-6 w-full max-w-90 md:max-w-none mx-auto justify-center"
              >
                <!-- 快速日志按钮 -->
                <button
                  v-if="canCreateDocument"
                  class="group flex flex-col items-center justify-center aspect-square md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-default hover:border-primary hover:bg-primary/5 transition-all"
                  @click="quickLog"
                >
                  <UIcon
                    name="i-lucide-pen-line"
                    class="w-8 h-8 md:w-12 md:h-12 text-dimmed group-hover:text-primary mb-2 md:mb-3 transition-colors"
                  />
                  <span
                    class="text-xs md:text-sm font-medium text-muted group-hover:text-primary transition-colors"
                  >快速日志</span>
                </button>
                <!-- 新建文档按钮 -->
                <button
                  v-if="canCreateDocument"
                  class="group flex flex-col items-center justify-center aspect-square md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-default hover:border-primary hover:bg-primary/5 transition-all"
                  @click="showNewDocModal = true"
                >
                  <UIcon
                    name="i-lucide-file-plus"
                    class="w-8 h-8 md:w-12 md:h-12 text-dimmed group-hover:text-primary mb-2 md:mb-3 transition-colors"
                  />
                  <span
                    class="text-xs md:text-sm font-medium text-muted group-hover:text-primary transition-colors"
                  >新建文档</span>
                </button>
                <!-- 上传文档按钮 -->
                <button
                  v-if="canCreateDocument"
                  class="group flex flex-col items-center justify-center aspect-square md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-default hover:border-primary hover:bg-primary/5 transition-all"
                  @click="triggerUpload"
                >
                  <UIcon
                    name="i-lucide-upload"
                    class="w-8 h-8 md:w-12 md:h-12 text-dimmed group-hover:text-primary mb-2 md:mb-3 transition-colors"
                  />
                  <span
                    class="text-xs md:text-sm font-medium text-muted group-hover:text-primary transition-colors"
                  >上传文档</span>
                </button>
                <!-- 新建子目录按钮 -->
                <button
                  v-if="canCreateDocument"
                  class="group flex flex-col items-center justify-center aspect-square md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-default hover:border-primary hover:bg-primary/5 transition-all"
                  @click="showNewFolderModal = true"
                >
                  <UIcon
                    name="i-lucide-folder-plus"
                    class="w-8 h-8 md:w-12 md:h-12 text-dimmed group-hover:text-primary mb-2 md:mb-3 transition-colors"
                  />
                  <span
                    class="text-xs md:text-sm font-medium text-muted group-hover:text-primary transition-colors"
                  >新建子目录</span>
                </button>
              </div>
            </div>
          </div>

          <!-- 文档预览 -->
          <div
            v-else-if="selectedNodeType === 'document'"
            class="max-w-4xl mx-auto bg-default shadow-sm rounded-lg min-h-full p-0 relative"
          >
            <!-- Loading -->
            <div
              v-if="previewLoading"
              class="absolute inset-0 flex items-center justify-center bg-default/80 z-10"
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
                  <p class="text-sm text-default leading-relaxed mt-0.5">
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
    <UModal v-model:open="showNewDocModal" :ui="{ content: 'sm:max-w-lg' }">
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

    <!-- Share Modal -->
    <DocumentShareDocumentModal
      :open="isShareModalOpen"
      :doc-id="sharingDocId"
      :doc-title="sharingDocTitle"
      @update:open="isShareModalOpen = $event"
    />

    <DocumentTransferDocumentModal
      :open="isTransferModalOpen"
      :doc-id="transferDocId"
      :doc-title="transferDocTitle"
      @update:open="isTransferModalOpen = $event"
      @submitted="handleTransferSubmitted"
    />

    <!-- Move Modal -->
    <MoveFolderModal
      :open="showMoveModal"
      :folders="[]"
      :load-page="fetchFolderPage"
      :current-folder-id="moveDoc?.folder_id ?? null"
      :doc-title="moveDoc?.title || ''"
      @update:open="showMoveModal = $event"
      @confirm="moveDocument"
    />
  </UDashboardPanel>
</template>
