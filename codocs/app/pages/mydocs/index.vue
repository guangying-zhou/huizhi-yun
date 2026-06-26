<script setup lang="ts">
import type { ProjectDocsTreeItem } from '~/types'

definePageMeta({
  layout: 'default'
})

usePageTitle('我的文档')

// Record types for API responses
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
const { user, userRealname } = useAuth()
const { setPayload: setDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()
const { setHeaderActions, clearHeaderActions } = useLayoutHeaderActions()
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

// Inline editing
const editingId = ref<string | null>(null) // 'folder-{id}' or 'doc-{uuid}'
const editingName = ref('')

// Fetch all folders
const fetchAllFolders = async () => {
  if (!user.value) return []
  const response = await apiFetch<{ data: { items: FolderRecord[] } }>('/api/folders', {
    query: {
      folder_type: 'private',
      owner_uid: uid.value
    }
  })
  return response?.data?.items || []
}

// Fetch all documents
const fetchAllDocuments = async () => {
  if (!user.value) return []
  const response = await apiFetch<{ data: { items: DocRecord[] } }>('/api/documents', {
    query: {
      type: 'private',
      owner: uid.value,
      exclude_worklogs: 1
    }
  })
  return response?.data?.items || []
}

const { data: allFolders, pending: foldersPending, refresh: refreshFolders } = await useAsyncData(
  'my-private-folders',
  fetchAllFolders,
  {
    watch: [user],
    immediate: true,
    getCachedData: () => undefined
  }
)

const { data: allDocuments, pending: docsPending, refresh: refreshDocs } = await useAsyncData(
  'my-all-private-docs',
  fetchAllDocuments,
  {
    watch: [user],
    immediate: true,
    getCachedData: () => undefined
  }
)

const loading = computed(() => docsPending.value || foldersPending.value)

// Watch for user authentication
watch(user, (newUser) => {
  if (newUser) {
    refreshFolders()
    refreshDocs()
  }
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
    const response = await $fetch<DocDetailResponse>(`/api/documents/${doc.uuid}`)
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

// Build breadcrumb path from root to current folder
const breadcrumbPath = computed<{ id: number | null, name: string }[]>(() => {
  const path: { id: number | null, name: string }[] = [{ id: null, name: '我的文档' }]
  if (selectedNodeType.value === 'root') return path

  const folderId = currentFolderId.value
  if (folderId === null) return path

  // Walk up the parent chain
  const folders = allFolders.value || []
  const chain: { id: number, name: string }[] = []
  let currentId: number | null = folderId
  while (currentId !== null) {
    const folder = folders.find((f: FolderRecord) => f.id === currentId)
    if (!folder) break
    chain.unshift({ id: folder.id, name: folder.name })
    currentId = folder.parent_id
  }
  return [...path, ...chain]
})

// Navigate breadcrumb
const navigateBreadcrumb = (folderId: number | null) => {
  if (folderId === null) {
    selectNode('root', 'root')
  } else {
    const folder = (allFolders.value || []).find((f: FolderRecord) => f.id === folderId)
    if (folder) {
      selectNode(`folder-${folderId}`, 'folder', folder)
      // Ensure all ancestor folders are expanded
      let parentId = folder.parent_id
      while (parentId !== null) {
        expandedFolders.value.add(parentId)
        const parent = (allFolders.value || []).find((f: FolderRecord) => f.id === parentId)
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
    const { data, error } = await useFetch('/api/documents', {
      method: 'POST',
      body: {
        title: newDocName.value.trim(),
        doc_type: 'private',
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

    const docUUId = (data.value as CreateDocResponse)?.data?.uuid
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
    const { error } = await useFetch('/api/folders', {
      method: 'POST',
      body: {
        name: newFolderName.value.trim(),
        folder_type: 'private',
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
    const result = await $fetch<UploadResult>('/api/documents/upload', {
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

// Toggle star flag (收藏)
const toggleHome = async (doc: DocRecord) => {
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
  navigateTo(`/documents/${uuid}`)
}

// 快速日志：创建/打开今天的工作日志
const isCreatingLog = ref(false)
const quickLog = async () => {
  isCreatingLog.value = true
  try {
    const today = new Date()
    const dateKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    const res = await $fetch<WorklogResponse>('/api/worklogs/create', {
      method: 'POST',
      body: {
        owner_uid: uid.value,
        owner_realname: userRealname.value || undefined,
        date: dateKey
      }
    })
    if (res.success && res.data) {
      const query = res.data.existed ? {} : { new: '1' }
      navigateTo({ path: `/documents/${res.data.uuid}`, query })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '创建日志失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    isCreatingLog.value = false
  }
}

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
      onClick: () => {
        showMobileSidebar.value = true
      }
    }
  ])
})

onBeforeUnmount(() => {
  clearHeaderActions()
})
</script>

<template>
  <UDashboardPanel grow>
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
              <div v-else-if="treeItems.length === 0" class="px-2 py-4 text-sm text-muted text-center">
                暂无文档
              </div>
              <FileTreeItem
                v-for="item in treeItems"
                v-else
                :key="item.id"
                :item="item"
                :selected-id="selectedNodeId"
                :expanded-ids="expandedFolders"
                :editing-id="editingId"
                :editing-name="editingName"
                @select="(id: string, type: 'folder' | 'document', data?: unknown) => selectNode(id, type, data as DocRecord | FolderRecord | undefined)"
                @toggle="toggleFolder"
                @start-edit="startEdit"
                @save-edit="saveEdit"
                @cancel-edit="cancelEdit"
                @delete="confirmDelete"
                @update:editing-name="(val) => editingName = val"
              />
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
              @click="showMobileSidebar = true"
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
              <UIcon name="i-lucide-file-text" class="w-4 h-4 text-gray-500 shrink-0" />
              <span class="text-default truncate" :title="previewDoc?.title">{{ previewDoc?.title
              }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <!-- 选中文档时显示编辑按钮和下拉菜单 -->
            <UButton
              :icon="previewDoc.readonly_flag ? 'i-lucide-eye' : 'i-lucide-edit'"
              size="sm"
              color="primary"
              @click="navigateToEdit(previewDoc.uuid)"
            >
              {{ previewDoc.readonly_flag ? '查看' : '编辑' }}
            </UButton>

            <UDropdownMenu
              :items="[
                [{
                  label: '下载',
                  icon: 'i-lucide-download',
                  onSelect: () => downloadDocument(previewDoc!.uuid)
                }],
                [{
                  label: previewDoc!.star_flag ? '取消收藏' : '收藏',
                  icon: previewDoc!.star_flag ? 'i-lucide-star-off' : 'i-lucide-star',
                  onSelect: () => toggleHome(previewDoc!)
                }, {
                  label: previewDoc!.readonly_flag ? '取消只读' : '设为只读',
                  icon: previewDoc!.readonly_flag ? 'i-lucide-lock-open' : 'i-lucide-lock',
                  onSelect: () => toggleReadonly(previewDoc!)
                }],
                [{
                  label: '共享',
                  icon: 'i-lucide-share-2',
                  onSelect: () => openShareModal()
                }, {
                  label: '移交',
                  icon: 'i-lucide-folder-up',
                  onSelect: () => openTransferModal()
                }, {
                  label: '移动到',
                  icon: 'i-lucide-folder-input',
                  onSelect: () => openMoveModal(previewDoc!)
                }],
                [{
                  label: '删除',
                  icon: 'i-lucide-trash-2',
                  color: 'error' as const,
                  onSelect: () => confirmDelete('document', previewDoc!.uuid, previewDoc!.title)
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
                  class="group flex flex-col items-center justify-center aspect-square md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all"
                  @click="quickLog"
                >
                  <UIcon
                    name="i-lucide-pen-line"
                    class="w-8 h-8 md:w-12 md:h-12 text-gray-400 group-hover:text-primary mb-2 md:mb-3 transition-colors"
                  />
                  <span
                    class="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400 group-hover:text-primary transition-colors"
                  >快速日志</span>
                </button>
                <!-- 新建文档按钮 -->
                <button
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
                <!-- 上传文档按钮 -->
                <button
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
                <!-- 新建子目录按钮 -->
                <button
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
      :folders="allFolders || []"
      :current-folder-id="moveDoc?.folder_id ?? null"
      :doc-title="moveDoc?.title || ''"
      @update:open="showMoveModal = $event"
      @confirm="moveDocument"
    />
  </UDashboardPanel>
</template>
