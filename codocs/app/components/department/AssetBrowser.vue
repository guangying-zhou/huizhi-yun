<script setup lang="ts">
/**
 * 部门资产浏览器 — 部门选择 + 左侧目录/文件列表 + 右侧文档预览
 * Props: subdir (OSS departments/{deptCode}/ 下的子目录名), title (页面标题)
 */
const props = defineProps<{ subdir: string, title: string }>()

usePageTitle(props.title)

const toast = useToast()
const { panelWidth, panelCollapsed, onResizeStart, showPanel } = useResizablePanel(288)
const { user, userDeptCode } = useAuth()
const { watermarkText } = useViewerWatermark()
const { departmentsCache, setDepartmentsCache } = useUserDepartmentsCache()
const { hasPermission } = usePermissions()
const isAdmin = computed(() => hasPermission('departments', 'admin'))

// 部门选择（复用 coworks 的逻辑）
interface DeptTreeNode { deptCode: string, name: string, children?: DeptTreeNode[] }
interface UserDepartmentsResponse {
  code: number
  data?: {
    departments?: DeptTreeNode[]
    primaryDeptCode?: string
  }
}

interface AssetItem {
  name: string
  path: string
  isDirectory: boolean
  lastModified?: string
}

interface AssetListResponse {
  data?: AssetItem[]
}

interface AssetPreviewResponse {
  data?: {
    content?: string
  }
}

interface FetchErrorLike {
  data?: { message?: string }
  message?: string
}

interface PublishRecordExtra {
  outsideFileLevel?: 'general' | 'important' | 'critical'
}

interface PublishRecordResponse {
  code: number
  data?: {
    id?: number
    execution_status?: string | null
    extra?: PublishRecordExtra | null
    send_records?: Array<{
      sender_uid?: string | null
      receive_date?: string | null
    }>
  } | null
}

const deptCode = ref('')
const userDepartments = ref<DeptTreeNode[]>([])

// 扁平化部门列表（用于下拉框，只包含叶子节点）
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
          icon: 'i-lucide-building'
        })
      }
    }
  }

  flatten(userDepartments.value)
  return result
})

const hasMultipleDepts = computed(() => {
  return flatDepartments.value.length > 1
})

const initDeptCode = async () => {
  if (!user.value) return

  const cachedDepartments = departmentsCache.value
  if (cachedDepartments?.departments?.length) {
    userDepartments.value = cachedDepartments.departments
    deptCode.value = cachedDepartments.primaryDeptCode || userDepartments.value[0]?.deptCode || ''
  }

  if (deptCode.value) return

  try {
    const res = await $fetch<UserDepartmentsResponse>('/api/account/user-departments', { params: { uid: user.value } })
    if (res.code === 0 && res.data) {
      userDepartments.value = res.data.departments || []
      deptCode.value = res.data.primaryDeptCode || userDepartments.value[0]?.deptCode || ''
      setDepartmentsCache({
        departments: userDepartments.value,
        primaryDeptCode: res.data.primaryDeptCode || null
      })
    }
  } catch (e) { console.error('[DeptAssets] Failed to fetch departments:', e) }
  if (!deptCode.value && userDeptCode.value) deptCode.value = userDeptCode.value
}
await initDeptCode()

const currentDeptName = computed(() => {
  const find = (nodes: DeptTreeNode[], id: string): string | null => {
    for (const n of nodes) {
      if (n.deptCode === id) return n.name
      if (n.children?.length) {
        const f = find(n.children, id)
        if (f) return f
      }
    }
    return null
  }
  return find(userDepartments.value, deptCode.value) || deptCode.value
})

// 当前选中的部门对象（用于下拉框）
const selectedDept = computed({
  get: () => flatDepartments.value.find(d => d.deptCode === deptCode.value) || undefined,
  set: (dept) => {
    if (dept && dept.deptCode !== deptCode.value) {
      switchDepartment(dept.deptCode)
    }
  }
})

const switchDepartment = (id: string) => {
  if (id === deptCode.value) return
  deptCode.value = id
  pathStack.value = []
  selectedFile.value = null
  previewContent.value = ''
  outsideFileLevel.value = null
  outsideReviewId.value = null
  outsideExecutionStatus.value = null
}

// 目录浏览
const pathStack = ref<{ name: string, path: string }[]>([])
const currentRelPath = computed(() => pathStack.value.map(p => p.name).join('/'))

const { data: items, pending, refresh } = useAsyncData(
  `dept-assets-${props.subdir}`,
  () => {
    if (!deptCode.value) return Promise.resolve([])
    return $fetch<AssetListResponse>('/api/dept-assets/list', {
      params: { deptCode: deptCode.value, subdir: props.subdir, path: currentRelPath.value || undefined }
    }).then(r => r.data || [])
  },
  { watch: [deptCode, currentRelPath] }
)

// 文件选择与预览
const selectedFile = ref<AssetItem | null>(null)
const previewContent = ref('')
const previewLoading = ref(false)
const outsideFileLevel = ref<'general' | 'important' | 'critical' | null>(null)
const outsideReviewId = ref<number | null>(null)
const outsideExecutionStatus = ref<string | null>(null)
const outsideSenderUid = ref<string | null>(null)

const loadOutsideExportPolicy = async (ossPath: string) => {
  if (!canExport.value || !ossPath) {
    outsideFileLevel.value = null
    outsideReviewId.value = null
    outsideExecutionStatus.value = null
    outsideSenderUid.value = null
    return
  }

  outsideFileLevel.value = null
  outsideReviewId.value = null
  outsideExecutionStatus.value = null
  outsideSenderUid.value = null
  try {
    const res = await $fetch<PublishRecordResponse>('/api/reviews/by-oss-path', {
      params: { path: ossPath }
    })
    const level = res.data?.extra?.outsideFileLevel
    outsideFileLevel.value = level === 'general' || level === 'important' || level === 'critical'
      ? level
      : null
    outsideReviewId.value = typeof res.data?.id === 'number' ? res.data.id : null
    outsideExecutionStatus.value = typeof res.data?.execution_status === 'string'
      ? res.data.execution_status
      : null
    const latestSendRecord = Array.isArray(res.data?.send_records) && res.data?.send_records.length
      ? res.data.send_records[res.data.send_records.length - 1]
      : null
    outsideSenderUid.value = String(latestSendRecord?.sender_uid || '').trim() || null
  } catch (e) {
    console.warn('[DeptAssets] Failed to load publish record for export policy:', e)
    outsideFileLevel.value = null
    outsideReviewId.value = null
    outsideExecutionStatus.value = null
    outsideSenderUid.value = null
  }
}

const selectFile = async (item: AssetItem) => {
  if (item.isDirectory) {
    pathStack.value = [...pathStack.value, { name: item.name, path: item.path }]
    selectedFile.value = null
    previewContent.value = ''
    outsideFileLevel.value = null
    outsideReviewId.value = null
    outsideExecutionStatus.value = null
    outsideSenderUid.value = null
    return
  }
  selectedFile.value = item
  previewLoading.value = true
  try {
    const res = await $fetch<AssetPreviewResponse>('/api/dept-assets/preview', { params: { path: item.path } })
    previewContent.value = res.data?.content || ''
  } catch {
    previewContent.value = ''
    toast.add({ title: '无法加载文件内容', color: 'error' })
  } finally {
    previewLoading.value = false
  }

  await loadOutsideExportPolicy(item.path)
}

// 发布记录
const showPublishRecord = ref(false)
const showSendConfirm = ref(false)
const showReceiveConfirm = ref(false)

const canExport = computed(() => props.subdir === 'outsides')
const canExportEditableFormats = computed(() => outsideFileLevel.value === 'general')
const canConfirmSend = computed(() => {
  return props.subdir === 'outsides'
    && Boolean(selectedFile.value)
    && typeof outsideReviewId.value === 'number'
    && outsideExecutionStatus.value === 'pending_send'
})
const canConfirmReceive = computed(() => {
  const currentUid = String(user.value || '').trim()
  return props.subdir === 'outsides'
    && Boolean(selectedFile.value)
    && typeof outsideReviewId.value === 'number'
    && outsideExecutionStatus.value === 'pending_receive'
    && outsideSenderUid.value === currentUid
})
const exportingDocx = ref(false)

const handleExportPdf = () => {
  window.print()
}

const handleExportDocx = async () => {
  if (!selectedFile.value || exportingDocx.value) return
  exportingDocx.value = true
  try {
    const blob = await $fetch<Blob>('/api/dept-assets/export-docx', {
      method: 'POST',
      body: { path: selectedFile.value.path, filename: selectedFile.value.name },
      responseType: 'blob'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = selectedFile.value.name.replace(/\.md$/i, '') + '.docx'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  } catch (e: unknown) {
    const err = e as FetchErrorLike
    toast.add({ title: '导出失败', description: err.data?.message || '无法生成 DOCX', color: 'error' })
  } finally {
    exportingDocx.value = false
  }
}

const handleDownloadMd = () => {
  if (!selectedFile.value || !previewContent.value) return
  const blob = new Blob([previewContent.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = selectedFile.value.name.endsWith('.md') ? selectedFile.value.name : selectedFile.value.name + '.md'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

const exportMenuItems = computed(() => [
  ...(
    canExportEditableFormats.value
      ? [{
          label: exportingDocx.value ? '正在导出...' : '导出 DOCX',
          icon: 'i-lucide-file-type-2',
          disabled: exportingDocx.value,
          onSelect: handleExportDocx
        },
        {
          label: '下载 Markdown',
          icon: 'i-lucide-file-text',
          onSelect: handleDownloadMd
        }]
      : []
  ),
  { label: '导出 PDF', icon: 'i-lucide-printer', onSelect: handleExportPdf }
])

// Admin: 归档（将已发布文档移至 archives 目录）
const showArchiveConfirm = ref(false)
const archiving = ref(false)
const archiveFile = async () => {
  if (!selectedFile.value) return
  archiving.value = true
  try {
    await $fetch('/api/dept-assets/archive', {
      method: 'POST',
      body: { deptCode: deptCode.value, subdir: props.subdir, sourcePath: selectedFile.value.path }
    })
    toast.add({ title: '文件已归档', color: 'success' })
    showArchiveConfirm.value = false
    selectedFile.value = null
    previewContent.value = ''
    refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({ title: err.data?.message || '归档失败', color: 'error' })
  } finally {
    archiving.value = false
  }
}

const navigateTo_ = (index: number) => {
  pathStack.value = pathStack.value.slice(0, index)
  selectedFile.value = null
  previewContent.value = ''
  outsideFileLevel.value = null
  outsideReviewId.value = null
  outsideExecutionStatus.value = null
  outsideSenderUid.value = null
}

const handleSendSuccess = async () => {
  showSendConfirm.value = false
  if (selectedFile.value?.path) {
    await loadOutsideExportPolicy(selectedFile.value.path)
  }
}

const handleReceiveSuccess = async () => {
  showReceiveConfirm.value = false
  if (selectedFile.value?.path) {
    await loadOutsideExportPolicy(selectedFile.value.path)
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
      <!-- Left panel -->
      <aside
        v-if="!panelCollapsed"
        class="border-r border-default flex flex-col overflow-y-auto"
        :style="{ width: panelWidth + 'px' }"
      >
        <!-- 部门切换 -->
        <div v-if="hasMultipleDepts" class="p-2 border-b border-default">
          <label class="text-xs text-muted mb-1 block px-2">选择部门</label>
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

        <!-- 面包屑（仅在子目录时显示） -->
        <div v-if="pathStack.length > 0" class="flex items-center gap-1 px-3 py-2 border-b border-default text-sm">
          <button class="text-primary hover:underline" @click="navigateTo_(0)">
            {{ currentDeptName }}
          </button>
          <template v-for="(seg, i) in pathStack" :key="i">
            <UIcon name="i-lucide-chevron-right" class="w-3 h-3 text-muted" />
            <button class="text-primary hover:underline truncate max-w-30" @click="navigateTo_(i + 1)">
              {{ seg.name }}
            </button>
          </template>
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
        <div v-if="selectedFile" class="flex items-center justify-between px-4 py-3 border-b border-default bg-default">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="w-5 h-5 text-gray-500" />
            <span class="font-medium">{{ selectedFile.name }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span
              v-if="canExport && outsideFileLevel && outsideFileLevel !== 'general'"
              class="hidden md:inline text-xs text-gray-500"
            >
              {{ outsideFileLevel === 'important' ? '重要文件仅支持导出 PDF' : '关键文件仅支持导出 PDF' }}
            </span>
            <UButton
              size="sm"
              icon="i-lucide-scroll-text"
              variant="ghost"
              color="neutral"
              @click="showPublishRecord = true"
            >
              发布记录
            </UButton>
            <UButton
              v-if="canConfirmSend"
              size="sm"
              icon="i-lucide-send"
              variant="outline"
              color="primary"
              @click="showSendConfirm = true"
            >
              确认发送
            </UButton>
            <UButton
              v-if="canConfirmReceive"
              size="sm"
              icon="i-lucide-mail-check"
              variant="outline"
              color="success"
              @click="showReceiveConfirm = true"
            >
              确认接收
            </UButton>
            <UDropdownMenu v-if="canExport" :items="exportMenuItems">
              <UButton
                size="sm"
                icon="i-lucide-download"
                variant="ghost"
                color="neutral"
                trailing-icon="i-lucide-chevron-down"
              >
                导出
              </UButton>
            </UDropdownMenu>
            <UButton
              v-if="isAdmin"
              size="sm"
              icon="i-lucide-archive"
              variant="outline"
              color="warning"
              @click="showArchiveConfirm = true"
            >
              归档
            </UButton>
          </div>
        </div>

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
    <ReviewSendConfirmModal
      v-if="outsideReviewId"
      v-model:open="showSendConfirm"
      :review-id="outsideReviewId"
      :doc-title="selectedFile?.name"
      @success="handleSendSuccess"
    />
    <ReviewReceiveConfirmModal
      v-if="outsideReviewId"
      v-model:open="showReceiveConfirm"
      :review-id="outsideReviewId"
      :doc-title="selectedFile?.name"
      @success="handleReceiveSuccess"
    />
  </UDashboardPanel>
</template>
