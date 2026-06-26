<script setup lang="ts">
/**
 * 文档共享组件
 * 管理文档的共享设置
 */
import { ref, computed } from 'vue'

interface ShareUser {
  id: number
  uid: string
  realName: string
  email: string
  permission: 'read' | 'write'
  isOpened: boolean
  openedAt?: string
  createdAt: string
}

interface RawShareUser {
  id: number
  uid?: string
  shared_to_uid?: string
  realName?: string
  real_name?: string
  permission?: 'read' | 'write'
  isOpened?: boolean
  is_opened?: number | boolean
  openedAt?: string
  opened_at?: string
  createdAt?: string
  created_at?: string
}

interface AccountUserOption {
  uid: string
  realName?: string | null
  email?: string | null
}

interface Props {
  documentId?: string
  loading?: boolean
  isProjectDoc?: boolean
  readonly?: boolean
  canManage?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  documentId: '',
  loading: false,
  isProjectDoc: false,
  readonly: false,
  canManage: true
})

// 只读文档或项目文档只能只读共享
const forceReadOnly = computed(() => !!props.readonly || !!props.isProjectDoc)

const emit = defineEmits<{
  'share': [data: { uid: string, permission: 'read' | 'write' }]
  'remove-share': [shareId: number]
  'update-permission': [data: { shareId: number, permission: 'read' | 'write' }]
}>()

// 使用 Account Store
const accountStore = useAccountStore()

// 共享用户列表
const sharedUsers = ref<ShareUser[]>([])
const loadingShares = ref(false)

// 用户搜索
const userSearchQuery = ref('')
const showDropdown = ref(false)
const inputRef = ref<HTMLInputElement>()

// 新增共享表单
const shareForm = ref({
  uid: '',
  permission: 'read' as 'read' | 'write'
})

// 从 store 中搜索用户
const searchResults = computed(() => {
  const query = userSearchQuery.value.trim().toLowerCase()
  if (!query) {
    return []
  }

  // 移除 @ 符号
  const searchTerm = query.replace(/^@/, '')

  // 如果搜索词为空，返回空
  if (!searchTerm) {
    return []
  }

  // 检测是否包含中文字符
  const hasChinese = /[\u4e00-\u9fa5]/.test(searchTerm)

  // 如果是英文/数字，至少需要2个字符；如果包含中文，1个字符即可
  if (!hasChinese && searchTerm.length < 2) {
    return []
  }

  // 从 store 的用户列表中过滤
  return accountStore.allUsers.filter((user) => {
    const matchUid = user.uid.toLowerCase().includes(searchTerm)
    const matchRealName = user.realName?.toLowerCase().includes(searchTerm)
    const matchEmail = user.email?.toLowerCase().includes(searchTerm)
    return matchUid || matchRealName || matchEmail
  }).slice(0, 10) // 最多显示10个结果
})

// 初始化时加载用户列表
onMounted(async () => {
  // 如果用户列表为空，加载一次
  if (accountStore.allUsers.length === 0) {
    await accountStore.fetchUsers()
  }

  document.addEventListener('click', handleClickOutside)

  // 只读文档或项目文档，强制设置为只读权限
  if (forceReadOnly.value) {
    shareForm.value.permission = 'read'
  }
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

// 监听只读状态变化
watch(forceReadOnly, (isReadOnly) => {
  if (isReadOnly) {
    shareForm.value.permission = 'read'
  }
})

// 加载共享列表
const loadShares = async () => {
  if (!props.documentId) return

  loadingShares.value = true
  try {
    const response = await $fetch(`/api/documents/${props.documentId}/shares`)
    if (response.code === 0) {
      const rows = Array.isArray(response.data) ? response.data as RawShareUser[] : []
      sharedUsers.value = rows.map(row => ({
        id: row.id,
        uid: row.uid || row.shared_to_uid || '',
        realName: row.realName || row.real_name || row.uid || row.shared_to_uid || '',
        email: '',
        permission: row.permission === 'write' ? 'write' : 'read',
        isOpened: Boolean(row.isOpened ?? row.is_opened),
        openedAt: row.openedAt || row.opened_at,
        createdAt: row.createdAt || row.created_at || ''
      }))
    }
  } catch (error) {
    console.error('Failed to load shares:', error)
  } finally {
    loadingShares.value = false
  }
}

// 处理输入变化
const handleInputChange = () => {
  showDropdown.value = searchResults.value.length > 0
}

// 选择用户
const selectUser = (user: AccountUserOption) => {
  userSearchQuery.value = user.uid
  shareForm.value.uid = user.uid
  showDropdown.value = false
}

// 添加共享
const handleShare = () => {
  let uid = userSearchQuery.value.trim()

  // 如果是 @uid 格式，提取用户名
  const atMatch = uid.match(/@(\w+)/)
  if (atMatch && atMatch[1]) {
    uid = atMatch[1]
  }

  if (!uid) {
    return
  }

  emit('share', {
    uid,
    permission: shareForm.value.permission
  })

  // 清空表单
  userSearchQuery.value = ''
  shareForm.value.uid = ''
  shareForm.value.permission = 'read'
  showDropdown.value = false
}

// 移除共享
const handleRemoveShare = (shareId: number) => {
  emit('remove-share', shareId)
}

// 更新权限
const handleUpdatePermission = (shareId: number, permission: 'read' | 'write') => {
  emit('update-permission', { shareId, permission })
}

// 格式化时间
const formatTime = (dateStr: string) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getInitial = (value?: string | null) => {
  const text = (value || '').trim()
  return text ? text.charAt(0).toUpperCase() : '?'
}

// 点击外部关闭下拉框
const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (!target.closest('.user-search-container')) {
    showDropdown.value = false
  }
}

// 监听 documentId 变化，自动加载共享列表
watch(() => props.documentId, (id) => {
  if (id) {
    loadShares()
  }
}, { immediate: true })

defineExpose({
  loadShares
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 添加共享表单（仅发起人可见） -->
    <div v-if="canManage" class="shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
      <div class="space-y-3">
        <div class="user-search-container relative">
          <label class="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block">
            用户名
          </label>
          <div class="relative">
            <input
              ref="inputRef"
              v-model="userSearchQuery"
              type="text"
              placeholder="输入用户名或 @uid"
              class="w-full px-3 py-2 pr-8 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              @input="handleInputChange"
              @focus="showDropdown = searchResults.length > 0"
              @keydown.enter="handleShare"
              @keydown.escape="showDropdown = false"
            >
            <div class="absolute right-2 top-1/2 -translate-y-1/2">
              <UIcon name="i-lucide-search" class="w-4 h-4 text-gray-400" />
            </div>
          </div>

          <!-- 用户搜索下拉框 -->
          <div
            v-if="showDropdown && searchResults.length > 0"
            class="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto"
          >
            <button
              v-for="user in searchResults"
              :key="user.uid"
              type="button"
              class="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
              @click="selectUser(user)"
            >
              <div
                class="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center text-xs font-medium text-primary shrink-0"
              >
                {{ getInitial(user.realName || user.uid) }}
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {{ user.realName }}
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
                  @{{ user.uid }}
                </div>
              </div>
            </button>
          </div>
        </div>

        <div>
          <label class="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 block">
            权限
          </label>
          <select
            v-model="shareForm.permission"
            :disabled="forceReadOnly"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="read">
              只读
            </option>
            <option value="write" :disabled="forceReadOnly">
              可编辑
            </option>
          </select>
          <p v-if="forceReadOnly" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {{ readonly ? '只读文档仅支持只读共享' : '项目文档仅支持只读共享' }}
          </p>
        </div>

        <UButton
          block
          size="sm"
          label="添加共享"
          icon="i-lucide-user-plus"
          :disabled="!userSearchQuery.trim()"
          @click="handleShare"
        />
      </div>
    </div>

    <!-- 共享用户列表 -->
    <div class="flex-1 overflow-y-auto min-h-0 p-4">
      <!-- Loading -->
      <div v-if="loadingShares" class="flex items-center justify-center py-10">
        <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-primary" />
      </div>

      <!-- 用户列表 -->
      <div v-else-if="sharedUsers.length > 0" class="space-y-3">
        <div
          v-for="user in sharedUsers"
          :key="user.id"
          class="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <!-- 头像 -->
          <div
            class="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center text-sm font-medium text-primary shrink-0"
          >
            {{ getInitial(user.realName || user.uid) }}
          </div>

          <!-- 用户信息 -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between mb-1">
              <div class="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                {{ user.realName || user.uid }}
              </div>
              <UButton
                v-if="canManage"
                class="text-gray-400 hover:text-red-500"
                icon="i-lucide-x"
                size="xs"
                variant="ghost"
                @click="handleRemoveShare(user.id)"
              >
                <span class="hidden xl:inline">取消共享</span>
              </UButton>
            </div>

            <!-- 权限选择 -->
            <div class="flex items-center gap-2 mt-1">
              <select
                v-if="canManage"
                :value="user.permission"
                :disabled="forceReadOnly"
                class="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                @change="(e) => handleUpdatePermission(user.id, (e.target as HTMLSelectElement).value as 'read' | 'write')"
              >
                <option value="read">
                  只读
                </option>
                <option value="write" :disabled="forceReadOnly">
                  可编辑
                </option>
              </select>
              <span
                v-else
                class="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              >
                {{ user.permission === 'write' ? '可编辑' : '只读' }}
              </span>

              <!-- 打开状态 -->
              <span
                v-if="user.isOpened"
                class="text-xs text-success"
                :title="`已打开于 ${formatTime(user.openedAt || '')}`"
              >
                <UIcon name="i-lucide-eye" class="w-3 h-3 inline-block" />
                已读
              </span>
              <span v-else class="text-xs text-muted">
                <UIcon name="i-lucide-eye-off" class="w-3 h-3 inline-block" />
                未读
              </span>
            </div>

            <!-- 分享时间 -->
            <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">
              分享于 {{ formatTime(user.createdAt) }}
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="flex flex-col items-center justify-center py-10 text-center">
        <UIcon name="i-lucide-users" class="w-12 h-12 text-gray-400 mb-3" />
        <p class="text-sm text-gray-500 dark:text-gray-400">
          尚未共享给任何人
        </p>
        <p v-if="canManage" class="text-xs text-gray-400 dark:text-gray-500 mt-1">
          在上方添加用户来共享此文档
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 自定义滚动条样式 */
.overflow-y-auto::-webkit-scrollbar {
  width: 6px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: transparent;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: rgba(156, 163, 175, 0.5);
  border-radius: 3px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: rgba(156, 163, 175, 0.7);
}
</style>
