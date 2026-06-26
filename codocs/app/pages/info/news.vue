<script setup lang="ts">
/**
 * 前沿资讯列表页
 * 路由: /info/news
 */

definePageMeta({
  layout: 'default'
})

interface InfoItem {
  id: string
  title: string
  author: string
  category: 'article' | 'news'
  source_url: string
  published_at: string
  summary: string
  tags?: string[]
  view_count?: number
}

interface InfoListResponse {
  success: boolean
  data: {
    items: InfoItem[]
    pagination: { totalPages: number }
    last_updated?: string
  }
}

usePageTitle('前沿资讯')

const loading = ref(true)
const items = ref<InfoItem[]>([])
const page = ref(1)
const totalPages = ref(1)
const lastUpdated = ref('')

const fetchItems = async () => {
  loading.value = true
  try {
    const response = await $fetch<InfoListResponse>('/api/info/list', {
      query: {
        category: 'news',
        page: page.value,
        pageSize: 20
      }
    })
    if (response.success) {
      items.value = response.data.items
      totalPages.value = response.data.pagination.totalPages
      lastUpdated.value = response.data.last_updated || ''
    }
  } catch (error) {
    console.error('Failed to fetch news:', error)
  } finally {
    loading.value = false
  }
}

const openDetail = (item: InfoItem) => {
  if (item?.id) {
    navigateTo(`/info/${item.id}`)
  }
}

const openSource = (url: string) => {
  window.open(url, '_blank')
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

const formatTime = (dateStr: string) => {
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

watch(page, () => fetchItems())

onMounted(() => {
  fetchItems()
})
</script>

<template>
  <UDashboardPanel grow>
    <div v-if="lastUpdated" class="flex justify-end gap-2 px-4 py-2 border-b border-default">
      <span class="text-xs text-muted">
        更新于 {{ formatTime(lastUpdated) }}
      </span>
    </div>

    <div class="flex-1 overflow-auto p-3 sm:p-6">
      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-20">
        <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
      </div>

      <!-- Empty state -->
      <div v-else-if="items.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
        <UIcon name="i-lucide-newspaper" class="w-16 h-16 text-muted mb-4" />
        <h3 class="text-lg font-medium text-default mb-2">
          暂无资讯
        </h3>
        <p class="text-sm text-muted">
          资讯内容同步中，请稍后查看
        </p>
      </div>

      <!-- List -->
      <div v-else class="max-w-4xl mx-auto space-y-4">
        <div
          v-for="item in items"
          :key="item.id"
          class="group p-5 rounded-xl border border-default bg-default hover:shadow-lg hover:border-primary/30 transition-all duration-200 cursor-pointer"
          @click="openDetail(item)"
        >
          <div class="flex items-start gap-4">
            <div class="flex-1 min-w-0">
              <!-- Title -->
              <h3
                class="text-base font-semibold text-default mb-2 line-clamp-2 group-hover:text-primary transition-colors"
              >
                {{ item.title }}
              </h3>

              <!-- Summary -->
              <p class="text-sm text-muted line-clamp-3 mb-3">
                {{ item.summary }}
              </p>

              <!-- Meta -->
              <div class="flex items-center gap-4 text-xs text-muted">
                <span class="flex items-center gap-1">
                  <UIcon name="i-lucide-user" class="w-3.5 h-3.5" />
                  {{ item.author }}
                </span>
                <span class="flex items-center gap-1">
                  <UIcon name="i-lucide-calendar" class="w-3.5 h-3.5" />
                  {{ formatDate(item.published_at) }}
                </span>
                <span v-if="typeof item.view_count === 'number'" class="flex items-center gap-1">
                  <UIcon name="i-lucide-eye" class="w-3.5 h-3.5" />
                  {{ item.view_count }}
                </span>
                <span
                  v-if="item.source_url"
                  class="flex items-center gap-1 hover:text-primary cursor-pointer"
                  @click.stop="openSource(item.source_url)"
                >
                  <UIcon name="i-lucide-external-link" class="w-3.5 h-3.5" />
                  原文
                </span>
              </div>

              <!-- Tags -->
              <div v-if="item.tags && item.tags.length > 0" class="flex flex-wrap gap-1.5 mt-3">
                <UBadge
                  v-for="tag in item.tags"
                  :key="tag"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                >
                  {{ tag }}
                </UBadge>
              </div>
            </div>

            <!-- Arrow -->
            <UIcon
              name="i-lucide-chevron-right"
              class="w-5 h-5 text-muted opacity-0 group-hover:opacity-100 transition-opacity mt-1 shrink-0"
            />
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex justify-center pt-6">
          <UPagination v-model:page="page" :total="totalPages * 20" :items-per-page="20" />
        </div>
      </div>
    </div>
  </UDashboardPanel>
</template>
