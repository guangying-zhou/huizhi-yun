<script setup lang="ts">
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import { useCodocsModule } from '../../../layer/useCodocsModule'
import { useResizablePanel } from '../../composables/useResizablePanel'
import { useViewerWatermark } from '../../composables/useViewerWatermark'
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
  data?: { items: AssetItem[], total: number, page: number, pageSize: number }
}

interface FetchErrorLike {
  data?: { message?: string }
  message?: string
}

const props = defineProps<{ subdir: string, title: string, hideExport?: boolean }>()

usePageTitle(props.title)

const toast = useToast()
const { moduleUrl, hosted } = useCodocsModule()
const mutationKeys = new Map<string, string>()
function mutationBody(action: string, body: Record<string, unknown>) {
  const key = `${action}:${JSON.stringify(body)}`
  if (!mutationKeys.has(key)) mutationKeys.set(key, crypto.randomUUID())
  return { key, body: { ...body, operationId: mutationKeys.get(key) } }
}
const { confirm } = useConfirm()
const { panelWidth, panelCollapsed, onResizeStart, showPanel } = useResizablePanel(288)
const { hasPermission } = usePermissions()
const isAdmin = computed(() => hasPermission('company', 'admin'))
const { watermarkText } = useViewerWatermark({ includeTime: true })
const isSystemAdmin = computed(() => hasPermission('admin', 'admin'))
const canImportKnowledge = computed(() => isSystemAdmin.value && hasPermission('company', 'publish'))

// 当前浏览路径（相对于 subdir 的路径段）
const pathStack = ref<{ name: string, path: string }[]>([])
const currentRelPath = computed(() => pathStack.value.map(p => p.name).join('/'))
const currentDirectoryLabel = computed(() => currentRelPath.value ? `/${currentRelPath.value}` : '/')

// 文件列表
const items = ref<AssetItem[]>([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const pending = ref(false)
let loadEpoch = 0

const refresh = async () => {
  const epoch = ++loadEpoch
  pending.value = true
  try {
    const result = await $fetch<AssetListResponse>(moduleUrl('/api/company-assets/list'), {
      params: { subdir: props.subdir, path: currentRelPath.value || undefined, page: page.value, pageSize }
    })
    if (epoch !== loadEpoch) return
    if (!result.data || !Array.isArray(result.data.items) || !Number.isSafeInteger(result.data.total)) throw new Error('组织资产列表响应无效')
    items.value = result.data.items
    total.value = result.data.total
  } catch (error: unknown) {
    if (epoch !== loadEpoch) return
    console.error('Failed to load company assets:', error)
    const err = error as FetchErrorLike
    toast.add({
      title: '加载目录失败',
      description: err?.data?.message || err?.message || '无法获取文件列表',
      color: 'error'
    })
  } finally {
    if (epoch === loadEpoch) pending.value = false
  }
}

watch([() => props.subdir, currentRelPath], () => {
  page.value = 1
})
watch([() => props.subdir, currentRelPath, page], () => {
  refresh()
}, { immediate: true })

// 选中文件
const selectedFile = ref<AssetItem | null>(null)
const previewContent = ref('')
const previewLoading = ref(false)
const previewUrl = ref('')
const previewFileExt = ref('')
let previewEpoch = 0

const selectFile = async (item: AssetItem) => {
  const epoch = ++previewEpoch
  if (item.isDirectory) {
    pathStack.value = [...pathStack.value, { name: item.name, path: item.path }]
    selectedFile.value = null
    previewContent.value = ''
    previewUrl.value = ''
    previewFileExt.value = ''
    previewLoading.value = false
    return
  }
  selectedFile.value = item
  previewLoading.value = true
  previewContent.value = ''
  previewUrl.value = ''
  previewFileExt.value = ''
  try {
    const res = await $fetch<{ code: number, data: { content?: string, preview_url?: string, file_ext?: string } }>(moduleUrl('/api/company-assets/preview'), { params: { path: item.path } })
    if (epoch !== previewEpoch) return
    previewContent.value = res.data?.content || ''
    previewUrl.value = res.data?.preview_url || ''
    previewFileExt.value = res.data?.file_ext || ''
  } catch {
    if (epoch !== previewEpoch) return
    previewContent.value = ''
    toast.add({ title: '无法加载文件内容', color: 'error' })
  } finally {
    if (epoch === previewEpoch) previewLoading.value = false
  }
}

// 导航到面包屑
const navigateTo_ = (index: number) => {
  previewEpoch++
  pathStack.value = pathStack.value.slice(0, index)
  selectedFile.value = null
  previewContent.value = ''
  previewUrl.value = ''
  previewFileExt.value = ''
  previewLoading.value = false
}

// Admin: 新建目录
const showMkdir = ref(false)
const newDirName = ref('')
const mkdir = async () => {
  if (!newDirName.value.trim()) return
  const intent = mutationBody('mkdir', { subdir: props.subdir, path: currentRelPath.value || undefined, name: newDirName.value.trim() })
  try {
    await $fetch(moduleUrl('/api/company-assets/mkdir'), {
      method: 'POST',
      body: intent.body
    })
    mutationKeys.delete(intent.key)
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
const deletingDir = ref(false)
const requestDeleteDirectory = async (item: AssetItem) => {
  if (!item.isDirectory) return
  if (!await confirm({ title: '删除目录', message: `确定删除空目录「${item.name}」？包含文件或子目录时系统会拒绝。`, tone: 'danger', confirmLabel: '删除' })) return
  const intent = mutationBody('delete-directory', { subdir: props.subdir, dirPath: item.path })
  deletingDir.value = true
  try {
    await $fetch(moduleUrl('/api/company-assets/directory'), {
      method: 'DELETE',
      body: intent.body
    })
    mutationKeys.delete(intent.key)
    toast.add({ title: '目录已删除', color: 'success' })
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
  const intent = mutationBody('move', { subdir: props.subdir, sourcePath: selectedFile.value.path, targetDir: moveTargetDir.value || undefined })
  try {
    await $fetch(moduleUrl('/api/company-assets/move'), {
      method: 'POST',
      body: intent.body
    })
    mutationKeys.delete(intent.key)
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
  const intent = mutationBody('archive', { subdir: props.subdir, sourcePath: selectedFile.value.path })
  archiving.value = true
  try {
    await $fetch(moduleUrl('/api/company-assets/archive'), {
      method: 'POST',
      body: intent.body
    })
    mutationKeys.delete(intent.key)
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
    <ContentPageHeader
      :hosted="hosted"
      :title="title"
      description="浏览目录与文档"
      class="shrink-0 px-4 py-3"
    />
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
        <div v-if="isAdmin || canImportKnowledge" class="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-default">
          <UButton
            v-if="isAdmin"
            size="xs"
            icon="i-lucide-folder-plus"
            variant="ghost"
            @click="showMkdir = true"
          >
            新建目录
          </UButton>
          <UButton
            v-if="canImportKnowledge"
            size="xs"
            icon="i-lucide-upload"
            variant="ghost"
            @click="showImportKnowledge = true"
          >
            快速发布
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
          <template v-else>
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
          </template>
        </div>
        <div v-if="total > pageSize" class="border-t border-default p-2 flex justify-center">
          <UPagination
            v-model:page="page"
            :total="total"
            :items-per-page="pageSize"
            size="sm"
          />
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
        <div v-if="selectedFile" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-default bg-default">
          <div class="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <UIcon name="i-lucide-file-text" class="w-5 h-5 text-gray-500" />
            <span class="font-medium break-words min-w-0">{{ selectedFile.name }}</span>
          </div>
          <div class="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <PublishedAssetLinkButton :path="selectedFile.path" />
            <CompanyAssetAccessRecords :path="selectedFile.path" :title="selectedFile.name" />
            <UButton
              v-if="isSystemAdmin"
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
            快速发布
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
            <PublishedPdfViewer :watermark-text="watermarkText" :src="previewUrl" :title="selectedFile.name" />
          </div>
          <!-- Markdown 预览 -->
          <div v-else class="max-w-4xl mx-auto bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-full">
            <EditorDocLazyPreview
              v-if="previewContent"
              :content="previewContent"
              :watermark-text="watermarkText"
              disable-selection
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
    <ReviewPublishRecordModal v-if="isSystemAdmin" v-model:open="showPublishRecord" :oss-path="selectedFile?.path || ''" />
    <CompanyImportKnowledgeModal
      v-if="canImportKnowledge"
      v-model:open="showImportKnowledge"
      :target-path="currentRelPath"
      :subdir="subdir"
      :category-title="title"
      @imported="onKnowledgeImported"
    />
  </UDashboardPanel>
</template>
