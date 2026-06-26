<script setup lang="ts">
/**
 * 组织资产浏览器 — 左侧目录/文件列表 + 右侧文档预览
 * Props: subdir (OSS company 子目录名), title (页面标题)
 */
interface AssetItem {
  name: string
  path: string
  isDirectory: boolean
  lastModified?: string
}

interface AssetListResponse {
  data?: AssetItem[]
}

interface FetchErrorLike {
  data?: { message?: string }
  message?: string
}

const props = defineProps<{ subdir: string, title: string, hideExport?: boolean }>()

usePageTitle(props.title)

const toast = useToast()
const { panelWidth, panelCollapsed, onResizeStart, showPanel } = useResizablePanel(288)
const { hasPermission } = usePermissions()
const isAdmin = computed(() => hasPermission('company', 'admin'))
const { watermarkText } = useViewerWatermark()
const isKnowledgeLibrary = computed(() => props.subdir === 'knowledge')
const canImportKnowledge = computed(() => isAdmin.value && isKnowledgeLibrary.value)

// 当前浏览路径（相对于 subdir 的路径段）
const pathStack = ref<{ name: string, path: string }[]>([])
const currentRelPath = computed(() => pathStack.value.map(p => p.name).join('/'))
const currentDirectoryLabel = computed(() => currentRelPath.value ? `/${currentRelPath.value}` : '/')

// 文件列表
const items = ref<AssetItem[]>([])
const pending = ref(false)

const refresh = async () => {
  pending.value = true
  try {
    const result = await $fetch<AssetListResponse>('/api/company-assets/list', {
      params: { subdir: props.subdir, path: currentRelPath.value || undefined }
    })
    items.value = result.data || []
  } catch (error: unknown) {
    console.error('Failed to load company assets:', error)
    const err = error as FetchErrorLike
    toast.add({
      title: '加载目录失败',
      description: err?.data?.message || err?.message || '无法获取文件列表',
      color: 'error'
    })
  } finally {
    pending.value = false
  }
}

watch([() => props.subdir, currentRelPath], () => {
  refresh()
}, { immediate: true })

// 选中文件
const selectedFile = ref<AssetItem | null>(null)
const previewContent = ref('')
const previewLoading = ref(false)
const previewUrl = ref('')
const previewFileExt = ref('')

const selectFile = async (item: AssetItem) => {
  if (item.isDirectory) {
    pathStack.value = [...pathStack.value, { name: item.name, path: item.path }]
    selectedFile.value = null
    previewContent.value = ''
    previewUrl.value = ''
    previewFileExt.value = ''
    return
  }
  selectedFile.value = item
  previewLoading.value = true
  previewContent.value = ''
  previewUrl.value = ''
  previewFileExt.value = ''
  try {
    const res = await $fetch<{ code: number, data: { content?: string, preview_url?: string, file_ext?: string } }>('/api/company-assets/preview', { params: { path: item.path } })
    previewContent.value = res.data?.content || ''
    previewUrl.value = res.data?.preview_url || ''
    previewFileExt.value = res.data?.file_ext || ''
  } catch {
    previewContent.value = ''
    toast.add({ title: '无法加载文件内容', color: 'error' })
  } finally {
    previewLoading.value = false
  }
}

// 导航到面包屑
const navigateTo_ = (index: number) => {
  pathStack.value = pathStack.value.slice(0, index)
  selectedFile.value = null
  previewContent.value = ''
  previewUrl.value = ''
  previewFileExt.value = ''
}

// Admin: 新建目录
const showMkdir = ref(false)
const newDirName = ref('')
const mkdir = async () => {
  if (!newDirName.value.trim()) return
  try {
    await $fetch('/api/company-assets/mkdir', {
      method: 'POST',
      body: { subdir: props.subdir, path: currentRelPath.value || undefined, name: newDirName.value.trim() }
    })
    toast.add({ title: '目录已创建', color: 'success' })
    newDirName.value = ''
    showMkdir.value = false
    refresh()
  } catch (e: unknown) {
    const err = e as FetchErrorLike
    toast.add({ title: err.data?.message || '创建失败', color: 'error' })
  }
}

// Admin: 直接导入部门文档到公司知识库
const showImportKnowledge = ref(false)
const onKnowledgeImported = async () => {
  await refresh()
}

// Admin: 删除空目录
const deleteDirTarget = ref<AssetItem | null>(null)
const showDeleteDirConfirm = computed({
  get: () => Boolean(deleteDirTarget.value),
  set: (open: boolean) => {
    if (!open) deleteDirTarget.value = null
  }
})
const deletingDir = ref(false)
const requestDeleteDirectory = (item: AssetItem) => {
  if (!item.isDirectory) return
  deleteDirTarget.value = item
}
const deleteEmptyDirectory = async () => {
  if (!deleteDirTarget.value) return
  deletingDir.value = true
  try {
    await $fetch('/api/company-assets/directory', {
      method: 'DELETE',
      body: { subdir: props.subdir, dirPath: deleteDirTarget.value.path }
    })
    toast.add({ title: '目录已删除', color: 'success' })
    deleteDirTarget.value = null
    await refresh()
  } catch (e: unknown) {
    const err = e as FetchErrorLike
    toast.add({ title: err.data?.message || '删除失败', color: 'error' })
  } finally {
    deletingDir.value = false
  }
}

// Admin: 移动文件
const showMove = ref(false)
const moveTargetDir = ref('')
const moveFile = async () => {
  if (!selectedFile.value) return
  try {
    await $fetch('/api/company-assets/move', {
      method: 'POST',
      body: { subdir: props.subdir, sourcePath: selectedFile.value.path, targetDir: moveTargetDir.value || undefined }
    })
    toast.add({ title: '文件已移动', color: 'success' })
    showMove.value = false
    moveTargetDir.value = ''
    selectedFile.value = null
    previewContent.value = ''
    refresh()
  } catch (e: unknown) {
    const err = e as FetchErrorLike
    toast.add({ title: err.data?.message || '移动失败', color: 'error' })
  }
}

// 发布记录
const showPublishRecord = ref(false)

// Admin: 归档（将已发布文档移至 archives 目录）
const showArchiveConfirm = ref(false)
const archiving = ref(false)
const archiveFile = async () => {
  if (!selectedFile.value) return
  archiving.value = true
  try {
    await $fetch('/api/company-assets/archive', {
      method: 'POST',
      body: { subdir: props.subdir, sourcePath: selectedFile.value.path }
    })
    toast.add({ title: '文件已归档', color: 'success' })
    showArchiveConfirm.value = false
    selectedFile.value = null
    previewContent.value = ''
    refresh()
  } catch (e: unknown) {
    const err = e as FetchErrorLike
    toast.add({ title: err.data?.message || '归档失败', color: 'error' })
  } finally {
    archiving.value = false
  }
}
</script>

<template>
  <UDashboardPanel grow>
    <div v-if="panelCollapsed" class="hidden md:flex items-center gap-2 px-3 py-1 border-b border-default">
      <UButton
        icon="i-lucide-folder-tree"
        variant="ghost"
        size="sm"
        @click="showPanel"
      >
        目录
      </UButton>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- Left: 目录 + 文件列表 -->
      <aside
        v-if="!panelCollapsed"
        class="border-r border-default flex flex-col overflow-y-auto"
        :style="{ width: panelWidth + 'px' }"
      >
        <!-- 面包屑（仅在子目录时显示） -->
        <div v-if="pathStack.length > 0" class="flex items-center gap-1 px-3 py-2 border-b border-default text-sm">
          <button class="text-primary hover:underline" @click="navigateTo_(0)">
            /
          </button>
          <template v-for="(seg, i) in pathStack" :key="i">
            <UIcon name="i-lucide-chevron-right" class="w-3 h-3 text-muted" />
            <button class="text-primary hover:underline truncate max-w-30" @click="navigateTo_(i + 1)">
              {{ seg.name }}
            </button>
          </template>
        </div>

        <!-- Admin 工具栏 -->
        <div v-if="isAdmin" class="flex items-center gap-1 px-3 py-1.5 border-b border-default">
          <UButton
            size="xs"
            icon="i-lucide-folder-plus"
            variant="ghost"
            @click="showMkdir = true"
          >
            新建目录
          </UButton>
        </div>

        <!-- 文件列表 -->
        <div class="flex-1 p-2">
          <div v-if="pending" class="text-sm text-muted text-center py-4">
            加载中...
          </div>
          <div v-else-if="!items?.length" class="text-sm text-muted text-center py-4">
            暂无内容
          </div>
          <div
            v-for="item in items"
            :key="item.path"
            class="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
            :class="{ 'bg-primary/10 text-primary font-medium': selectedFile?.path === item.path }"
            @click="selectFile(item)"
          >
            <UIcon
              :name="item.isDirectory ? 'i-lucide-folder' : 'i-lucide-file-text'"
              :class="item.isDirectory ? 'w-4 h-4 text-amber-500' : 'w-4 h-4 text-gray-500'"
            />
            <span class="text-sm flex-1 truncate">{{ item.name }}</span>
            <span v-if="!item.isDirectory" class="text-xs text-muted">
              {{ item.lastModified ? new Date(item.lastModified).toLocaleDateString() : '' }}
            </span>
            <UButton
              v-if="isAdmin && item.isDirectory"
              class="opacity-0 group-hover:opacity-100 focus:opacity-100"
              size="xs"
              icon="i-lucide-trash-2"
              variant="ghost"
              color="error"
              aria-label="删除目录"
              @click.stop="requestDeleteDirectory(item)"
            />
          </div>
        </div>
      </aside>
      <!-- 拖拽调整宽度把手 -->
      <div
        v-if="!panelCollapsed"
        class="w-1.5 shrink-0 cursor-col-resize bg-default hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 -ml-px"
        @mousedown.prevent="onResizeStart"
      />

      <!-- Right: 预览 -->
      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <!-- 文件工具栏 -->
        <div v-if="selectedFile" class="flex items-center justify-between px-4 py-3 border-b border-default bg-default">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="w-5 h-5 text-gray-500" />
            <span class="font-medium">{{ selectedFile.name }}</span>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              size="sm"
              icon="i-lucide-scroll-text"
              variant="ghost"
              color="neutral"
              @click="showPublishRecord = true"
            >
              发布记录
            </UButton>
            <template v-if="isAdmin">
              <UButton
                size="sm"
                icon="i-lucide-folder-input"
                variant="outline"
                @click="showMove = true"
              >
                移动
              </UButton>
              <UButton
                size="sm"
                icon="i-lucide-archive"
                variant="outline"
                color="warning"
                @click="showArchiveConfirm = true"
              >
                归档
              </UButton>
            </template>
          </div>
        </div>
        <div v-else-if="canImportKnowledge" class="flex items-center justify-between px-4 py-3 border-b border-default bg-default">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon name="i-lucide-folder-open" class="w-5 h-5 text-amber-500 shrink-0" />
            <span class="font-medium truncate">{{ currentDirectoryLabel }}</span>
          </div>
          <UButton
            size="sm"
            icon="i-lucide-upload"
            color="primary"
            @click="showImportKnowledge = true"
          >
            导入文档
          </UButton>
        </div>

        <!-- 预览内容 -->
        <div class="flex-1 overflow-auto p-4">
          <div v-if="!selectedFile" class="h-full flex items-center justify-center">
            <div class="text-center text-muted">
              <UIcon name="i-lucide-file-search" class="w-16 h-16 mx-auto mb-4" />
              <p>选择一个文件查看内容</p>
            </div>
          </div>
          <div v-else-if="previewLoading" class="h-full flex items-center justify-center">
            <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
          </div>
          <!-- PDF 预览 -->
          <div v-else-if="previewFileExt === 'pdf' && previewUrl" class="w-full h-full">
            <iframe
              :src="`${previewUrl}#toolbar=0&view=FitH`"
              class="w-full h-[calc(100vh-90px)] border-0"
            />
          </div>
          <!-- Markdown 预览 -->
          <div v-else class="max-w-4xl mx-auto bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-full">
            <EditorDocLazyPreview
              v-if="previewContent"
              :content="previewContent"
              :watermark-text="watermarkText"
            />
            <div v-else class="p-8 text-center text-muted">
              无法预览此文件
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- 新建目录 Modal -->
    <UModal v-model:open="showMkdir">
      <template #content>
        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">
              新建目录
            </h3>
          </template>
          <UFormField label="目录名称">
            <UInput
              v-model="newDirName"
              placeholder="请输入目录名称"
              autofocus
              class="w-full"
              @keyup.enter="mkdir"
            />
          </UFormField>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton variant="outline" color="neutral" @click="showMkdir = false">
                取消
              </UButton>
              <UButton color="primary" @click="mkdir">
                创建
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- 删除空目录确认 Modal -->
    <UModal v-model:open="showDeleteDirConfirm" title="删除目录">
      <template #body>
        <div class="p-4 space-y-3">
          <p class="text-sm">
            确定要删除目录 <span class="font-medium">「{{ deleteDirTarget?.name }}」</span> 吗？
          </p>
          <p class="text-sm text-muted">
            仅空目录可删除；包含文件或子目录时系统会拒绝操作。
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="deleteDirTarget = null">
            取消
          </UButton>
          <UButton color="error" :loading="deletingDir" @click="deleteEmptyDirectory">
            删除
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 移动文件 Modal -->
    <UModal v-model:open="showMove">
      <template #content>
        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">
              移动文件
            </h3>
          </template>
          <UFormField label="目标目录路径" hint="留空表示移到根目录">
            <UInput v-model="moveTargetDir" placeholder="例如: 2024/Q1" @keyup.enter="moveFile" />
          </UFormField>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton variant="outline" color="neutral" @click="showMove = false">
                取消
              </UButton>
              <UButton color="primary" @click="moveFile">
                移动
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
    <!-- 归档确认 Modal -->
    <UModal v-model:open="showArchiveConfirm" title="归档确认">
      <template #body>
        <div class="p-4 space-y-3">
          <p class="text-sm">
            确定要归档文件 <span class="font-medium">「{{ selectedFile?.name }}」</span> 吗？
          </p>
          <p class="text-sm text-gray-500">
            归档后文件将从当前目录移至归档目录，不再显示在列表中。
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="outline" color="neutral" @click="showArchiveConfirm = false">
            取消
          </UButton>
          <UButton color="warning" :loading="archiving" @click="archiveFile">
            确认归档
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 发布记录 Modal -->
    <ReviewPublishRecordModal v-model:open="showPublishRecord" :oss-path="selectedFile?.path || ''" />
    <CompanyImportKnowledgeModal
      v-if="canImportKnowledge"
      v-model:open="showImportKnowledge"
      :target-path="currentRelPath"
      @imported="onKnowledgeImported"
    />
  </UDashboardPanel>
</template>
