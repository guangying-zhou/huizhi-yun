<script setup lang="ts">
/* eslint-disable vue/no-v-html */
/**
 * 需求与Bug跟踪页面
 * /projectCode/issues
 */
import { marked } from 'marked'

definePageMeta({ layout: 'default' })

usePageTitle('需求与Bug')

interface IssueComment {
  id: number
  author: string
  content: string
  created_at: string
}

interface Issue {
  id: number
  title: string
  description: string
  issue_type: string
  priority: string
  status: string
  assignee: string | null
  created_by: string
  created_at: string
  updated_at: string
  comment_count?: number
  comments?: IssueComment[]
}

interface IssueListResponse {
  data?: {
    items: Issue[]
    total: number
  }
}

interface IssueDetailResponse {
  data: Issue
}

const { user } = useAuth()
const uid = computed(() => user.value || '')
const toast = useToast()
const ISSUE_PROJECT_CODE = 'huizhi-yun'

// --- 筛选状态 ---
const filterStatus = ref<string>('all')
const filterType = ref<string>('all')
const filterPriority = ref<string>('all')
const searchQuery = ref('')
const currentPage = ref(1)

// --- 数据 ---
const issues = ref<Issue[]>([])
const total = ref(0)
const loading = ref(true)
const selectedIssue = ref<Issue | null>(null)
const userNameMap = ref<Record<string, string>>({})

function displayName(uid: string | null | undefined): string {
  if (!uid) return ''
  return userNameMap.value[uid] || uid
}

async function loadUserNames(uids: string[]) {
  const unknown = uids.filter(u => u && !userNameMap.value[u])
  if (unknown.length === 0) return
  try {
    const res = await $fetch<{ code: number, data: Array<{ uid: string, realName: string }> }>('/api/account/users/batch', {
      method: 'POST',
      body: { uids: unknown }
    })
    if (res.data) {
      for (const u of res.data) {
        userNameMap.value[u.uid] = u.realName || u.uid
      }
    }
  } catch {
    // 降级显示 uid
  }
}
const showDetail = ref(false)
const showCreateModal = ref(false)
const showDeleteConfirm = ref(false)
const deleteTarget = ref<Issue | null>(null)
const showResolveConfirm = ref(false)
const resolveTarget = ref<Issue | null>(null)
const resolveResolution = ref('')

// --- 常量 ---
const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '待处理', value: 'open' },
  { label: '处理中', value: 'in_progress' },
  { label: '已解决', value: 'resolved' },
  { label: '已关闭', value: 'closed' },
  { label: '已拒绝', value: 'rejected' }
]

const typeOptions = [
  { label: '全部类型', value: 'all' },
  { label: '缺陷', value: 'bug' },
  { label: '需求', value: 'feature' },
  { label: '改进', value: 'improvement' }
]

const priorityOptions = [
  { label: '全部优先级', value: 'all' },
  { label: '紧急', value: 'critical' },
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' }
]

const statusConfig: Record<string, { label: string, color: string, icon: string }> = {
  open: { label: '待处理', color: 'text-orange-500', icon: 'i-lucide-circle-dot' },
  in_progress: { label: '处理中', color: 'text-blue-500', icon: 'i-lucide-loader' },
  resolved: { label: '已解决', color: 'text-green-500', icon: 'i-lucide-check-circle' },
  closed: { label: '已关闭', color: 'text-gray-400', icon: 'i-lucide-circle-check' },
  rejected: { label: '已拒绝', color: 'text-red-400', icon: 'i-lucide-circle-x' }
}

const typeConfig: Record<string, { label: string, color: 'error' | 'primary' | 'warning', icon: string }> = {
  bug: { label: '缺陷', color: 'error', icon: 'i-lucide-bug' },
  feature: { label: '需求', color: 'primary', icon: 'i-lucide-lightbulb' },
  improvement: { label: '改进', color: 'warning', icon: 'i-lucide-wrench' }
}

const priorityConfig: Record<string, { label: string, color: string }> = {
  critical: { label: '紧急', color: 'text-red-600 bg-red-50 dark:bg-red-950' },
  high: { label: '高', color: 'text-orange-600 bg-orange-50 dark:bg-orange-950' },
  medium: { label: '中', color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950' },
  low: { label: '低', color: 'text-gray-500 bg-gray-50 dark:bg-gray-900' }
}

function escapeHtml(content: string) {
  return content
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function renderMarkdown(content?: string | null) {
  if (!content?.trim()) return ''

  return marked.parse(escapeHtml(content), {
    breaks: true,
    gfm: true
  }) as string
}

// --- 获取列表 ---
async function fetchIssues() {
  loading.value = true
  try {
    const res = await $fetch<IssueListResponse>('/api/issues', {
      query: {
        status: filterStatus.value !== 'all' ? filterStatus.value : undefined,
        issue_type: filterType.value !== 'all' ? filterType.value : undefined,
        priority: filterPriority.value !== 'all' ? filterPriority.value : undefined,
        search: searchQuery.value || undefined,
        page: currentPage.value,
        limit: 20
      }
    })
    issues.value = res.data?.items || []
    total.value = res.data?.total || 0
    // 批量加载用户姓名
    const uids = new Set<string>()
    for (const i of issues.value) {
      if (i.created_by) uids.add(i.created_by)
      if (i.assignee) uids.add(i.assignee)
    }
    if (uids.size > 0) loadUserNames([...uids])
  } catch (e) {
    console.error('Failed to fetch issues:', e)
  } finally {
    loading.value = false
  }
}

watch([filterStatus, filterType, filterPriority, searchQuery], () => {
  currentPage.value = 1
  fetchIssues()
})

watch(currentPage, fetchIssues)

// --- 查看详情 ---
async function viewIssue(issue: Issue) {
  try {
    const res = await $fetch<IssueDetailResponse>(`/api/issues/${issue.id}`)
    selectedIssue.value = res.data
    showDetail.value = true
    // 加载详情中涉及的用户姓名
    const uids = new Set<string>()
    if (res.data.created_by) uids.add(res.data.created_by)
    if (res.data.assignee) uids.add(res.data.assignee)
    for (const c of res.data.comments || []) {
      if (c.author) uids.add(c.author)
    }
    if (uids.size > 0) loadUserNames([...uids])
  } catch {
    toast.add({ title: '获取详情失败', color: 'error' })
  }
}

// --- 创建 Issue ---
const newIssue = ref({
  title: '',
  description: '',
  issue_type: 'bug',
  priority: 'medium',
  assignee: ''
})
const uploadingImage = ref(false)
const issueImages = ref<{ url: string, name: string }[]>([])
const descriptionRef = ref<HTMLTextAreaElement | null>(null)

function openCreateModal() {
  newIssue.value = {
    title: '',
    description: '',
    issue_type: 'bug',
    priority: 'medium',
    assignee: ''
  }
  issueImages.value = []
  showCreateModal.value = true
}

// --- 图片上传 ---
async function uploadImage(file: File) {
  if (!file.type.startsWith('image/')) {
    toast.add({ title: '仅支持图片文件', color: 'error' })
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    toast.add({ title: '图片大小不能超过 10MB', color: 'error' })
    return
  }

  uploadingImage.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)

    const res = await $fetch<{ success: boolean, url: string, name: string }>('/api/issues/upload-image', {
      method: 'POST',
      body: formData
    })

    if (res.success && res.url) {
      issueImages.value.push({ url: res.url, name: res.name })
      // 在描述中插入图片 Markdown
      const imgMarkdown = `![${res.name}](${res.url})\n`
      newIssue.value.description += (newIssue.value.description ? '\n' : '') + imgMarkdown
      toast.add({ title: '图片已上传', color: 'success' })
    }
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message || '图片上传失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    uploadingImage.value = false
  }
}

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    uploadImage(file)
    input.value = ''
  }
}

function onDescriptionPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) uploadImage(file)
      break
    }
  }
}

function onDescriptionDrop(e: DragEvent) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files?.length) return
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      uploadImage(file)
    }
  }
}

async function submitIssue() {
  if (!newIssue.value.title.trim()) {
    toast.add({ title: '请输入标题', color: 'error' })
    return
  }
  try {
    await $fetch('/api/issues', {
      method: 'POST',
      body: {
        project_code: ISSUE_PROJECT_CODE,
        title: newIssue.value.title,
        description: newIssue.value.description,
        issue_type: newIssue.value.issue_type,
        priority: newIssue.value.priority,
        assignee: newIssue.value.assignee || null,
        created_by: uid.value
      }
    })
    showCreateModal.value = false
    toast.add({ title: '创建成功', color: 'success' })
    fetchIssues()
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message || '创建失败'
    toast.add({ title: message, color: 'error' })
  }
}

// --- 快速改状态 ---
async function updateStatus(issue: Issue, newStatus: string) {
  try {
    await $fetch(`/api/issues/${issue.id}`, {
      method: 'PATCH',
      body: { status: newStatus }
    })
    toast.add({ title: `已标记为${statusConfig[newStatus]?.label}`, color: 'success' })
    fetchIssues()
    // 刷新详情
    if (selectedIssue.value?.id === issue.id) {
      selectedIssue.value.status = newStatus
    }
  } catch {
    toast.add({ title: '更新失败', color: 'error' })
  }
}

// --- 标记解决确认 ---
function confirmResolve(issue: Issue) {
  resolveTarget.value = issue
  resolveResolution.value = ''
  showResolveConfirm.value = true
}

async function doResolve() {
  if (!resolveTarget.value) return
  try {
    await $fetch(`/api/issues/${resolveTarget.value.id}`, {
      method: 'PATCH',
      body: { status: 'resolved', resolution: resolveResolution.value || null }
    })
    showResolveConfirm.value = false
    toast.add({ title: '已标记解决，已通知发起人', color: 'success' })
    fetchIssues()
    if (selectedIssue.value?.id === resolveTarget.value.id) {
      selectedIssue.value.status = 'resolved'
    }
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  }
}

// --- 删除 ---
function confirmDelete(issue: Issue) {
  deleteTarget.value = issue
  showDeleteConfirm.value = true
}

async function doDelete() {
  if (!deleteTarget.value) return
  try {
    await $fetch(`/api/issues/${deleteTarget.value.id}`, { method: 'DELETE' })
    showDeleteConfirm.value = false
    showDetail.value = false
    toast.add({ title: '已删除', color: 'success' })
    fetchIssues()
  } catch {
    toast.add({ title: '删除失败', color: 'error' })
  }
}

// --- 评论 ---
const newComment = ref('')

async function addComment() {
  if (!newComment.value.trim() || !selectedIssue.value) return
  try {
    await $fetch(`/api/issues/${selectedIssue.value.id}/comments`, {
      method: 'POST',
      body: { author: uid.value, content: newComment.value }
    })
    newComment.value = ''
    // 刷新详情
    const res = await $fetch<IssueDetailResponse>(`/api/issues/${selectedIssue.value.id}`)
    selectedIssue.value = res.data
  } catch {
    toast.add({ title: '评论失败', color: 'error' })
  }
}

function formatTime(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return d.toLocaleDateString('zh-CN')
}

// 统计
const stats = computed(() => {
  return {
    total: total.value,
    open: issues.value.filter(i => i.status === 'open').length,
    inProgress: issues.value.filter(i => i.status === 'in_progress').length,
    resolved: issues.value.filter(i => i.status === 'resolved' || i.status === 'closed').length
  }
})

onMounted(async () => {
  await fetchIssues()
})
</script>

<template>
  <UDashboardPanel grow>
    <div class="flex-1 overflow-auto py-6">
      <div class="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 space-y-5">
        <!-- 统计卡片 -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div class="text-2xl font-bold text-gray-900 dark:text-white">
              {{ stats.total }}
            </div>
            <div class="text-xs text-gray-500 mt-1">
              总计
            </div>
          </div>
          <div class="p-4 rounded-xl border border-orange-200 dark:border-orange-900 bg-orange-50 dark:bg-orange-950/30">
            <div class="text-2xl font-bold text-orange-600">
              {{ stats.open }}
            </div>
            <div class="text-xs text-orange-500 mt-1">
              待处理
            </div>
          </div>
          <div class="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30">
            <div class="text-2xl font-bold text-blue-600">
              {{ stats.inProgress }}
            </div>
            <div class="text-xs text-blue-500 mt-1">
              处理中
            </div>
          </div>
          <div class="p-4 rounded-xl border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30">
            <div class="text-2xl font-bold text-green-600">
              {{ stats.resolved }}
            </div>
            <div class="text-xs text-green-500 mt-1">
              已解决
            </div>
          </div>
        </div>

        <!-- 筛选栏 -->
        <div class="flex flex-col sm:flex-row gap-3">
          <UButton icon="i-lucide-plus" size="sm" @click="openCreateModal">
            提交Issue
          </UButton>
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            placeholder="搜索标题或描述..."
            class="flex-1"
          />
          <div class="flex gap-2 flex-wrap">
            <USelect v-model="filterStatus" :items="statusOptions" class="w-28" />
            <USelect v-model="filterType" :items="typeOptions" class="w-28" />
            <USelect v-model="filterPriority" :items="priorityOptions" class="w-32" />
          </div>
        </div>

        <!-- Issue 列表 -->
        <div v-if="loading" class="flex justify-center py-16">
          <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary-500" />
        </div>

        <div v-else-if="issues.length === 0" class="text-center py-16">
          <UIcon name="i-lucide-inbox" class="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            暂无Issue
          </h3>
          <p class="text-sm text-gray-500 mb-4">
            提交第一个需求或Bug吧
          </p>
          <UButton icon="i-lucide-plus" @click="openCreateModal">
            提交Issue
          </UButton>
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="issue in issues"
            :key="issue.id"
            class="group flex items-start gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:shadow-md hover:border-primary-200 dark:hover:border-primary-800 transition-all duration-200 cursor-pointer"
            @click="viewIssue(issue)"
          >
            <!-- 状态图标 -->
            <div class="shrink-0 mt-0.5">
              <UIcon
                :name="statusConfig[issue.status]?.icon || 'i-lucide-circle'"
                class="w-5 h-5"
                :class="statusConfig[issue.status]?.color"
              />
            </div>

            <!-- 内容 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3
                  class="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors"
                >
                  {{ issue.title }}
                </h3>
                <UBadge :color="typeConfig[issue.issue_type]?.color || 'neutral'" variant="subtle" size="xs">
                  <UIcon :name="typeConfig[issue.issue_type]?.icon || 'i-lucide-circle'" class="w-3 h-3 mr-0.5" />
                  {{ typeConfig[issue.issue_type]?.label || issue.issue_type }}
                </UBadge>
                <span class="text-xs px-1.5 py-0.5 rounded-md font-medium" :class="priorityConfig[issue.priority]?.color">
                  {{ priorityConfig[issue.priority]?.label }}
                </span>
              </div>
              <div class="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                <span>#{{ issue.id }}</span>
                <span>{{ displayName(issue.created_by) }} 提交于 {{ formatTime(issue.created_at) }}</span>
                <span v-if="issue.assignee" class="flex items-center gap-1">
                  <UIcon name="i-lucide-user" class="w-3 h-3" />
                  {{ displayName(issue.assignee) }}
                </span>
                <span v-if="(issue.comment_count ?? 0) > 0" class="flex items-center gap-1">
                  <UIcon name="i-lucide-message-square" class="w-3 h-3" />
                  {{ issue.comment_count }}
                </span>
              </div>
            </div>

            <!-- 快速操作 -->
            <div class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <UDropdownMenu
                :items="[
                  [
                    { label: '开始处理', icon: 'i-lucide-play', disabled: issue.status === 'in_progress', onSelect: () => updateStatus(issue, 'in_progress') },
                    { label: '标记解决', icon: 'i-lucide-check', disabled: issue.status === 'resolved', onSelect: () => confirmResolve(issue) },
                    { label: '关闭', icon: 'i-lucide-x-circle', disabled: issue.status === 'closed', onSelect: () => updateStatus(issue, 'closed') }
                  ],
                  [
                    { label: '删除', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => confirmDelete(issue) }
                  ]
                ]"
              >
                <UButton
                  icon="i-lucide-more-horizontal"
                  variant="ghost"
                  size="xs"
                  @click.stop
                />
              </UDropdownMenu>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <div v-if="total > 20" class="flex justify-center pt-4">
          <UPagination v-model="currentPage" :total="total" :items-per-page="20" />
        </div>
      </div>
    </div>

    <!-- 创建 Issue 模态框 -->
    <UModal v-model:open="showCreateModal" :ui="{ content: 'sm:max-w-3xl', footer: 'flex justify-end gap-2' }">
      <template #header>
        <h3 class="text-lg font-semibold">
          提交 Issue
        </h3>
      </template>
      <template #body>
        <div class="space-y-4 p-4">
          <UFormField label="标题" required>
            <UInput v-model="newIssue.title" placeholder="简要描述问题或需求" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="类型">
              <USelect
                v-model="newIssue.issue_type"
                :items="[
                  { label: '缺陷 Bug', value: 'bug' },
                  { label: '新需求', value: 'feature' },
                  { label: '改进', value: 'improvement' }
                ]"
                class="w-full"
              />
            </UFormField>
            <UFormField label="优先级">
              <USelect
                v-model="newIssue.priority"
                :items="[
                  { label: '紧急', value: 'critical' },
                  { label: '高', value: 'high' },
                  { label: '中', value: 'medium' },
                  { label: '低', value: 'low' }
                ]"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField label="负责人">
            <UInput v-model="newIssue.assignee" placeholder="用户名（可选）" class="w-full" />
          </UFormField>
          <UFormField label="详细描述">
            <div class="w-full space-y-2">
              <UTextarea
                ref="descriptionRef"
                v-model="newIssue.description"
                placeholder="详细描述问题的表现、复现步骤，或需求的具体内容...&#10;&#10;支持粘贴或拖拽图片"
                :rows="6"
                class="w-full"
                @paste="onDescriptionPaste"
                @drop="onDescriptionDrop"
                @dragover.prevent
              />
              <div class="flex items-center gap-2">
                <label
                  class="cursor-pointer inline-flex items-center gap-1.5 text-xs text-primary-500 hover:text-primary-600 transition-colors"
                >
                  <UIcon name="i-lucide-image-plus" class="w-4 h-4" />
                  <span>上传图片</span>
                  <input
                    type="file"
                    accept="image/*"
                    class="hidden"
                    @change="onFileSelect"
                  >
                </label>
                <span v-if="uploadingImage" class="text-xs text-gray-400 flex items-center gap-1">
                  <UIcon name="i-lucide-loader-2" class="w-3 h-3 animate-spin" />
                  上传中...
                </span>
                <span class="text-xs text-gray-400">支持粘贴截图、拖拽图片，最大 10MB</span>
              </div>
              <!-- 已上传图片预览 -->
              <div v-if="issueImages.length" class="flex gap-2 flex-wrap">
                <div v-for="(img, idx) in issueImages" :key="idx" class="relative group">
                  <img
                    :src="img.url"
                    :alt="img.name"
                    class="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                  <div
                    class="absolute inset-0 bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <UIcon name="i-lucide-check" class="w-5 h-5 text-white" />
                  </div>
                </div>
              </div>
            </div>
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="showCreateModal = false">
            取消
          </UButton>
          <UButton @click="submitIssue">
            提交
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Issue 详情弹窗 -->
    <UModal v-model:open="showDetail" :ui="{ content: 'max-w-4xl max-h-[90vh] overflow-hidden' }">
      <template #header>
        <div class="flex items-center justify-between w-full gap-4 px-2 sm:px-4 py-1">
          <div class="flex items-center gap-2 min-w-0">
            <UBadge :color="typeConfig[selectedIssue?.issue_type || '']?.color || 'neutral'" variant="subtle" size="xs">
              {{ typeConfig[selectedIssue?.issue_type || '']?.label }}
            </UBadge>
            <span class="text-xs text-gray-400">#{{ selectedIssue?.id }}</span>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            @click="showDetail = false"
          />
        </div>
      </template>
      <template #body>
        <div v-if="selectedIssue" class="max-h-[calc(90vh-8rem)] overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
          <!-- 标题 -->
          <div class="mx-auto w-full max-w-6xl space-y-6">
            <div class="space-y-4">
              <h2 class="text-xl font-semibold text-gray-900 dark:text-white">
                {{ selectedIssue.title }}
              </h2>

              <!-- 属性 -->
              <div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <div class="rounded-lg bg-gray-50 dark:bg-gray-800/70 p-3">
                  <span class="text-gray-400 text-xs">状态</span>
                  <div class="flex items-center gap-1.5 mt-1" :class="statusConfig[selectedIssue.status]?.color">
                    <UIcon :name="statusConfig[selectedIssue.status]?.icon" class="w-4 h-4" />
                    {{ statusConfig[selectedIssue.status]?.label }}
                  </div>
                </div>
                <div class="rounded-lg bg-gray-50 dark:bg-gray-800/70 p-3">
                  <span class="text-gray-400 text-xs">优先级</span>
                  <div class="mt-1">
                    <span
                      class="text-xs px-2 py-0.5 rounded-md font-medium"
                      :class="priorityConfig[selectedIssue.priority]?.color"
                    >
                      {{ priorityConfig[selectedIssue.priority]?.label }}
                    </span>
                  </div>
                </div>
                <div class="rounded-lg bg-gray-50 dark:bg-gray-800/70 p-3">
                  <span class="text-gray-400 text-xs">提交人</span>
                  <div class="mt-1 text-gray-700 dark:text-gray-200">
                    {{ displayName(selectedIssue.created_by) }}
                  </div>
                </div>
                <div class="rounded-lg bg-gray-50 dark:bg-gray-800/70 p-3">
                  <span class="text-gray-400 text-xs">负责人</span>
                  <div class="mt-1 text-gray-700 dark:text-gray-200">
                    {{ selectedIssue.assignee ? displayName(selectedIssue.assignee) : '未分配' }}
                  </div>
                </div>
                <div class="rounded-lg bg-gray-50 dark:bg-gray-800/70 p-3">
                  <span class="text-gray-400 text-xs">创建时间</span>
                  <div class="mt-1 text-gray-700 dark:text-gray-200">
                    {{ formatTime(selectedIssue.created_at) }}
                  </div>
                </div>
                <div class="rounded-lg bg-gray-50 dark:bg-gray-800/70 p-3">
                  <span class="text-gray-400 text-xs">更新时间</span>
                  <div class="mt-1 text-gray-700 dark:text-gray-200">
                    {{ formatTime(selectedIssue.updated_at) }}
                  </div>
                </div>
              </div>

              <!-- 状态操作 -->
              <div class="flex gap-2 flex-wrap">
                <UButton
                  v-if="selectedIssue.status === 'open'"
                  size="xs"
                  variant="soft"
                  color="primary"
                  icon="i-lucide-play"
                  @click="updateStatus(selectedIssue, 'in_progress')"
                >
                  开始处理
                </UButton>
                <UButton
                  v-if="selectedIssue.status === 'in_progress'"
                  size="xs"
                  variant="soft"
                  color="success"
                  icon="i-lucide-check"
                  @click="confirmResolve(selectedIssue!)"
                >
                  标记解决
                </UButton>
                <UButton
                  v-if="selectedIssue.status !== 'closed'"
                  size="xs"
                  variant="soft"
                  color="neutral"
                  icon="i-lucide-x-circle"
                  @click="updateStatus(selectedIssue!, 'closed')"
                >
                  关闭
                </UButton>
                <UButton
                  v-if="selectedIssue.status === 'closed' || selectedIssue.status === 'rejected'"
                  size="xs"
                  variant="soft"
                  color="warning"
                  icon="i-lucide-rotate-ccw"
                  @click="updateStatus(selectedIssue, 'open')"
                >
                  重新打开
                </UButton>
              </div>
            </div>

            <!-- 描述 -->
            <div v-if="selectedIssue.description">
              <h4 class="text-xs font-medium text-gray-400 mb-2">
                描述
              </h4>
              <div
                class="issue-markdown text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-xl p-5"
                v-html="renderMarkdown(selectedIssue.description)"
              />
            </div>

            <!-- 评论 -->
            <USeparator />
            <div>
              <h4 class="text-xs font-medium text-gray-400 mb-3">
                评论 ({{ selectedIssue.comments?.length || 0 }})
              </h4>
              <div v-if="selectedIssue.comments?.length" class="space-y-4 mb-4">
                <div v-for="comment in selectedIssue.comments" :key="comment.id" class="flex gap-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
                  <UAvatar :alt="displayName(comment.author)" size="sm" />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ displayName(comment.author) }}</span>
                      <span class="text-xs text-gray-400">{{ formatTime(comment.created_at) }}</span>
                    </div>
                    <div
                      class="issue-markdown text-sm text-gray-700 dark:text-gray-300 mt-1"
                      v-html="renderMarkdown(comment.content)"
                    />
                  </div>
                </div>
              </div>
              <!-- 添加评论 -->
              <div class="flex gap-2">
                <UTextarea
                  v-model="newComment"
                  placeholder="添加评论..."
                  :rows="2"
                  class="flex-1"
                />
                <UButton
                  icon="i-lucide-send"
                  variant="soft"
                  class="self-end"
                  :disabled="!newComment.trim()"
                  @click="addComment"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 删除确认 -->
    <UModal v-model:open="showDeleteConfirm">
      <template #header>
        <h3 class="text-lg font-semibold text-red-600">
          确认删除
        </h3>
      </template>
      <template #body>
        <p class="p-4 text-sm text-gray-600 dark:text-gray-300">
          确定要删除 <strong>{{ deleteTarget?.title }}</strong> 吗？此操作不可恢复。
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="showDeleteConfirm = false">
            取消
          </UButton>
          <UButton color="error" @click="doDelete">
            确认删除
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 标记解决确认弹窗 -->
    <UModal v-model:open="showResolveConfirm">
      <template #header>
        <span class="text-base font-semibold">标记解决</span>
      </template>
      <template #body>
        <div class="p-4 space-y-3">
          <p class="text-sm text-gray-600 dark:text-gray-300">
            确定要将 <strong>{{ resolveTarget?.title }}</strong> 标记为已解决吗？
          </p>
          <UFormField label="处理结果">
            <UTextarea
              v-model="resolveResolution"
              placeholder="请填写处理结果..."
              :rows="3"
              autoresize
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="showResolveConfirm = false">
            取消
          </UButton>
          <UButton color="success" @click="doResolve">
            确认解决
          </UButton>
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>

<style scoped>
.issue-markdown :deep(*) {
  word-break: break-word;
}

.issue-markdown :deep(p) {
  margin: 0 0 0.75rem;
}

.issue-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.issue-markdown :deep(ul),
.issue-markdown :deep(ol) {
  margin: 0.75rem 0;
  padding-left: 1.25rem;
}

.issue-markdown :deep(li) {
  margin: 0.25rem 0;
}

.issue-markdown :deep(code) {
  padding: 0.125rem 0.375rem;
  border-radius: 0.375rem;
  background: rgb(148 163 184 / 0.15);
  font-size: 0.875em;
}

.issue-markdown :deep(pre) {
  margin: 0.75rem 0;
  padding: 0.875rem 1rem;
  border-radius: 0.75rem;
  overflow-x: auto;
  background: rgb(15 23 42 / 0.92);
  color: rgb(226 232 240);
}

.issue-markdown :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.issue-markdown :deep(a) {
  color: rgb(37 99 235);
  text-decoration: underline;
}

.issue-markdown :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.75rem 0;
  border-radius: 0.75rem;
  border: 1px solid rgb(229 231 235);
}

.dark .issue-markdown :deep(img) {
  border-color: rgb(55 65 81);
}
</style>
