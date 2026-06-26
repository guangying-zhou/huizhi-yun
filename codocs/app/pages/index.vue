<script setup lang="ts">
/**
 * 文档中心首页 - Dashboard 风格
 */

definePageMeta({
  layout: 'default'
})

interface DocItem {
  id: number
  uuid: string
  title: string
  doc_type: string
  updated_at: string
  is_opened?: number
  owner_uid?: string
  project_code?: string
  folder_name?: string
  [key: string]: unknown
}

interface NewsItem {
  id: number
  title: string
  category?: string
  published_at?: string
  author?: string
  cover_image?: string
  view_count?: number
  [key: string]: unknown
}

const { user, userRealname } = useAuth()
const uid = computed(() => user.value || '')
const toast = useToast()
const { isOpen: isQuickCreateOpen } = useQuickCreateDoc()

// --- 数据加载 ---
const recentDocs = ref<DocItem[]>([])
const favoriteDocs = ref<DocItem[]>([])
const sharedDocs = ref<DocItem[]>([])
const homeDocs = ref<NewsItem[]>([])
const newsList = ref<NewsItem[]>([])
const loading = ref(true)
const isHydrated = ref(false)

function getGreeting() {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

const displayName = computed(() => {
  return userRealname.value || user.value || ''
})

const greeting = computed(() => {
  return isHydrated.value ? getGreeting() : '您好'
})

// 未读共享数
const unreadCount = computed(() => {
  return sharedDocs.value.filter(d => !d.is_opened).length
})

async function fetchAll() {
  if (!uid.value) return
  loading.value = true
  try {
    const [recentRes, favRes, sharedRes, articleRes, newsRes] = await Promise.allSettled([
      $fetch<{ data: { items: DocItem[] } }>('/api/documents', {
        query: { last_editor: uid.value, limit: 4, page: 1 }
      }),
      $fetch<{ data: { items: DocItem[] } }>('/api/documents', {
        query: { starred: true, owner: uid.value, limit: 6 }
      }),
      $fetch<{ data: { items: DocItem[] } }>('/api/documents', {
        query: { type: 'shared', owner: uid.value, limit: 3 }
      }),
      $fetch<{ data: { items: NewsItem[] } }>('/api/info/list', {
        query: { category: 'article', page: 1, pageSize: 4 }
      }),
      $fetch<{ data: { items: NewsItem[] }, items?: NewsItem[] }>('/api/info/list', {
        query: { category: 'news', page: 1, pageSize: 5 }
      })
    ])

    if (recentRes.status === 'fulfilled') {
      recentDocs.value = recentRes.value.data?.items || []
    }
    if (favRes.status === 'fulfilled') {
      favoriteDocs.value = favRes.value.data?.items || []
    }
    if (sharedRes.status === 'fulfilled') {
      sharedDocs.value = sharedRes.value.data?.items || []
    }
    if (articleRes.status === 'fulfilled') {
      homeDocs.value = articleRes.value.data?.items || []
    }
    if (newsRes.status === 'fulfilled') {
      newsList.value = newsRes.value.data?.items || newsRes.value.items || []
    }
  } finally {
    loading.value = false
  }
}

watch(user, (v) => {
  if (v) fetchAll()
}, { immediate: true })

// --- 操作 ---
const isCreatingLog = ref(false)
async function quickLog() {
  isCreatingLog.value = true
  try {
    const today = new Date()
    const dateKey = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    const res = await $fetch<{ success: boolean, data: { uuid: string, existed?: boolean } }>('/api/worklogs/create', {
      method: 'POST',
      body: {
        owner_uid: uid.value,
        owner_realname: userRealname.value || undefined,
        date: dateKey
      }
    })
    if (res.success && res.data?.uuid) {
      const query = res.data.existed ? {} : { new: '1' }
      await navigateTo({ path: `/documents/${res.data.uuid}`, query })
    }
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: error.data?.message || '创建日志失败', color: 'error' })
  } finally {
    isCreatingLog.value = false
  }
}

async function openDocument(doc: DocItem) {
  // Shared docs on homepage should also update read status before navigation.
  if (doc?.is_opened === 0 && uid.value) {
    try {
      await $fetch(`/api/documents/${doc.uuid}/read`, {
        method: 'POST',
        body: { uid: uid.value }
      })
      doc.is_opened = 1
    } catch (error) {
      console.error('Failed to mark shared doc as read from homepage:', error)
    }
  }

  navigateTo(`/documents/${doc.uuid}`)
}

function formatTime(dateStr: string | undefined) {
  if (!dateStr) return ''
  const d = new Date(dateStr)

  // Keep SSR and pre-hydration output deterministic to avoid mismatch.
  if (!isHydrated.value) {
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const typeIcons: Record<string, string> = {
  private: 'i-lucide-file-text',
  slide: 'i-lucide-presentation',
  department: 'i-lucide-building-2',
  project: 'i-lucide-folder-kanban',
  product: 'i-lucide-package',
  company: 'i-lucide-globe',
  shared: 'i-lucide-share-2',
  knowledge: 'i-lucide-library'
}

const typeColors: Record<string, string> = {
  private: 'text-blue-500',
  slide: 'text-fuchsia-500',
  department: 'text-teal-500',
  project: 'text-green-500',
  product: 'text-orange-500',
  company: 'text-red-500',
  shared: 'text-violet-500',
  knowledge: 'text-amber-500'
}

const typeLabels: Record<string, string> = {
  private: '个人',
  slide: '演示文稿',
  department: '部门',
  project: '项目',
  product: '产品',
  company: '公司',
  shared: '共享',
  knowledge: '知识库'
}

// 快捷入口
const quickLinks = [
  { label: '我的文档', icon: 'i-lucide-folder-open', to: '/mydocs', color: 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400' },
  { label: '协同文档', icon: 'i-lucide-share-2', to: '/mydocs/shared', color: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400' },
  { label: '项目文档', icon: 'i-lucide-folder-kanban', to: '/projects', color: 'bg-violet-50 dark:bg-violet-950 text-violet-600 dark:text-violet-400' },
  { label: '部门文档', icon: 'i-lucide-users', to: '/departments', color: 'bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400' }
]

usePageTitle('文档中心')

const isMac = ref(true)

onMounted(() => {
  isHydrated.value = true
  isMac.value = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
})
</script>

<template>
  <UDashboardPanel grow>
    <div class="flex-1 overflow-auto p-2">
      <div class="flex-1 overflow-y-auto w-full px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto space-y-6">
        <!-- 欢迎区 + 新建按钮 -->
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
              {{ greeting }}，{{ displayName }}
            </h1>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              欢迎使用汇智云文档协作平台
            </p>
          </div>
          <div class="flex items-center gap-3">
            <UButton
              icon="i-lucide-zap"
              size="lg"
              color="primary"
              variant="subtle"
              @click="isQuickCreateOpen = true"
            >
              快捷文档
              <div class="flex items-center gap-0.5 ml-1">
                <UKbd :value="isMac ? 'meta' : 'ctrl'" class="opacity-50" />
                <span class="text-xs opacity-50 font-medium">+</span>
                <UKbd value="K" class="opacity-50" />
              </div>
            </UButton>
            <UButton
              icon="i-lucide-pen-line"
              size="lg"
              :loading="isCreatingLog"
              @click="quickLog"
            >
              快速日志
            </UButton>
          </div>
        </div>

        <!-- 快捷入口 -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <NuxtLink
            v-for="link in quickLinks"
            :key="link.to"
            :to="link.to"
            class="group flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 transition-all duration-200"
          >
            <div class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" :class="link.color">
              <UIcon :name="link.icon" class="w-5 h-5" />
            </div>
            <span
              class="font-medium text-sm text-gray-700 dark:text-gray-200 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors"
            >
              {{ link.label }}
            </span>
          </NuxtLink>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex items-center justify-center py-20">
          <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary-500" />
        </div>

        <template v-else>
          <!-- 主内容区：左右两栏 -->
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- 左栏：最近文档 + 推荐文档 -->
            <div class="lg:col-span-2 space-y-6">
              <!-- 最近编辑 -->
              <section v-if="recentDocs.length">
                <div class="flex items-center justify-between mb-3">
                  <h2 class="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <UIcon name="i-lucide-clock" class="w-4 h-4 text-gray-400" />
                    最近编辑
                  </h2>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div
                    v-for="doc in recentDocs.slice(0, 6)"
                    :key="doc.uuid"
                    class="group relative p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:shadow-md hover:border-primary-200 dark:hover:border-primary-800 transition-all duration-200 cursor-pointer"
                    @click="openDocument(doc)"
                  >
                    <div class="flex items-start gap-3">
                      <div class="shrink-0 mt-0.5">
                        <UIcon
                          :name="typeIcons[doc.doc_type] || 'i-lucide-file-text'"
                          class="w-5 h-5"
                          :class="typeColors[doc.doc_type] || 'text-gray-400'"
                        />
                      </div>
                      <div class="flex-1 min-w-0">
                        <h3
                          class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors"
                        >
                          {{ doc.title }}
                        </h3>
                        <div class="flex items-center gap-2 mt-1.5">
                          <span class="text-xs text-gray-400">{{ formatTime(doc.updated_at) }}</span>
                          <UBadge
                            v-if="doc.doc_type && doc.doc_type !== 'private'"
                            variant="subtle"
                            size="xs"
                            color="neutral"
                          >
                            {{ typeLabels[doc.doc_type] || doc.doc_type }}
                          </UBadge>
                        </div>
                      </div>
                    </div>
                    <UIcon
                      name="i-lucide-arrow-up-right"
                      class="absolute top-3 right-3 w-4 h-4 text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                </div>
              </section>

              <!-- 推荐文章 -->
              <section v-if="homeDocs.length">
                <div class="flex items-center justify-between mb-3">
                  <h2 class="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <UIcon name="i-lucide-book-open" class="w-4 h-4 text-gray-400" />
                    推荐文章
                  </h2>
                  <NuxtLink to="/info/articles" class="text-xs text-primary-500 hover:text-primary-600 font-medium">
                    查看全部 →
                  </NuxtLink>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <NuxtLink
                    v-for="item in homeDocs"
                    :key="item.id"
                    :to="`/info/${item.id}`"
                    class="group rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden hover:shadow-md hover:border-primary-200 dark:hover:border-primary-800 transition-all duration-200"
                  >
                    <div
                      v-if="item.cover_image"
                      class="w-full aspect-5/2 relative overflow-hidden bg-gray-100 dark:bg-gray-800"
                    >
                      <img
                        :src="item.cover_image"
                        :alt="item.title"
                        class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      >
                    </div>
                    <div
                      v-else
                      class="w-full aspect-5/2 bg-linear-to-br from-primary-500/10 to-primary-500/5 flex items-center justify-center"
                    >
                      <UIcon name="i-lucide-file-text" class="w-10 h-10 text-primary-500/30" />
                    </div>
                    <div class="p-3">
                      <h3
                        class="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors"
                        :title="item.title"
                      >
                        {{ item.title }}
                      </h3>
                      <div class="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                        <span>{{ item.author }}</span>
                        <span class="text-gray-300 dark:text-gray-600">·</span>
                        <span>{{ formatTime(item.published_at) }}</span>
                        <template v-if="typeof item.view_count === 'number'">
                          <span class="text-gray-300 dark:text-gray-600">·</span>
                          <span class="flex items-center gap-1">
                            <UIcon name="i-lucide-eye" class="w-3.5 h-3.5" />
                            {{ item.view_count }}
                          </span>
                        </template>
                      </div>
                    </div>
                  </NuxtLink>
                </div>
              </section>
            </div>

            <!-- 右栏：收藏 + 共享 + 资讯 -->
            <div class="space-y-6">
              <!-- 收藏夹 -->
              <section>
                <div class="flex items-center justify-between mb-3">
                  <h2 class="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <UIcon name="i-lucide-star" class="w-4 h-4 text-amber-400" />
                    收藏夹
                    <UBadge
                      v-if="favoriteDocs.length"
                      variant="subtle"
                      size="xs"
                      color="neutral"
                    >
                      {{ favoriteDocs.length }}
                    </UBadge>
                  </h2>
                  <NuxtLink to="/mydocs/favorites" class="text-xs text-primary-500 hover:text-primary-600 font-medium">
                    全部 →
                  </NuxtLink>
                </div>
                <div
                  v-if="favoriteDocs.length"
                  class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800"
                >
                  <div
                    v-for="doc in favoriteDocs.slice(0, 5)"
                    :key="doc.uuid"
                    class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                    @click="openDocument(doc)"
                  >
                    <UIcon name="i-lucide-file-text" class="w-4 h-4 text-amber-400 shrink-0" />
                    <span class="text-sm text-gray-700 dark:text-gray-200 truncate flex-1">{{ doc.title }}</span>
                    <span class="text-xs text-gray-400 shrink-0">{{ formatTime(doc.updated_at) }}</span>
                  </div>
                </div>
                <div v-else class="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center">
                  <UIcon name="i-lucide-star" class="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                  <p class="text-xs text-gray-400">
                    暂无收藏文档
                  </p>
                </div>
              </section>

              <!-- 共享给我 -->
              <section>
                <div class="flex items-center justify-between mb-3">
                  <h2 class="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <UIcon name="i-lucide-share-2" class="w-4 h-4 text-violet-400" />
                    共享给我
                    <UBadge v-if="unreadCount > 0" size="xs" color="error">
                      {{ unreadCount }} 未读
                    </UBadge>
                  </h2>
                  <NuxtLink to="/mydocs/shared" class="text-xs text-primary-500 hover:text-primary-600 font-medium">
                    全部 →
                  </NuxtLink>
                </div>
                <div
                  v-if="sharedDocs.length"
                  class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800"
                >
                  <div
                    v-for="doc in sharedDocs.slice(0, 5)"
                    :key="doc.uuid"
                    class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                    @click="openDocument(doc)"
                  >
                    <div class="relative shrink-0">
                      <UIcon name="i-lucide-file-text" class="w-4 h-4 text-violet-400" />
                      <span v-if="!doc.is_opened" class="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
                    </div>
                    <span
                      class="text-sm truncate flex-1"
                      :class="doc.is_opened ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100 font-medium'"
                    >
                      {{ doc.title }}
                    </span>
                    <span class="text-xs text-gray-400 shrink-0">{{ formatTime(doc.updated_at) }}</span>
                  </div>
                </div>
                <div v-else class="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center">
                  <UIcon name="i-lucide-share-2" class="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                  <p class="text-xs text-gray-400">
                    暂无共享文档
                  </p>
                </div>
              </section>

              <!-- 前沿资讯 -->
              <section v-if="newsList.length">
                <div class="flex items-center justify-between mb-3">
                  <h2 class="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <UIcon name="i-lucide-newspaper" class="w-4 h-4 text-gray-400" />
                    前沿资讯
                  </h2>
                  <NuxtLink to="/info/news" class="text-xs text-primary-500 hover:text-primary-600 font-medium">
                    更多 →
                  </NuxtLink>
                </div>
                <div
                  class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800"
                >
                  <NuxtLink
                    v-for="item in newsList.slice(0, 6)"
                    :key="item.id"
                    :to="`/info/${item.id}`"
                    class="block px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <h4 class="text-sm text-gray-700 dark:text-gray-200 truncate">{{ item.title }}</h4>
                    <div class="flex items-center gap-2 mt-1">
                      <span v-if="item.category" class="text-xs text-primary-500">{{ item.category }}</span>
                      <span class="text-xs text-gray-400">{{ item.published_at ? formatTime(item.published_at) : ''
                      }}</span>
                      <span v-if="typeof item.view_count === 'number'" class="text-xs text-gray-400 flex items-center gap-1">
                        <UIcon name="i-lucide-eye" class="w-3.5 h-3.5" />
                        {{ item.view_count }}
                      </span>
                    </div>
                  </NuxtLink>
                </div>
              </section>
            </div>
          </div>
        </template>
      </div>
    </div>
  </UDashboardPanel>
</template>
