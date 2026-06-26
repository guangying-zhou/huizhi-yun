<script setup lang="ts">
/**
 * 书签管理页 (管理员)
 * 路由: /info/management
 */

definePageMeta({
  layout: 'default'
})

interface Bookmark {
  id: string
  author_handle: string
  content_snippet: string
  source_url: string
  has_external_link: number
  article_title: string
  cover_image?: string
  status: 'pending' | 'processed' | 'ignored' | 'processing'
  created_at: string
  post_time?: string
}

interface BookmarkListResponse {
  success: boolean
  data: {
    items: Bookmark[]
    pagination: {
      totalPages: number
    }
  }
}

interface ActionResponse {
  success: boolean
  message?: string
}

interface SyncResponse {
  message?: string
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

const loading = ref(true)
const items = ref<Bookmark[]>([])
const page = ref(1)
const totalPages = ref(1)
const selectedIds = ref<string[]>([])
const showConfirmModal = ref(false)
const pendingAction = ref<'process' | 'ignore' | null>(null)
const statusFilter = ref<'pending' | 'processed,processing,ignored'>('pending')
const modalProcessType = ref<'auto' | 'article' | 'news'>('auto')
const syncing = ref(false)
const showSyncModal = ref(false)
const toast = useToast()

const tabs = [
  { label: '未处理', value: 'pending' },
  { label: '已处理', value: 'processed,processing,ignored' }
] as const

// 监听分页和状态过滤
watch([page, statusFilter], () => fetchItems())

const fetchItems = async () => {
  loading.value = true
  try {
    const response = await $fetch<BookmarkListResponse>('/api/info/management', {
      query: {
        page: page.value,
        pageSize: 20,
        status: statusFilter.value
      }
    })
    if (response.success) {
      items.value = response.data.items
      totalPages.value = response.data.pagination.totalPages
    }
  } catch (error) {
    console.error('Failed to fetch bookmarks:', error)
  } finally {
    loading.value = false
  }
}

const handleSelection = (id: string) => {
  const index = selectedIds.value.indexOf(id)
  if (index > -1) {
    selectedIds.value.splice(index, 1)
  } else {
    selectedIds.value.push(id)
  }
}

const selectAll = () => {
  // Only select pending items
  const pendingItems = items.value.filter(i => i.status === 'pending')

  if (selectedIds.value.length === pendingItems.length && pendingItems.length > 0) {
    selectedIds.value = [] // 已经全选，则全不选
  } else {
    selectedIds.value = pendingItems.map(i => i.id) // 全选当页待处理项
  }
}

const submitAction = (action: 'process' | 'ignore') => {
  if (selectedIds.value.length === 0) {
    toast.add({ title: '请先选择要操作的书签', color: 'primary' })
    return
  }
  pendingAction.value = action
  // 重置处理类型为默认值
  if (action === 'process') {
    modalProcessType.value = 'auto'
  }
  showConfirmModal.value = true
}

const confirmAction = async () => {
  const action = pendingAction.value
  if (!action) return

  showConfirmModal.value = false

  try {
    const response = await $fetch<ActionResponse>('/api/info/management', {
      method: 'PUT',
      body: {
        action: action,
        ids: selectedIds.value,
        category: action === 'process' ? modalProcessType.value : undefined
      }
    })
    if (response.success) {
      toast.add({ title: response.message || '操作成功', color: 'success' })
      selectedIds.value = [] // clear selection
      fetchItems() // reload page
    }
  } catch (err: unknown) {
    console.error('Failed to apply action', err)
    toast.add({ title: getErrorMessage(err, '操作失败'), color: 'error' })
  } finally {
    pendingAction.value = null
  }
}

const cancelAction = () => {
  showConfirmModal.value = false
  pendingAction.value = null
}

const triggerSync = () => {
  if (syncing.value) return
  showSyncModal.value = true
}

const confirmSync = async () => {
  showSyncModal.value = false
  syncing.value = true
  try {
    const response = await $fetch<SyncResponse>('/api/info/sync', {
      method: 'POST'
    })

    if (response && response.message) {
      toast.add({
        title: '同步任务已启动',
        description: '同步将在后台进行，可能需要几分钟时间。完成后刷新页面即可看到新书签。',
        color: 'success'
      })

      // 等待几秒后自动刷新列表
      setTimeout(() => {
        fetchItems()
      }, 5000)
    }
  } catch (err: unknown) {
    console.error('Failed to sync bookmarks', err)
    let errorMsg = getErrorMessage(err, '无法连接到同步服务')

    if (errorMsg.includes('fetch')) {
      errorMsg = '请确保 Python Fetcher 服务正在运行 (cd x-bookmark-fetcher && ./status.sh)'
    }

    toast.add({ title: '同步失败', description: errorMsg, color: 'error' })
  } finally {
    syncing.value = false
  }
}

const openSource = (url: string) => {
  window.open(url, '_blank')
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

usePageTitle('书签资源管理')

onMounted(() => {
  fetchItems()
})
</script>

<template>
  <UDashboardPanel grow>
    <div class="flex justify-end gap-2 px-4 py-2 border-b border-default">
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="syncing"
        size="sm"
        @click="triggerSync"
      >
        <span class="hidden sm:inline">同步书签</span>
      </UButton>
      <div class="flex items-center p-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
        <UButton
          v-for="tab in tabs"
          :key="tab.value"
          :color="statusFilter === tab.value ? 'primary' : 'neutral'"
          :variant="statusFilter === tab.value ? 'solid' : 'ghost'"
          size="sm"
          class="rounded-md transition-all px-3 sm:px-4"
          @click="statusFilter = tab.value"
        >
          {{ tab.label }}
        </UButton>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-check-square"
        size="sm"
        @click="selectAll"
      >
        <span class="hidden sm:inline">全选当页</span>
      </UButton>
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-slash"
        size="sm"
        class="hidden sm:inline-flex"
        @click="submitAction('ignore')"
      >
        忽略选中项
      </UButton>
      <UButton
        color="primary"
        icon="i-lucide-download-cloud"
        size="sm"
        @click="submitAction('process')"
      >
        <span class="hidden sm:inline">处理选中项</span>
      </UButton>
    </div>

    <!-- 同步状态提示 -->
    <div v-if="syncing" class="mx-6 mt-6 mb-4">
      <UAlert
        icon="i-lucide-refresh-cw"
        color="primary"
        variant="soft"
        title="正在同步书签..."
        description="同步任务已在后台运行，这可能需要几分钟时间。如果首次同步或会话过期，可能会打开浏览器窗口要求登录。"
        :ui="{ icon: 'animate-spin' }"
      />
    </div>

    <div class="flex-1 overflow-auto p-3 sm:p-6">
      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-20">
        <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
      </div>

      <div v-else-if="items.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
        <UIcon name="i-lucide-inbox" class="w-16 h-16 text-muted mb-4" />
        <h3 class="text-lg font-medium text-default mb-2">
          {{ statusFilter === 'pending' ? '暂无未处理书签' : '暂无已处理书签' }}
        </h3>
      </div>

      <div v-if="items.length > 0" class="max-w-6xl mx-auto space-y-3 sm:space-y-4">
        <div
          v-for="item in items"
          :key="item.id"
          class="group flex items-start gap-3 sm:gap-4 p-3 sm:p-5 rounded-xl border transition-all duration-200"
          :class="[
            item.status === 'processed' ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20 opacity-60'
            : item.status === 'ignored' ? 'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/20 opacity-50'
              : item.status === 'processing' ? 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 opacity-70'
                : selectedIds.includes(item.id) ? 'border-primary ring-1 ring-primary bg-primary/5 cursor-pointer'
                  : item.status === 'pending' ? 'border-default bg-default hover:border-primary/30 hover:shadow-sm cursor-pointer' : 'border-default bg-default'
          ]"
          @click="item.status === 'pending' ? handleSelection(item.id) : null"
        >
          <!-- Checkbox column -->
          <div class="pt-1">
            <UCheckbox
              v-if="item.status === 'pending'"
              :model-value="selectedIds.includes(item.id)"
              @click.stop="handleSelection(item.id)"
            />
            <UIcon
              v-else-if="item.status === 'processed'"
              name="i-lucide-check-circle-2"
              class="w-5 h-5 text-green-600 dark:text-green-400"
            />
            <UIcon
              v-else-if="item.status === 'ignored'"
              name="i-lucide-x-circle"
              class="w-5 h-5 text-gray-400"
            />
            <UIcon
              v-else-if="item.status === 'processing'"
              name="i-lucide-loader-2"
              class="w-5 h-5 text-blue-500 animate-spin"
            />
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <div class="flex-1">
                <h4
                  v-if="item.article_title"
                  class="text-sm font-semibold text-primary mb-1.5 line-clamp-1"
                >
                  {{ item.article_title }}
                </h4>
                <p
                  class="text-sm text-default mb-3 whitespace-pre-wrap"
                  :class="item.article_title ? '' : 'font-medium'"
                >
                  {{ item.content_snippet }}
                </p>
              </div>

              <!-- Cover Image Thumbnail -->
              <div v-if="item.cover_image" class="shrink-0 order-first sm:order-none">
                <img
                  :src="item.cover_image"
                  class="w-full sm:w-60 h-32 sm:h-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
                  loading="lazy"
                >
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-muted">
              <span class="flex items-center gap-1 font-semibold text-gray-700 dark:text-gray-300">
                <UIcon name="i-lucide-at-sign" class="w-3.5 h-3.5" />
                {{ item.author_handle }}
              </span>
              <span class="flex items-center gap-1">
                <UIcon name="i-lucide-clock" class="w-3.5 h-3.5" />
                {{ formatDate(item.post_time || item.created_at) }}
              </span>
              <UBadge
                v-if="item.status === 'processed'"
                size="xs"
                color="success"
                variant="subtle"
              >
                已处理
              </UBadge>
              <UBadge
                v-else-if="item.status === 'processing'"
                size="xs"
                color="info"
                variant="subtle"
              >
                处理中
              </UBadge>
              <UBadge
                v-else-if="item.status === 'ignored'"
                size="xs"
                color="neutral"
                variant="subtle"
              >
                已忽略
              </UBadge>
              <UBadge
                v-if="item.has_external_link"
                size="xs"
                color="info"
                variant="subtle"
              >
                包含外部内容
              </UBadge>
              <span
                class="flex items-center gap-1 hover:text-primary cursor-pointer sm:border-l sm:border-gray-200 sm:dark:border-gray-700 sm:pl-4"
                @click.stop="openSource(item.source_url)"
              >
                <UIcon name="i-lucide-external-link" class="w-3.5 h-3.5" />
                <span class="hidden sm:inline">在 X/Twitter 查看</span>
                <span class="sm:hidden">查看原文</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex justify-center pt-6 pb-12">
          <UPagination v-model:page="page" :total="totalPages * 20" :items-per-page="20" />
        </div>
      </div>
    </div>

    <!-- Confirmation Modal -->
    <UModal v-model:open="showConfirmModal" :ui="{ footer: 'justify-end' }">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon
            :name="pendingAction === 'ignore' ? 'i-lucide-slash' : 'i-lucide-download-cloud'"
            class="w-5 h-5 text-primary"
          />
          <h3 class="text-lg font-semibold">
            {{ pendingAction === 'ignore' ? '忽略书签' : '处理书签' }}
          </h3>
        </div>
      </template>

      <template #body>
        <div class="py-4 space-y-4">
          <p class="text-default">
            已选择 <span class="font-semibold text-primary">{{ selectedIds.length }}</span> 个书签
          </p>

          <!-- <div v-if="pendingAction === 'process'" class="space-y-3">
                        <label class="block text-sm font-medium text-default">选择处理类型</label>
                        <URadioGroup v-model="modalProcessType" :options="[
                            { value: 'auto', label: '智能识别', description: '根据内容自动判断：有外部链接且内容丰富→推荐文章，其余→前沿资讯' },
                            { value: 'news', label: '前沿资讯', description: '简短的技术动态、趋势分享' },
                            { value: 'article', label: '推荐文章', description: '深度技术文章、教程指南' }
                        ]" :ui="{
                            fieldset: 'space-y-2',
                            wrapper: 'flex items-start gap-3 p-3 rounded-lg border border-default hover:border-primary/50 cursor-pointer transition-colors',
                            label: 'flex flex-col',
                            description: 'text-xs text-muted mt-0.5'
                        }" />
                    </div>

                    <p v-else class="text-sm text-muted">
                        确定要忽略这些书签吗？忽略后将不再出现在待处理列表中。
                    </p> -->
        </div>
      </template>

      <template #footer>
        <UButton color="neutral" variant="outline" @click="cancelAction">
          取消
        </UButton>
        <UButton :color="pendingAction === 'ignore' ? 'neutral' : 'primary'" @click="confirmAction">
          {{ pendingAction === 'ignore' ? '确认忽略' : '开始处理' }}
        </UButton>
      </template>
    </UModal>

    <!-- Sync Confirmation Modal -->
    <UModal v-model:open="showSyncModal" :ui="{ footer: 'justify-end' }">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-refresh-cw" class="w-5 h-5 text-primary" />
          <h3 class="text-lg font-semibold">
            同步 X/Twitter 书签
          </h3>
        </div>
      </template>
      <template #body>
        <div class="py-4 space-y-4 text-default text-sm">
          <p>确定要启动自动同步书签任务吗？</p>
          <p class="text-muted">
            如果这是您近期首次同步或会话已过期，服务将会在后台自动打开无头浏览器窗口供您扫描二维码或登录。<br><br>
            同步过程可能需要几分钟，请耐心等待。
          </p>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="showSyncModal = false">
          取消
        </UButton>
        <UButton color="primary" @click="confirmSync">
          确定同步
        </UButton>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
