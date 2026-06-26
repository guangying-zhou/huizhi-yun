<script setup lang="ts">
/**
 * 管理员图片清理页面
 * 扫描 OSS 图片，检测孤立图片：
 * - 文档已删除：关联文档不存在
 * - 未被引用：文档存在但内容中不再包含该图片链接
 * - 无元数据：旧图片，无法判断归属
 * 支持单个与批量删除
 */
definePageMeta({ layout: 'default' })

usePageTitle('图片清理')
const { setRefresh } = usePageActions()

interface ImageItem {
  name: string
  path: string
  size: number
  lastModified: string
  url: string
  docPath: string
  orphan: '' | 'deleted' | 'unreferenced' | 'no-meta'
  owner: string
}

interface ApiResponse<T> {
  success: boolean
  data: T
}

interface DocContentData {
  content?: string
  title?: string
  uuid?: string
}

interface ImagesListData {
  images: ImageItem[]
  total: number
  orphanCount: number
  deletedCount: number
  unreferencedCount: number
  noMetaCount: number
}

interface DeleteImagesResponse {
  success: boolean
  deletedCount: number
}

const toast = useToast()
const router = useRouter()
const loading = ref(false)
const deleting = ref(false)
const images = ref<ImageItem[]>([])
const total = ref(0)
const orphanCount = ref(0)
const deletedCount = ref(0)
const unreferencedCount = ref(0)
const noMetaCount = ref(0)
const selectedPaths = ref<string[]>([])
const filterMode = ref<'all' | 'orphan' | 'deleted' | 'unreferenced' | 'no-meta' | 'normal'>('all')

// 图片预览弹窗
const previewOpen = ref(false)
const previewImage = ref<ImageItem | null>(null)

const openPreview = (img: ImageItem) => {
  previewImage.value = img
  previewOpen.value = true
}

// 文档内容查看弹窗
const docViewOpen = ref(false)
const docViewImage = ref<ImageItem | null>(null)
const docViewContent = ref('')
const docViewLoading = ref(false)
const docViewTitle = ref('')
const docViewUuid = ref('')
const docViewTableRef = ref<HTMLElement | null>(null)

interface DocLine {
  lineNum: number
  content: string
  highlighted: boolean
  matchText: string
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message) {
      return message
    }
  }

  return fallback
}

const buildImageMatchers = (img: ImageItem | null) => {
  if (!img) return []

  const raw = [
    img.url,
    img.path,
    img.name,
    encodeURIComponent(img.name),
    decodeURIComponent(img.name)
  ].filter(Boolean)

  return [...new Set(raw)].sort((a, b) => b.length - a.length)
}

const findLineMatchText = (content: string, img: ImageItem | null) => {
  const matchers = buildImageMatchers(img)
  return matchers.find(item => content.includes(item)) || ''
}

const docLines = computed<DocLine[]>(() => {
  if (!docViewContent.value || !docViewImage.value) return []
  const lines = docViewContent.value.split('\n')
  return lines.map((content, idx) => {
    const matchText = findLineMatchText(content, docViewImage.value)
    return {
      lineNum: idx + 1,
      content,
      matchText,
      highlighted: !!matchText
    }
  })
})

const highlightedLineCount = computed(() => docLines.value.filter(l => l.highlighted).length)

const firstHighlightedLine = computed(() => docLines.value.find(line => line.highlighted)?.lineNum || null)

const scrollToFirstHighlightedLine = async () => {
  await nextTick()

  requestAnimationFrame(() => {
    const container = docViewTableRef.value
    const target = container?.querySelector('[data-highlighted="true"]') as HTMLElement | null
    if (container && target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  })
}

const openDocView = async (img: ImageItem) => {
  docViewImage.value = img
  docViewContent.value = ''
  docViewTitle.value = ''
  docViewUuid.value = ''
  docViewOpen.value = true
  docViewLoading.value = true

  try {
    // 通过文档 oss_path 查找 uuid，再获取内容
    const response = await $fetch<ApiResponse<DocContentData>>('/api/admin/images/doc-content', {
      params: { docPath: img.docPath }
    })
    if (response.success) {
      docViewContent.value = response.data.content || ''
      docViewTitle.value = response.data.title || ''
      docViewUuid.value = response.data.uuid || ''
      await scrollToFirstHighlightedLine()
    }
  } catch (error: unknown) {
    toast.add({ title: '获取文档内容失败', description: getErrorMessage(error, '获取文档内容失败'), color: 'error' })
  } finally {
    docViewLoading.value = false
  }
}

const openViewedDocument = () => {
  if (!docViewUuid.value) return
  docViewOpen.value = false
  router.push(`/documents/${docViewUuid.value}`)
}

const getLineSegments = (line: DocLine) => {
  if (!line.highlighted || !line.matchText) {
    return { before: line.content, match: '', after: '' }
  }

  const index = line.content.indexOf(line.matchText)
  if (index === -1) {
    return { before: line.content, match: '', after: '' }
  }

  return {
    before: line.content.slice(0, index),
    match: line.content.slice(index, index + line.matchText.length),
    after: line.content.slice(index + line.matchText.length)
  }
}

// 加载图片列表
const fetchImages = async () => {
  loading.value = true
  selectedPaths.value = []
  try {
    const response = await $fetch<ApiResponse<ImagesListData>>('/api/admin/images')
    if (response.success) {
      images.value = response.data.images
      total.value = response.data.total
      orphanCount.value = response.data.orphanCount
      deletedCount.value = response.data.deletedCount
      unreferencedCount.value = response.data.unreferencedCount
      noMetaCount.value = response.data.noMetaCount
    }
  } catch (error: unknown) {
    toast.add({ title: '加载失败', description: getErrorMessage(error, '获取图片列表失败'), color: 'error' })
  } finally {
    loading.value = false
  }
}

const normalCount = computed(() => total.value - orphanCount.value)

// 过滤后的图片
const filteredImages = computed(() => {
  switch (filterMode.value) {
    case 'orphan': return images.value.filter(i => i.orphan !== '')
    case 'deleted': return images.value.filter(i => i.orphan === 'deleted')
    case 'unreferenced': return images.value.filter(i => i.orphan === 'unreferenced')
    case 'no-meta': return images.value.filter(i => i.orphan === 'no-meta')
    case 'normal': return images.value.filter(i => i.orphan === '')
    default: return images.value
  }
})

// 可删除的图片（排除状态正常的）
const isDeletable = (img: ImageItem) => img.orphan !== ''

// 全选/取消（只选可删除的）
const selectableImages = computed(() => filteredImages.value.filter(isDeletable))
const allSelected = computed({
  get: () => selectableImages.value.length > 0 && selectableImages.value.every(i => selectedPaths.value.includes(i.path)),
  set: (val: boolean) => {
    if (val) {
      selectedPaths.value = selectableImages.value.map(i => i.path)
    } else {
      selectedPaths.value = []
    }
  }
})

// 切换单个选择
const toggleSelect = (path: string, img: ImageItem) => {
  if (!isDeletable(img)) return
  const idx = selectedPaths.value.indexOf(path)
  if (idx >= 0) {
    selectedPaths.value.splice(idx, 1)
  } else {
    selectedPaths.value.push(path)
  }
}

// 删除图片
const handleDelete = async (paths: string[]) => {
  if (paths.length === 0) return
  deleting.value = true
  try {
    const response = await $fetch<DeleteImagesResponse>('/api/admin/images', {
      method: 'DELETE',
      body: { paths }
    })
    if (response.success) {
      // 计算释放空间
      const freedSize = images.value
        .filter(i => paths.includes(i.path))
        .reduce((sum, i) => sum + i.size, 0)
      toast.add({ title: `已删除 ${response.deletedCount} 张图片，释放 ${formatSize(freedSize)}`, color: 'success' })
      // 从列表中移除已删除的
      images.value = images.value.filter(i => !paths.includes(i.path))
      selectedPaths.value = selectedPaths.value.filter(p => !paths.includes(p))
      // 重新计算统计
      total.value = images.value.length
      orphanCount.value = images.value.filter(i => i.orphan !== '').length
      deletedCount.value = images.value.filter(i => i.orphan === 'deleted').length
      unreferencedCount.value = images.value.filter(i => i.orphan === 'unreferenced').length
      noMetaCount.value = images.value.filter(i => i.orphan === 'no-meta').length
    }
  } catch (error: unknown) {
    toast.add({ title: '删除失败', description: getErrorMessage(error, '删除图片失败'), color: 'error' })
  } finally {
    deleting.value = false
  }
}

// 选中文件总大小
const selectedTotalSize = computed(() => {
  return images.value
    .filter(i => selectedPaths.value.includes(i.path))
    .reduce((sum, i) => sum + i.size, 0)
})

// 批量删除选中的
const handleBatchDelete = () => {
  if (selectedPaths.value.length === 0) return
  handleDelete(selectedPaths.value)
}

// 格式化文件大小
const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 格式化时间
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}/${m}/${d} ${h}:${min}`
}

// 状态标签
const orphanLabel = (orphan: string) => {
  switch (orphan) {
    case 'deleted': return '文档已删除'
    case 'unreferenced': return '未被引用'
    case 'no-meta': return '无元数据'
    default: return '正常'
  }
}

const orphanColor = (orphan: string) => {
  switch (orphan) {
    case 'deleted': return 'text-error'
    case 'unreferenced': return 'text-warning'
    case 'no-meta': return 'text-gray-400'
    default: return 'text-success'
  }
}

const orphanIcon = (orphan: string) => {
  switch (orphan) {
    case 'deleted': return 'i-lucide-file-x'
    case 'unreferenced': return 'i-lucide-unlink'
    case 'no-meta': return 'i-lucide-help-circle'
    default: return 'i-lucide-check-circle'
  }
}

onMounted(() => {
  fetchImages()
  setRefresh(() => fetchImages())
})
</script>

<template>
  <UDashboardPanel grow>
    <div class="p-4 flex-1 overflow-y-auto w-full">
      <!-- 统计信息 -->
      <div class="grid grid-cols-5 gap-3 mb-6">
        <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <div class="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {{ total }}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            图片总数
          </div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <div class="text-2xl font-bold text-error">
            {{ deletedCount }}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            文档已删除
          </div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <div class="text-2xl font-bold text-warning">
            {{ unreferencedCount }}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            未被引用
          </div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <div class="text-2xl font-bold text-gray-400">
            {{ noMetaCount }}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            无元数据
          </div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <div class="text-2xl font-bold text-success">
            {{ normalCount }}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            正常
          </div>
        </div>
      </div>

      <!-- 工具栏 -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-1 flex-wrap">
          <UButton
            :variant="filterMode === 'all' ? 'solid' : 'ghost'"
            size="xs"
            :label="`全部 (${total})`"
            @click="filterMode = 'all'"
          />
          <UButton
            :variant="filterMode === 'orphan' ? 'solid' : 'ghost'"
            size="xs"
            color="error"
            :label="`可清理 (${orphanCount})`"
            @click="filterMode = 'orphan'"
          />
          <UButton
            :variant="filterMode === 'deleted' ? 'solid' : 'ghost'"
            size="xs"
            color="error"
            variant-class="opacity-80"
            :label="`文档已删除 (${deletedCount})`"
            @click="filterMode = 'deleted'"
          />
          <UButton
            :variant="filterMode === 'unreferenced' ? 'solid' : 'ghost'"
            size="xs"
            color="warning"
            :label="`未被引用 (${unreferencedCount})`"
            @click="filterMode = 'unreferenced'"
          />
          <UButton
            :variant="filterMode === 'no-meta' ? 'solid' : 'ghost'"
            size="xs"
            color="neutral"
            :label="`无元数据 (${noMetaCount})`"
            @click="filterMode = 'no-meta'"
          />
          <UButton
            :variant="filterMode === 'normal' ? 'solid' : 'ghost'"
            size="xs"
            color="success"
            :label="`正常 (${normalCount})`"
            @click="filterMode = 'normal'"
          />
        </div>
        <div v-if="selectedPaths.length > 0" class="flex items-center gap-2 shrink-0">
          <span class="text-sm text-gray-500">已选 {{ selectedPaths.length }} 项（{{ formatSize(selectedTotalSize) }}）</span>
          <UButton
            icon="i-lucide-trash-2"
            label="批量删除"
            color="error"
            size="sm"
            :loading="deleting"
            @click="handleBatchDelete"
          />
        </div>
      </div>

      <!-- 加载中 -->
      <div v-if="loading" class="flex items-center justify-center py-20">
        <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
      </div>

      <!-- 空状态 -->
      <div v-else-if="filteredImages.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
        <UIcon name="i-lucide-image-off" class="w-12 h-12 text-gray-400 mb-3" />
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ filterMode === 'orphan' ? '没有可清理的图片' : filterMode === 'normal' ? '没有正常图片' : '没有图片' }}
        </p>
      </div>

      <!-- 图片列表 -->
      <div v-else class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <!-- 表头 -->
        <div class="grid grid-cols-[40px_60px_1fr_120px_80px_100px_60px] gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400 items-center">
          <div>
            <input
              type="checkbox"
              :checked="allSelected"
              class="rounded border-gray-300 dark:border-gray-600"
              @change="allSelected = !allSelected"
            >
          </div>
          <div>
            预览
          </div>
          <div>
            文件信息
          </div>
          <div>
            状态
          </div>
          <div>
            大小
          </div>
          <div>
            上传时间
          </div>
          <div>
            操作
          </div>
        </div>

        <!-- 列表行 -->
        <div class="max-h-[calc(100vh-420px)] overflow-y-auto">
          <div
            v-for="img in filteredImages"
            :key="img.path"
            class="grid grid-cols-[40px_60px_1fr_120px_80px_100px_60px] gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700/50 items-center hover:bg-gray-50 dark:hover:bg-gray-800/50 text-sm"
          >
            <!-- 复选框 -->
            <div>
              <input
                type="checkbox"
                :checked="selectedPaths.includes(img.path)"
                :disabled="!isDeletable(img)"
                class="rounded border-gray-300 dark:border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                @change="toggleSelect(img.path, img)"
              >
            </div>

            <!-- 预览 -->
            <div>
              <img
                :src="img.url"
                :alt="img.name"
                class="w-10 h-10 object-cover rounded border border-gray-200 dark:border-gray-700 cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                loading="lazy"
                @click="openPreview(img)"
              >
            </div>

            <!-- 文件信息 -->
            <div class="min-w-0">
              <div class="truncate text-xs font-medium text-gray-700 dark:text-gray-300" :title="img.name">
                {{ img.name }}
              </div>
              <div class="truncate text-xs text-gray-400" :title="img.docPath || '无关联文档'">
                {{ img.docPath ? img.docPath.split('/').pop() : '' }}
              </div>
              <div class="truncate text-xs text-gray-400">
                {{ img.owner }}
              </div>
            </div>

            <!-- 状态 -->
            <div>
              <span
                class="inline-flex items-center gap-1 text-xs"
                :class="orphanColor(img.orphan)"
              >
                <UIcon :name="orphanIcon(img.orphan)" class="w-3.5 h-3.5" />
                {{ orphanLabel(img.orphan) }}
              </span>
            </div>

            <!-- 大小 -->
            <div class="text-xs text-gray-500">
              {{ formatSize(img.size) }}
            </div>

            <!-- 上传时间 -->
            <div class="text-xs text-gray-500">
              {{ formatDate(img.lastModified) }}
            </div>

            <!-- 操作 -->
            <div>
              <UButton
                v-if="img.orphan === ''"
                icon="i-lucide-eye"
                variant="ghost"
                color="primary"
                size="xs"
                @click="openDocView(img)"
              />
              <UButton
                v-else
                icon="i-lucide-trash-2"
                variant="ghost"
                color="error"
                size="xs"
                :loading="deleting"
                @click="handleDelete([img.path])"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 图片预览弹窗 -->
    <UModal v-model:open="previewOpen" class="max-w-4xl">
      <template #content>
        <div class="relative">
          <!-- 关闭按钮 -->
          <button
            class="absolute top-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            @click="previewOpen = false"
          >
            <UIcon name="i-lucide-x" class="w-5 h-5" />
          </button>
          <!-- 图片 -->
          <div class="flex items-center justify-center bg-gray-100 dark:bg-gray-900 min-h-64 p-4">
            <img
              v-if="previewImage"
              :src="previewImage.url"
              :alt="previewImage.name"
              class="max-w-full max-h-[80vh] object-contain"
            >
          </div>
          <!-- 信息栏 -->
          <div v-if="previewImage" class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 flex items-center justify-between">
            <div class="truncate mr-4">
              <span class="font-medium text-gray-800 dark:text-gray-200">
                {{ previewImage.name }}
              </span>
              <span class="ml-2">
                {{ formatSize(previewImage.size) }}
              </span>
            </div>
            <span class="inline-flex items-center gap-1 shrink-0" :class="orphanColor(previewImage.orphan)">
              <UIcon :name="orphanIcon(previewImage.orphan)" class="w-3.5 h-3.5" />
              {{ orphanLabel(previewImage.orphan) }}
            </span>
          </div>
        </div>
      </template>
    </UModal>
    <!-- 文档内容查看弹窗 -->
    <UModal v-model:open="docViewOpen" class="w-full max-w-6xl">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <UIcon name="i-lucide-file-search" class="w-5 h-5 text-primary" />
                <div>
                  <h3 class="text-base font-semibold">
                    文档内容定位查看
                  </h3>
                  <div class="text-xs text-muted mt-0.5">
                    {{ docViewImage?.docPath || '' }}
                    <span v-if="docViewUuid" class="ml-2">· {{ docViewUuid }}</span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  v-if="docViewUuid"
                  icon="i-lucide-external-link"
                  color="primary"
                  variant="soft"
                  size="sm"
                  @click="openViewedDocument"
                >
                  打开文档
                </UButton>
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  @click="docViewOpen = false"
                />
              </div>
            </div>
          </template>

          <div class="flex items-center gap-4 mb-3 text-sm flex-wrap">
            <span class="flex items-center gap-1 text-primary">
              <UIcon name="i-lucide-image" class="w-3.5 h-3.5" />
              {{ docViewImage?.name || '-' }}
            </span>
            <span class="flex items-center gap-1 text-warning">
              <UIcon name="i-lucide-crosshair" class="w-3.5 h-3.5" />
              {{ highlightedLineCount }} 行命中图片链接
            </span>
            <div class="flex-1" />
            <div class="flex items-center gap-3 text-xs text-muted">
              <span class="inline-flex items-center gap-1">
                <span class="w-3 h-3 rounded-sm bg-warning/15 border border-warning/30" />
                图片链接行
              </span>
              <span v-if="firstHighlightedLine" class="inline-flex items-center gap-1">
                <span class="w-3 h-3 rounded-sm bg-primary/15 border border-primary/30" />
                首个命中: 第 {{ firstHighlightedLine }} 行
              </span>
            </div>
          </div>

          <!-- 图片信息 -->
          <div v-if="docViewImage" class="flex items-center gap-3 mb-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <img
              :src="docViewImage.url"
              :alt="docViewImage.name"
              class="w-10 h-10 object-cover rounded border border-gray-200 dark:border-gray-700"
            >
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                {{ docViewImage.name }}
              </div>
              <div class="text-xs text-gray-400 truncate">
                {{ docViewImage.path }}
              </div>
            </div>
            <span class="text-xs text-gray-500 shrink-0">
              {{ formatSize(docViewImage.size) }}
            </span>
          </div>

          <!-- 加载中 -->
          <div v-if="docViewLoading" class="flex items-center justify-center py-16">
            <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-primary" />
          </div>

          <!-- 文档内容 -->
          <div v-else ref="docViewTableRef" class="border border-default rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto doc-view-table">
            <table class="w-full text-xs font-mono">
              <thead class="sticky top-0 bg-gray-100 dark:bg-gray-800 text-muted z-10">
                <tr>
                  <th class="w-12 text-center px-2 py-1.5 border-r border-default font-medium">
                    行号
                  </th>
                  <th class="w-5 py-1.5" />
                  <th class="py-1.5 pl-1 text-left font-medium">
                    内容
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="line in docLines"
                  :key="line.lineNum"
                  :data-highlighted="line.highlighted ? 'true' : 'false'"
                  :class="{
                    'bg-warning-50 dark:bg-warning-900/15 highlight-row': line.highlighted
                  }"
                >
                  <td
                    class="w-12 text-right px-2 py-0.5 select-none border-r border-default"
                    :class="line.highlighted ? 'text-warning font-bold' : 'text-muted'"
                  >
                    {{ line.lineNum }}
                  </td>
                  <td
                    class="w-5 text-center py-0.5 select-none"
                    :class="line.highlighted ? 'text-warning font-bold' : 'text-muted'"
                  >
                    {{ line.highlighted ? '>' : '' }}
                  </td>
                  <td class="py-0.5 pr-4 whitespace-pre-wrap break-all">
                    <template v-if="line.highlighted">
                      <span>{{ getLineSegments(line).before }}</span>
                      <mark class="px-0.5 rounded bg-warning-200/80 dark:bg-warning-500/30 text-warning-900 dark:text-warning-100 font-medium">
                        {{ getLineSegments(line).match }}
                      </mark>
                      <span>{{ getLineSegments(line).after }}</span>
                    </template>
                    <span v-else>{{ line.content }}</span>
                  </td>
                </tr>
                <tr v-if="docLines.length === 0">
                  <td colspan="3" class="text-center py-8 text-muted">
                    文档内容为空
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <template #footer>
            <div class="flex justify-end">
              <UButton color="neutral" variant="outline" @click="docViewOpen = false">
                关闭
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
