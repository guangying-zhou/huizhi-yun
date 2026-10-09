<script setup lang="ts">
/**
 * 资讯详情页
 * 路由: /info/[id]
 *
 * 使用 Milkdown 编辑器只读模式渲染 Markdown 内容
 */
import type { Department } from '~/types/account'

interface ViewerEntry {
  uid: string
  realName: string
}

interface InfoItem {
  id: number
  bookmark_id: string
  title: string
  category: 'news' | 'article'
  summary: string | null
  author: string | null
  oss_path: string
  cover_image: string
  published_at: string
  content: string
  view_count?: number
  viewers?: ViewerEntry[]
  tags?: string[]
  source_url?: string
}

interface InfoDetailResponse {
  success: boolean
  data: InfoItem
}

interface UserToAdd {
  uid: string
  realName: string
}

definePageMeta({
  layout: 'default'
})

usePageTitle('资讯详情')

const route = useRoute()
const id = route.params.id as string

const loading = ref(true)
const article = ref<InfoItem | null>(null)
const content = ref('')
const error = ref('')

const fetchDetail = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<InfoDetailResponse>(`/api/info/${id}`)
    if (response.success && response.data) {
      article.value = response.data
      content.value = response.data.content || ''
    }
  } catch (err: unknown) {
    console.error('Failed to fetch info detail:', err)
    const fetchError = err as { data?: { message?: string }, message?: string }
    error.value = fetchError.data?.message || fetchError.message || '加载失败'
  } finally {
    loading.value = false
  }
}

const goBack = () => {
  const category = article.value?.category
  if (category === 'article') {
    navigateTo('/info/articles')
  } else {
    navigateTo('/info/news')
  }
}

const deleting = ref(false)
const showDeleteConfirm = ref(false)
const deleteArticle = async () => {
  deleting.value = true
  try {
    await $fetch(`/api/info/${id}`, { method: 'DELETE' })
    toast.add({
      title: '删除成功',
      description: '文章已删除，关联书签已恢复未处理状态',
      color: 'success'
    })
    goBack()
  } catch (err: unknown) {
    const fetchError = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '删除失败',
      description: fetchError.data?.message || fetchError.message,
      color: 'error'
    })
  } finally {
    deleting.value = false
    showDeleteConfirm.value = false
  }
}

const openSource = () => {
  if (article.value?.source_url) {
    window.open(article.value.source_url, '_blank')
  }
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const toast = useToast()
const copyContent = async () => {
  if (!content.value) return
  try {
    await navigator.clipboard.writeText(content.value)
    toast.add({
      title: '复制成功',
      description: '文章Markdown源码已复制到剪贴板',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
  } catch {
    toast.add({
      title: '复制失败',
      description: '无法访问剪贴板，请手动选择',
      color: 'error',
      icon: 'i-lucide-x-circle'
    })
  }
}

// ===== 推荐功能 =====
const { userRealname, userNickname, user } = useAuth()
const { departmentFlat, loadDepartments } = useDepartmentSelector()

const showRecommendModal = ref(false)
const recommendTab = ref<'user' | 'dept'>('user')
const recommendUsers = ref<UserToAdd[]>([])
const recommendDepts = ref<string[]>([])
const recommendMessage = ref('')
const recommending = ref(false)

const currentUserName = computed(() => {
  return userRealname.value || userNickname.value || user.value || '有人'
})

const deptOptions = computed(() =>
  departmentFlat.value.map((d: Department) => ({ label: d.name, value: d.deptCode || String(d.deptCode) }))
)

const canRecommend = computed(() => {
  if (recommendTab.value === 'user') return recommendUsers.value.length > 0
  return recommendDepts.value.length > 0
})

const openRecommendModal = () => {
  showRecommendModal.value = true
  loadDepartments()
}

const sendRecommend = async () => {
  if (!article.value || !canRecommend.value) return

  recommending.value = true
  try {
    const body: Record<string, unknown> = {
      articleTitle: article.value.title,
      articleId: article.value.id,
      senderName: currentUserName.value,
      message: recommendMessage.value.trim() || undefined
    }

    if (recommendTab.value === 'user') {
      body.toUsers = recommendUsers.value.map(u => u.uid)
    } else {
      body.toDepts = recommendDepts.value
    }

    const res = await $fetch<{ success: boolean, message: string }>('/api/info/recommend', {
      method: 'POST',
      body
    })

    if (res.success) {
      toast.add({ title: '推荐成功', description: res.message, color: 'success' })
      showRecommendModal.value = false
      recommendUsers.value = []
      recommendDepts.value = []
      recommendMessage.value = ''
    } else {
      toast.add({ title: '推荐失败', description: res.message, color: 'error' })
    }
  } catch (err: unknown) {
    const fetchError = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '推荐失败',
      description: fetchError.data?.message || fetchError.message || '请稍后重试',
      color: 'error'
    })
  } finally {
    recommending.value = false
  }
}

onMounted(() => {
  fetchDetail()
})
</script>

<template>
  <UDashboardPanel grow>
    <div class="flex items-center justify-between px-4 py-2 border-b border-default">
      <UButton
        icon="i-lucide-arrow-left"
        variant="ghost"
        color="neutral"
        @click="goBack"
      >
        返回列表
      </UButton>
      <div class="flex items-center gap-2">
        <UButton
          v-if="article?.category === 'article'"
          icon="i-lucide-send"
          variant="soft"
          color="primary"
          size="sm"
          @click="openRecommendModal"
        >
          推荐
        </UButton>
        <UButton
          icon="i-lucide-copy"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="copyContent"
        >
          复制全文
        </UButton>
        <UButton
          v-if="article?.source_url"
          icon="i-lucide-external-link"
          variant="outline"
          color="neutral"
          size="sm"
          @click="openSource"
        >
          查看原文
        </UButton>
        <UButton
          icon="i-lucide-trash-2"
          variant="soft"
          color="error"
          size="sm"
          @click="showDeleteConfirm = true"
        >
          删除
        </UButton>
      </div>
    </div>

    <div class="flex-1 overflow-auto">
      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-20">
        <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
      </div>

      <!-- Error -->
      <div v-else-if="error" class="flex flex-col items-center justify-center py-20 text-center">
        <UIcon name="i-lucide-alert-circle" class="w-16 h-16 text-red-400 mb-4" />
        <h3 class="text-lg font-medium text-default mb-2">
          加载失败
        </h3>
        <p class="text-sm text-muted mb-4">
          {{ error }}
        </p>
        <UButton variant="outline" @click="goBack">
          返回列表
        </UButton>
      </div>

      <!-- Content -->
      <div v-else-if="article" class="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        <!-- Header -->
        <div class="mb-6 sm:mb-8">
          <h1 class="text-xl sm:text-2xl font-bold text-default mb-3 sm:mb-4 leading-snug">
            {{ article.title }}
          </h1>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
            <span class="flex items-center gap-1.5">
              <UIcon name="i-lucide-user" class="w-4 h-4" />
              {{ article.author }}
            </span>
            <span class="flex items-center gap-1.5">
              <UIcon name="i-lucide-calendar" class="w-4 h-4" />
              {{ formatDate(article.published_at) }}
            </span>
            <UTooltip v-if="typeof article.view_count === 'number'" :disabled="!article.viewers?.length">
              <span class="flex items-center gap-1.5 cursor-default">
                <UIcon name="i-lucide-eye" class="w-4 h-4" />
                阅读 {{ article.view_count }}
              </span>
              <template #content>
                <div class="text-xs max-h-60 overflow-y-auto py-1 px-0.5">
                  {{ article.viewers?.map(v => v.realName).join(' ') }}
                </div>
              </template>
            </UTooltip>
            <!-- <UBadge :color="article.category === 'article' ? 'primary' : 'info'" variant="subtle" size="sm">
                            {{ article.category === 'article' ? '推荐文章' : '前沿资讯' }}
                        </UBadge> -->
          </div>
          <div v-if="article.tags && article.tags.length > 0" class="flex flex-wrap gap-1.5 mt-3">
            <UBadge
              v-for="tag in article.tags"
              :key="tag"
              color="neutral"
              variant="subtle"
              size="xs"
            >
              {{ tag }}
            </UBadge>
          </div>
        </div>

        <!-- Milkdown Editor -->
        <div class="bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-75 p-0">
          <EditorMilkdownEditor
            v-if="content"
            :model-value="content"
            :show-sidebar="false"
            :readonly="true"
            container-height="auto"
          />
          <div v-else class="flex items-center justify-center py-20 text-muted">
            <p>暂无内容</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <UModal v-model:open="showDeleteConfirm" title="确认删除" :ui="{ footer: 'justify-end' }">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            确定要删除这篇{{ article?.category === 'article' ? '推荐文章' : '前沿资讯' }}吗？
          </p>
          <p class="text-sm text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-900/30 p-2 rounded">
            如果此内容是从书签导入的，删除后该书签将恢复为“未处理”状态。
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 pt-2">
          <UButton color="neutral" variant="ghost" @click="showDeleteConfirm = false">
            取消
          </UButton>
          <UButton color="error" :loading="deleting" @click="deleteArticle">
            确认删除
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 推荐弹窗 -->
    <UModal v-model:open="showRecommendModal" title="推荐文章" :ui="{ footer: 'justify-end' }">
      <template #body>
        <div class="space-y-4">
          <!-- Tab 切换 -->
          <div class="flex gap-2">
            <UButton
              :color="recommendTab === 'user' ? 'primary' : 'neutral'"
              :variant="recommendTab === 'user' ? 'solid' : 'outline'"
              size="sm"
              @click="recommendTab = 'user'"
            >
              推荐给个人
            </UButton>
            <UButton
              :color="recommendTab === 'dept' ? 'primary' : 'neutral'"
              :variant="recommendTab === 'dept' ? 'solid' : 'outline'"
              size="sm"
              @click="recommendTab = 'dept'"
            >
              推荐给部门
            </UButton>
          </div>

          <!-- 选择个人 -->
          <UFormField v-if="recommendTab === 'user'" label="选择推荐对象">
            <DocumentUserTreeSelect v-model="recommendUsers" />
          </UFormField>

          <!-- 选择部门 -->
          <UFormField v-if="recommendTab === 'dept'" label="选择推荐部门">
            <USelectMenu
              v-model="recommendDepts"
              :items="deptOptions"
              value-key="value"
              placeholder="请选择部门"
              multiple
              searchable
              class="w-full"
            />
          </UFormField>

          <!-- 附言 -->
          <UFormField label="附言（可选）">
            <UTextarea
              v-model="recommendMessage"
              placeholder="写几句推荐语..."
              :rows="2"
              autoresize
              :maxrows="4"
            />
          </UFormField>

          <!-- 消息预览 -->
          <div class="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 text-sm text-muted">
            <p class="font-medium text-default mb-1">
              消息预览
            </p>
            <p>
              {{ currentUserName }}觉得《{{ article?.title }}》这篇文章值得一读，特向你推荐，请你抽空阅读。
            </p>
            <p v-if="recommendMessage.trim()" class="mt-1">
              附言：{{ recommendMessage.trim() }}
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 pt-2">
          <UButton color="neutral" variant="ghost" @click="showRecommendModal = false">
            取消
          </UButton>
          <UButton
            color="primary"
            :loading="recommending"
            :disabled="!canRecommend"
            @click="sendRecommend"
          >
            发送推荐
          </UButton>
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
