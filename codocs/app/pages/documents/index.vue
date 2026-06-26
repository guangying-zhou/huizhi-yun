<script setup lang="ts">
/**
 * 文档列表页面
 *
 * 显示用户的所有文档，支持创建、搜索和分类筛选
 */

definePageMeta({
  layout: 'default'
})

interface DocumentItem {
  id: number
  uuid: string
  title: string
  doc_type: string
  owner_uid: string
  updated_at: string
  readonly_flag?: boolean
  [key: string]: unknown
}

// 文档列表数据
const documents = ref<DocumentItem[]>([])
const loading = ref(true)
const searchQuery = ref('')
const selectedType = ref<string | null>(null)

const { user } = useAuth()
const uid = computed(() => user.value || 'user1')
const toast = useToast()

// 文档类型选项
const docTypes = [
  { label: '全部', value: null },
  { label: '个人文档', value: 'private' },
  { label: '演示文稿', value: 'slide' },
  { label: '部门文档', value: 'department' },
  { label: '项目文档', value: 'project' },
  { label: '知识库', value: 'knowledge' }
]

// 获取文档列表
const fetchDocuments = async () => {
  loading.value = true
  try {
    const isPrivateView = selectedType.value === 'private'
    const { data } = await useFetch<{ data: { items: DocumentItem[] } }>('/api/documents', {
      query: {
        home: true,
        type: selectedType.value,
        ...(isPrivateView ? { exclude_worklogs: 1 } : {}),
        ...(searchQuery.value ? { search: searchQuery.value } : {})
      }
    })
    documents.value = data.value?.data?.items || []
  } catch (error) {
    console.error('Failed to fetch documents:', error)
  } finally {
    loading.value = false
  }
}

// Watch for filter changes to refetch
watch([selectedType, searchQuery], () => {
  // Debounce search if needed, but for now direct watch is fine or adding a debounce would be better
  // For simplicity, just refetch
  fetchDocuments()
})

// 过滤后的文档列表
// 过滤后的文档列表 (Computed filtering is removed as we do backend filtering now)
// But we keep the variable for compatibility with template
const filteredDocuments = computed(() => {
  return documents.value
})

// 创建新文档
const createDocument = async () => {
  try {
    const result = await $fetch<{ success: boolean, data: { uuid: string } }>('/api/documents', {
      method: 'POST',
      body: {
        title: `未命名文档 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
        doc_type: 'private',
        owner_uid: uid.value
      }
    })
    if (result.success && result.data?.uuid) {
      await navigateTo(`/documents/${result.data.uuid}`)
    }
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    console.error('Failed to create document:', error)
    toast.add({ title: error.data?.message || '创建文档失败', color: 'error' })
  }
}

// 打开文档
const openDocument = (doc: DocumentItem) => {
  navigateTo(`/documents/${doc.uuid}`)
}

// 获取文档类型标签颜色
const getTypeColor = (type: string): 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral' => {
  const colors: Record<string, 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
    'private': 'primary',
    'slide': 'secondary',
    'department': 'info',
    'project': 'success',
    'git-project': 'success',
    'knowledge': 'warning',
    'company': 'error'
  }
  return colors[type] || 'neutral'
}

// 获取文档类型标签文本
const getTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    'private': '个人',
    'slide': '演示文稿',
    'department': '部门',
    'project': '项目',
    'git-project': '代码库文档',
    'knowledge': '知识库',
    'company': '公司'
  }
  return labels[type] || type
}

// 初始化
onMounted(() => {
  fetchDocuments()
})
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-6xl">
    <!-- 页面标题 -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">
          文档中心
        </h1>
        <p class="mt-2 text-gray-600 dark:text-gray-400">
          首页展示的精选文档
        </p>
      </div>
      <UButton icon="i-lucide-plus" size="lg" @click="createDocument">
        新建文档
      </UButton>
    </div>

    <!-- 搜索和筛选 -->
    <div class="flex flex-col sm:flex-row gap-4 mb-6">
      <UInput
        v-model="searchQuery"
        icon="i-lucide-search"
        placeholder="搜索文档..."
        class="flex-1"
      />
      <UButtonGroup>
        <UButton
          v-for="type in docTypes"
          :key="type.value ?? 'all'"
          :variant="selectedType === type.value ? 'solid' : 'outline'"
          @click="selectedType = type.value"
        >
          {{ type.label }}
        </UButton>
      </UButtonGroup>
    </div>

    <!-- 文档列表 -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary-500" />
    </div>

    <div v-else-if="filteredDocuments.length === 0" class="text-center py-12">
      <UIcon name="i-lucide-file-text" class="w-16 h-16 mx-auto text-gray-400 mb-4" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
        暂无文档
      </h3>
      <p class="text-gray-600 dark:text-gray-400 mb-4">
        {{ searchQuery ? '没有找到匹配的文档' : '开始创建您的第一个文档吧' }}
      </p>
      <UButton v-if="!searchQuery" icon="i-lucide-plus" @click="createDocument">
        新建文档
      </UButton>
    </div>

    <div v-else class="grid gap-4">
      <div
        v-for="doc in filteredDocuments"
        :key="doc.id"
        class="group p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:shadow-lg hover:border-primary-300 dark:hover:border-primary-700 transition-all duration-200 cursor-pointer"
        @click="openDocument(doc)"
      >
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-2">
              <UIcon name="i-lucide-file-text" class="w-5 h-5 text-primary-500" />
              <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 truncate">
                {{ doc.title }}
              </h3>
              <UBadge
                v-if="doc.readonly_flag"
                color="neutral"
                variant="subtle"
                size="xs"
                class="ml-1"
              >
                <UIcon name="i-lucide-lock" class="w-3 h-3 mr-1" />
                只读
              </UBadge>
              <UBadge :color="getTypeColor(doc.doc_type)" size="xs">
                {{ getTypeLabel(doc.doc_type) }}
              </UBadge>
            </div>
            <div class="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
              <span class="flex items-center gap-1">
                <UIcon name="i-lucide-user" class="w-4 h-4" />
                {{ doc.owner_uid }}
              </span>
              <span class="flex items-center gap-1">
                <UIcon name="i-lucide-clock" class="w-4 h-4" />
                {{ doc.updated_at }}
              </span>
            </div>
          </div>
          <UButton
            icon="i-lucide-arrow-right"
            variant="ghost"
            class="opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>
      </div>
    </div>
  </div>
</template>
