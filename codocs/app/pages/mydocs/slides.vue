<script setup lang="ts">
/**
 * 演示文稿页面
 * 左侧文稿列表，右侧幻灯片预览
 * 使用 Slidev Markdown 语法（--- 分隔幻灯片）
 */

import type { ProjectDocsTreeItem } from '~/types'

definePageMeta({ layout: 'default' })

usePageTitle('演示文稿')

interface DocRecord {
  uuid: string
  title: string
  folder_id: number | null
  updated_at?: string
  created_at?: string
  [key: string]: unknown
}

interface DocListResponse {
  data?: { items: DocRecord[] }
}

interface DocDetailResponse {
  success: boolean
  data: { content?: string }
}

interface FolderRecord {
  id: number
  name: string
  parent_id: number | null
  [key: string]: unknown
}

interface FolderListResponse {
  data: { items: FolderRecord[] }
}

interface CreateDocResponse {
  data?: { uuid?: string }
}

const toast = useToast()
const apiFetch = useRequestFetch()
const { user } = useAuth()
const uid = computed(() => user.value || 'user1')

// Layout
const { panelWidth, panelCollapsed, onResizeStart, showPanel } = useResizablePanel(260)
const showMobileSidebar = ref(false)

// 文稿列表
const selectedNodeId = ref<string>('') // 'doc-{uuid}' 或 'folder-{id}'
const selectedSlideUuid = ref<string | null>(null)
const selectedSlide = ref<DocRecord | null>(null)
const previewContent = ref('')
const previewLoading = ref(false)

// 创建弹窗
const showNewModal = ref(false)
const newSlideName = ref('')
const isCreating = ref(false)

// 保存状态
const isSaving = ref(false)

// 示例模式（查看 Demo，不可保存）
const isDemoMode = ref(false)

// Slidev URL（用于全屏演示组件）
const builtSlideUrl = ref('')

// 新建目录
const showNewFolderModal = ref(false)
const newFolderName = ref('')
const isCreatingFolder = ref(false)

const createFolder = async () => {
  if (!newFolderName.value.trim()) return
  isCreatingFolder.value = true
  try {
    await $fetch('/api/folders', {
      method: 'POST',
      body: {
        name: newFolderName.value.trim(),
        folder_type: 'slide',
        owner_uid: uid.value,
        parent_id: null
      }
    })
    toast.add({ title: '目录创建成功', color: 'success' })
    showNewFolderModal.value = false
    newFolderName.value = ''
    await refreshFolders()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || error.message || '创建失败', color: 'error' })
  } finally {
    isCreatingFolder.value = false
  }
}

// 重命名
const showRenameModal = ref(false)
const renameValue = ref('')

const openRename = () => {
  if (!selectedSlide.value) return
  renameValue.value = selectedSlide.value.title
  showRenameModal.value = true
}

const executeRename = async () => {
  if (!selectedSlide.value || !renameValue.value.trim()) return
  try {
    await $fetch(`/api/documents/${selectedSlide.value.uuid}`, {
      method: 'PATCH',
      body: { title: renameValue.value.trim() }
    })
    toast.add({ title: '重命名成功', color: 'success' })
    selectedSlide.value.title = renameValue.value.trim()
    showRenameModal.value = false
    await refresh()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || error.message || '重命名失败', color: 'error' })
  }
}

// 移动文件
const showMoveModal = ref(false)

const onMoveConfirm = async (targetFolderId: number | null) => {
  if (!selectedSlide.value) return
  try {
    await $fetch(`/api/documents/${selectedSlide.value.uuid}`, {
      method: 'PATCH',
      body: { folder_id: targetFolderId }
    })
    toast.add({ title: '移动成功', color: 'success' })
    showMoveModal.value = false
    deselectSlide()
    await refresh()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || error.message || '移动失败', color: 'error' })
  }
}

// 获取所有私有文件夹（移动时用）
const { data: allFolders } = await useAsyncData(
  'slides-all-folders',
  async () => {
    if (!user.value) return []
    const res = await apiFetch<FolderListResponse>('/api/folders', {
      query: { folder_type: 'slide', owner_uid: uid.value }
    })
    return res?.data?.items || []
  },
  { watch: [user], immediate: true, getCachedData: () => undefined }
)

// 删除
const showDeleteConfirm = ref(false)
const deleteTarget = ref<DocRecord | null>(null)
const isDeleting = ref(false)

// 获取演示文稿目录
const fetchSlideFolders = async () => {
  if (!user.value) return []
  const res = await apiFetch<FolderListResponse>('/api/folders', {
    query: { folder_type: 'slide', owner_uid: uid.value }
  })
  return res?.data?.items || []
}

// 获取所有演示文稿文档
const fetchSlides = async () => {
  if (!user.value) return []
  const response = await apiFetch<DocListResponse>('/api/documents', {
    query: { type: 'slide', owner: uid.value }
  })
  return response?.data?.items || []
}

const { data: slideFolders, pending: foldersPending, refresh: refreshFolders } = await useAsyncData(
  'slide-folders',
  fetchSlideFolders,
  { watch: [user], immediate: true, getCachedData: () => undefined }
)

const { data: slides, pending: docsPending, refresh: refreshDocs } = await useAsyncData(
  'my-slides',
  fetchSlides,
  { watch: [user, slideFolders], immediate: true, getCachedData: () => undefined }
)

const pending = computed(() => foldersPending.value || docsPending.value)

const refresh = async () => {
  await refreshFolders()
  await refreshDocs()
}

// 树形结构
const expandedFolders = ref<Set<number>>(new Set())

const toggleFolder = (folderId: number) => {
  if (expandedFolders.value.has(folderId)) {
    expandedFolders.value.delete(folderId)
  } else {
    expandedFolders.value.add(folderId)
  }
  expandedFolders.value = new Set(expandedFolders.value)
}

const buildTreeItems = (parentId: number | null): ProjectDocsTreeItem[] => {
  const folders = slideFolders.value || []
  const documents = slides.value || []
  const items: ProjectDocsTreeItem[] = []

  folders.filter(f => f.parent_id === parentId).forEach((folder) => {
    items.push({
      type: 'folder',
      id: folder.id,
      nodeId: `folder-${folder.id}`,
      name: folder.name,
      data: folder,
      children: buildTreeItems(folder.id)
    })
  })

  documents.filter(d => d.folder_id === parentId).forEach((doc) => {
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
  return buildTreeItems(null)
})

// 面包屑：从演示文稿根到当前文稿的文件夹路径
const breadcrumbPath = computed<{ id: number | null, name: string }[]>(() => {
  const path: { id: number | null, name: string }[] = []
  if (!selectedSlide.value || !selectedSlide.value.folder_id) return path

  const folders = slideFolders.value || []
  const chain: { id: number, name: string }[] = []
  let currentId: number | null = selectedSlide.value.folder_id

  while (currentId !== null) {
    const folder = folders.find(f => f.id === currentId)
    if (!folder) break
    chain.unshift({ id: folder.id, name: folder.name })
    currentId = folder.parent_id
  }

  return chain
})

// 内联编辑（重命名文件夹/文档）
const editingId = ref<string | null>(null)
const editingName = ref('')

const startEdit = (id: string, name: string) => {
  editingId.value = id
  editingName.value = name
}

const saveEdit = async () => {
  if (!editingId.value || !editingName.value.trim()) {
    editingId.value = null
    return
  }
  try {
    if (editingId.value.startsWith('folder-')) {
      const folderId = parseInt(editingId.value.replace('folder-', ''))
      await $fetch(`/api/folders/${folderId}`, { method: 'PATCH', body: { name: editingName.value.trim() } })
      toast.add({ title: '文件夹已重命名', color: 'success' })
      await refreshFolders()
    } else if (editingId.value.startsWith('doc-')) {
      const docUuid = editingId.value.replace('doc-', '')
      await $fetch(`/api/documents/${docUuid}`, { method: 'PATCH', body: { title: editingName.value.trim() } })
      toast.add({ title: '文稿已重命名', color: 'success' })
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

// 从树节点选中文稿
const onTreeSelect = (nodeId: string, nodeType: 'folder' | 'document', data?: unknown) => {
  selectedNodeId.value = nodeId
  if (nodeType === 'document' && data) {
    selectSlide(data as DocRecord)
  } else if (nodeType === 'folder') {
    const folderId = parseInt(nodeId.replace('folder-', ''))
    toggleFolder(folderId)
  }
}

const onTreeDelete = (type: 'folder' | 'document', id: number | string) => {
  if (type === 'document') {
    const doc = (slides.value || []).find(d => d.uuid === id)
    if (doc) confirmDelete(doc)
  } else {
    // 删除文件夹
    deleteFolderById(id as number)
  }
}

const deleteFolderById = async (folderId: number) => {
  try {
    await $fetch(`/api/folders/${folderId}`, { method: 'DELETE' })
    toast.add({ title: '文件夹已删除', color: 'success' })
    await refresh()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '删除失败'
    toast.add({ title: message, color: 'error' })
  }
}

// 选中文稿
const selectSlide = async (doc: DocRecord) => {
  if (selectedSlideUuid.value === doc.uuid) return
  selectedNodeId.value = `doc-${doc.uuid}`
  selectedSlideUuid.value = doc.uuid
  selectedSlide.value = doc
  previewLoading.value = true
  previewContent.value = ''
  builtSlideUrl.value = ''
  isDemoMode.value = false
  showMobileSidebar.value = false
  panelCollapsed.value = true

  try {
    const response = await $fetch<DocDetailResponse>(`/api/documents/${doc.uuid}`)
    if (response.success && response.data) {
      previewContent.value = response.data.content || ''
    }
  } catch {
    toast.add({ title: '加载文稿失败', color: 'error' })
  } finally {
    previewLoading.value = false
  }
}

const deselectSlide = () => {
  selectedNodeId.value = ''
  selectedSlideUuid.value = null
  selectedSlide.value = null
  previewContent.value = ''
  builtSlideUrl.value = ''
  isDemoMode.value = false
  panelCollapsed.value = false
}

// 查看示例
const viewDemo = async () => {
  isDemoMode.value = true
  selectedNodeId.value = '__demo__'
  selectedSlideUuid.value = '__demo__'
  selectedSlide.value = { uuid: '__demo__', title: '示例文稿' } as DocRecord
  previewLoading.value = true
  previewContent.value = ''
  builtSlideUrl.value = ''
  panelCollapsed.value = true

  try {
    const res = await $fetch<{ success: boolean, data?: { content: string } }>('/api/slides/demo')
    if (res.success && res.data?.content) {
      previewContent.value = res.data.content
    }
  } catch {
    toast.add({ title: '加载示例失败', color: 'error' })
    deselectSlide()
  } finally {
    previewLoading.value = false
  }
}

// 默认模板
const defaultTemplate = `---
background: default
---

# 新建演示文稿

使用 Markdown 创建精美幻灯片

---

## 编辑提示

- 每张幻灯片之间用**水平分隔线**隔开
- 在编辑器中输入 \`---\` 即可插入分隔线
- 支持**粗体**、*斜体*、\`行内代码\`
- 支持列表、表格、引用、代码高亮等

---

## 代码高亮

\`\`\`javascript
function hello(name) {
  console.log(\`Hello, \${name}!\`)
}

hello('World')
\`\`\`

---

## 感谢观看

`

// 创建文稿
const createSlide = async () => {
  if (!newSlideName.value.trim()) {
    toast.add({ title: '请输入文稿名称', color: 'warning' })
    return
  }

  isCreating.value = true
  try {
    const content = defaultTemplate.replace(/新建演示文稿/g, newSlideName.value.trim())

    const { data, error } = await useFetch('/api/documents', {
      method: 'POST',
      body: {
        title: newSlideName.value.trim(),
        doc_type: 'slide',
        owner_uid: uid.value,
        folder_id: null,
        content
      }
    })

    if (error.value) throw new Error(error.value.message || '创建失败')

    toast.add({ title: '文稿创建成功', color: 'success' })
    showNewModal.value = false
    newSlideName.value = ''
    await refresh()

    const docUuid = (data.value as CreateDocResponse)?.data?.uuid
    if (docUuid) {
      // 选中新建的文稿
      const newDoc = (slides.value || []).find(d => d.uuid === docUuid)
      if (newDoc) {
        await selectSlide(newDoc)
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '创建失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    isCreating.value = false
  }
}

// 保存：从 Slidev 读回最新内容，存到 OSS
const saveToOSS = async () => {
  if (!selectedSlide.value) return
  isSaving.value = true
  try {
    // 1. 从 slidev-service 读回当前编辑内容
    const contentRes = await $fetch<{ success: boolean, data?: { content: string } }>('/api/slides/content')
    if (!contentRes.success || !contentRes.data?.content) {
      toast.add({ title: '读取内容失败', color: 'error' })
      return
    }

    // 2. 存到 OSS
    await $fetch(`/api/documents/${selectedSlide.value.uuid}`, {
      method: 'PUT',
      body: { content: contentRes.data.content, saveMode: 'overwrite' }
    })

    previewContent.value = contentRes.data.content
    toast.add({ title: '保存成功', color: 'success' })
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || error.message || '保存失败', color: 'error' })
  } finally {
    isSaving.value = false
  }
}

const onSlideBuilt = (url: string) => {
  builtSlideUrl.value = url
}

// 导出
const isExporting = ref(false)

const exportSlides = async (format: 'pdf' | 'pptx') => {
  if (!selectedSlide.value || !previewContent.value) return
  isExporting.value = true
  try {
    const res = await $fetch<{ success: boolean, data?: { url: string, filename: string } }>('/api/slides/export', {
      method: 'POST',
      body: {
        content: previewContent.value,
        format,
        filename: selectedSlide.value.title
      },
      timeout: 130_000
    })

    if (res.success && res.data?.url) {
      // 下载文件
      const link = document.createElement('a')
      link.href = res.data.url
      link.download = res.data.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.add({ title: `导出 ${format.toUpperCase()} 成功`, color: 'success' })
    }
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: error.data?.message || error.message || '导出失败', color: 'error' })
  } finally {
    isExporting.value = false
  }
}

// 删除
const confirmDelete = (doc: DocRecord) => {
  deleteTarget.value = doc
  showDeleteConfirm.value = true
}

const executeDelete = async () => {
  if (!deleteTarget.value) return
  isDeleting.value = true
  try {
    await $fetch(`/api/documents/${deleteTarget.value.uuid}`, { method: 'DELETE' })
    toast.add({ title: '文稿已删除', color: 'success' })
    if (selectedSlide.value?.uuid === deleteTarget.value.uuid) deselectSlide()
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

// 将操作按钮注册到布局标题栏
const { setHeaderActions, clearHeaderActions } = useLayoutHeaderActions()

watchEffect(() => {
  const actions: LayoutHeaderAction[] = [
    {
      key: 'slides-list-mobile',
      icon: 'i-lucide-list',
      label: '列表',
      color: 'primary',
      variant: 'soft',
      size: 'sm',
      class: 'md:hidden',
      onClick: () => { showMobileSidebar.value = true }
    }
  ]

  if (panelCollapsed.value) {
    actions.push({
      key: 'slides-list-desktop',
      icon: 'i-lucide-list',
      label: '列表',
      variant: 'ghost',
      size: 'sm',
      class: 'hidden md:flex',
      onClick: () => { showPanel() }
    })
  }

  actions.push(
    {
      key: 'slides-new',
      icon: 'i-lucide-plus',
      label: '新建文稿',
      color: 'primary',
      size: 'sm',
      onClick: () => { showNewModal.value = true }
    },
    {
      key: 'slides-demo',
      icon: 'i-lucide-play-circle',
      label: '示例',
      color: 'neutral',
      variant: 'ghost',
      size: 'sm',
      title: '查看示例文稿',
      show: !selectedSlide.value || isDemoMode.value,
      onClick: () => { viewDemo() }
    }
  )

  setHeaderActions(actions)
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

      <!-- Left: Slide List -->
      <aside
        v-if="!panelCollapsed"
        class="absolute md:relative inset-y-0 left-0 z-30 border-r border-default bg-default flex flex-col overflow-y-auto transform transition-transform duration-200"
        :class="[showMobileSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0']"
        :style="{ width: panelWidth + 'px' }"
      >
        <div class="flex-1">
          <!-- Loading -->
          <ClientOnly>
            <div v-if="pending" class="px-2 py-4 text-sm text-muted text-center">
              加载中...
            </div>
            <div v-else-if="treeItems.length === 0" class="px-4 py-8 text-center">
              <UIcon name="i-lucide-presentation" class="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
              <p class="text-sm text-muted">
                暂无文稿
              </p>
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
              @select="(id: string, type: 'folder' | 'document', data?: unknown) => onTreeSelect(id, type, data)"
              @toggle="toggleFolder"
              @start-edit="startEdit"
              @save-edit="saveEdit"
              @cancel-edit="cancelEdit"
              @delete="onTreeDelete"
              @update:editing-name="(val) => editingName = val"
            />
          </ClientOnly>
        </div>
      </aside>

      <!-- Resize handle -->
      <div
        v-if="!panelCollapsed"
        class="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-default hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 -ml-px"
        @mousedown.prevent="onResizeStart"
      />

      <!-- Right: Preview -->
      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <!-- Toolbar -->
        <div
          v-if="selectedSlide"
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
            <button
              class="text-primary hover:underline transition-colors px-1 py-0.5 rounded hover:bg-primary/5 shrink-0"
              @click="deselectSlide"
            >
              演示文稿
            </button>
            <template v-for="crumb in breadcrumbPath" :key="crumb.id">
              <UIcon name="i-lucide-chevron-right" class="w-3.5 h-3.5 text-muted shrink-0" />
              <span class="text-muted px-1 py-0.5 truncate max-w-32" :title="crumb.name">
                {{ crumb.name }}
              </span>
            </template>
            <UIcon name="i-lucide-chevron-right" class="w-3.5 h-3.5 text-muted shrink-0" />
            <div class="flex items-center gap-1.5 px-1 py-0.5 min-w-0">
              <UIcon name="i-lucide-presentation" class="w-4 h-4 text-gray-500 shrink-0" />
              <span class="text-default truncate" :title="selectedSlide.title">
                {{ selectedSlide.title }}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <span class="text-xs text-muted hidden sm:inline">鼠标移至左下角显示操作栏</span>
            <UButton
              v-if="!isDemoMode"
              icon="i-lucide-save"
              size="sm"
              color="primary"
              :loading="isSaving"
              @click="saveToOSS"
            >
              保存
            </UButton>
            <UDropdownMenu
              v-if="!isDemoMode"
              :items="[
                [{
                  label: '重命名',
                  icon: 'i-lucide-pencil',
                  onSelect: () => openRename()
                }, {
                  label: '移动到',
                  icon: 'i-lucide-folder-input',
                  onSelect: () => showMoveModal = true
                }],
                [{
                  label: '导出 PDF',
                  icon: 'i-lucide-file-text',
                  disabled: isExporting,
                  onSelect: () => exportSlides('pdf')
                }, {
                  label: '导出 PPTX',
                  icon: 'i-lucide-presentation',
                  disabled: isExporting,
                  onSelect: () => exportSlides('pptx')
                }],
                [{
                  label: '删除',
                  icon: 'i-lucide-trash-2',
                  color: 'error' as const,
                  onSelect: () => confirmDelete(selectedSlide!)
                }]
              ]"
            >
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis"
                size="sm"
                :loading="isExporting"
              />
            </UDropdownMenu>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              title="关闭文稿"
              @click="deselectSlide"
            />
          </div>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-hidden">
          <!-- Empty state -->
          <div
            v-if="!selectedSlide"
            class="h-full flex items-center justify-center p-4"
          >
            <div class="flex flex-col items-center gap-6 md:gap-8 w-full max-w-2xl">
              <div class="text-center w-full">
                <UIcon name="i-lucide-presentation" class="w-12 h-12 md:w-16 md:h-16 text-primary mx-auto mb-3 md:mb-4" />
                <h3 class="text-lg md:text-xl font-semibold text-default mb-2">
                  演示文稿
                </h3>
                <p class="text-xs md:text-sm text-muted mb-1">
                  使用 Markdown 创建幻灯片，用水平分隔线分隔每页
                </p>
                <p class="text-xs text-muted">
                  支持代码高亮、图表、公式，全屏演示
                </p>
              </div>

              <div class="flex gap-3 md:gap-6 justify-center">
                <button
                  class="group flex flex-col items-center justify-center w-32 h-32 md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all"
                  @click="showNewModal = true"
                >
                  <UIcon name="i-lucide-plus" class="w-8 h-8 md:w-12 md:h-12 text-gray-400 group-hover:text-primary mb-2 md:mb-3 transition-colors" />
                  <span class="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400 group-hover:text-primary transition-colors">新建文稿</span>
                </button>
                <button
                  class="group flex flex-col items-center justify-center w-32 h-32 md:w-40 md:h-40 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-primary hover:bg-primary/5 transition-all"
                  @click="showNewFolderModal = true"
                >
                  <UIcon name="i-lucide-folder-plus" class="w-8 h-8 md:w-12 md:h-12 text-gray-400 group-hover:text-primary mb-2 md:mb-3 transition-colors" />
                  <span class="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400 group-hover:text-primary transition-colors">新建目录</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Loading -->
          <div v-else-if="previewLoading" class="h-full flex items-center justify-center">
            <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
          </div>

          <!-- Slide preview -->
          <ClientOnly v-else-if="previewContent">
            <SlidePreview
              :content="previewContent"
              @built="onSlideBuilt"
            />
          </ClientOnly>

          <!-- No content -->
          <div v-else class="h-full flex items-center justify-center">
            <div class="text-center">
              <UIcon name="i-lucide-file-text" class="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p class="text-sm text-muted">
                文稿内容为空
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- New Slide Modal -->
    <UModal v-model:open="showNewModal" :ui="{ content: 'sm:max-w-lg' }">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                新建演示文稿
              </h3>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                @click="showNewModal = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <UFormField label="文稿名称">
              <UInput
                v-model="newSlideName"
                placeholder="请输入演示文稿名称"
                autofocus
                class="w-full"
                @keyup.enter="createSlide"
              />
            </UFormField>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showNewModal = false">
                取消
              </UButton>
              <UButton color="primary" :loading="isCreating" @click="createSlide">
                创建
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- Delete Confirm -->
    <UModal v-model:open="showDeleteConfirm" title="确认删除">
      <template #body>
        <p class="text-sm text-default">
          确定要删除 <strong>{{ deleteTarget?.title }}</strong> 吗？
        </p>
      </template>
      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="showDeleteConfirm = false">
            取消
          </UButton>
          <UButton color="error" :loading="isDeleting" @click="executeDelete">
            删除
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Rename Modal -->
    <UModal v-model:open="showRenameModal" :ui="{ content: 'w-96' }">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                重命名
              </h3>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                @click="showRenameModal = false"
              />
            </div>
          </template>
          <UFormField label="文稿名称">
            <UInput
              v-model="renameValue"
              placeholder="请输入新名称"
              autofocus
              @keyup.enter="executeRename"
            />
          </UFormField>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showRenameModal = false">
                取消
              </UButton>
              <UButton color="primary" :disabled="!renameValue.trim()" @click="executeRename">
                确定
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- New Folder Modal -->
    <UModal v-model:open="showNewFolderModal" :ui="{ content: 'w-96' }">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                新建目录
              </h3>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                @click="showNewFolderModal = false"
              />
            </div>
          </template>
          <UFormField label="目录名称">
            <UInput
              v-model="newFolderName"
              placeholder="请输入目录名称"
              autofocus
              class="w-full"
              @keyup.enter="createFolder"
            />
          </UFormField>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="showNewFolderModal = false">
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
        </UCard>
      </template>
    </UModal>

    <!-- Move Modal -->
    <MoveFolderModal
      :open="showMoveModal"
      :folders="allFolders || []"
      :current-folder-id="selectedSlide?.folder_id ?? null"
      :doc-title="selectedSlide?.title"
      @update:open="showMoveModal = $event"
      @confirm="onMoveConfirm"
    />
  </UDashboardPanel>
</template>
