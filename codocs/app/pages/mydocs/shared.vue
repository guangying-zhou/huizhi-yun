<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

usePageTitle('协同文档中心')

const { user } = useAuth()
const router = useRouter()
const accountStore = useAccountStore()
const { hasRole, loadPermissions } = usePermissions()
const { setPayload: setDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()
const { panelWidth, panelCollapsed, onResizeStart, showPanel } = useResizablePanel(288)

interface CollabDocItem {
  uuid: string
  title: string
  docType: string
  ownerUid: string
  deptCode: string | null
  readonly: boolean
  docStatus: number
  published: boolean
  ossPath: string
  updatedAt: string
  relationTypes: string[]
  relationLabels: string[]
  reviewId: number | null
  reviewStatus: string | null
  reviewType: string | null
  reviewSubType: string | null
  reviewExecutionStatus: string | null
  isTodo: boolean
  locationLabel: string
}

interface CollabDocsResponse {
  code: number
  data?: {
    items: CollabDocItem[]
    total: number
  }
}

interface CollabDocsState {
  items: CollabDocItem[]
  total: number
  queryKey: string
}

interface DocumentPreviewResponse {
  success: boolean
  data?: {
    content?: string
    ai_abstract?: string
    readonly_flag?: number
  }
}

const category = ref<'shared' | 'original' | 'outside'>('shared')
const scope = ref('all')
const sharedTab = ref<'received' | 'sent'>('received')
const searchKeyword = ref('')
const selectedDeptCode = ref('')
const selectedOwnerUid = ref('')
const selectedDocUuid = ref('')

const previewLoading = ref(false)
const previewContent = ref('')
const previewAbstract = ref('')
const previewReadonly = ref(true)
const previewError = ref('')
const showSealModal = ref(false)
const showSendModal = ref(false)
const showReceiveModal = ref(false)

const categoryItems = [
  { label: '共享文档', value: 'shared' as const, icon: 'i-lucide-share-2' },
  { label: '移交文档', value: 'original' as const, icon: 'i-lucide-pen-tool' },
  { label: '对外发文', value: 'outside' as const, icon: 'i-lucide-send' }
]

const scopeOptions = computed(() => {
  if (category.value === 'outside') {
    return [
      { label: '全部', value: 'all' },
      { label: '待我处理', value: 'todo' },
      { label: '我发起的', value: 'initiated' },
      { label: '我参与的', value: 'participated' },
      { label: '已完成', value: 'done' }
    ]
  }

  if (category.value === 'shared') {
    return [
      { label: '全部', value: 'all' }
    ]
  }

  return [
    { label: '全部', value: 'all' }
  ]
})

const ensureScope = () => {
  if (!scopeOptions.value.find(item => item.value === scope.value)) {
    scope.value = 'all'
  }
}

watch(category, () => {
  ensureScope()
  selectedDeptCode.value = ''
  selectedOwnerUid.value = ''
})

const currentQueryKey = computed(() => JSON.stringify({
  category: category.value,
  scope: scope.value,
  keyword: searchKeyword.value || '',
  deptCode: selectedDeptCode.value || '',
  ownerUid: selectedOwnerUid.value || ''
}))

const fetchCollabDocs = async () => {
  const res = await $fetch<CollabDocsResponse>('/api/collab-docs', {
    params: {
      category: category.value,
      scope: scope.value,
      keyword: searchKeyword.value || undefined,
      dept_code: selectedDeptCode.value || undefined,
      owner_uid: selectedOwnerUid.value || undefined
    }
  })

  return {
    items: res.data?.items || [],
    total: res.data?.total || 0,
    queryKey: currentQueryKey.value
  } satisfies CollabDocsState
}

const { data, pending, refresh } = await useAsyncData(
  'collab-docs',
  fetchCollabDocs,
  {
    watch: [category, scope, searchKeyword, selectedDeptCode, selectedOwnerUid],
    getCachedData: () => undefined
  }
)

const items = computed(() => {
  if (data.value?.queryKey !== currentQueryKey.value) return []
  return data.value?.items || []
})
const sharedTabs = computed(() => [
  {
    label: '共享给我',
    icon: 'i-lucide-inbox',
    value: 'received' as const
  },
  {
    label: '我共享的',
    icon: 'i-lucide-share-2',
    value: 'sent' as const
  }
])

const visibleItems = computed(() => {
  if (category.value !== 'shared') return items.value
  if (sharedTab.value === 'received') {
    return items.value.filter(item => item.relationTypes.includes('shared_to_me'))
  }
  return items.value.filter(item => item.relationTypes.includes('shared_by_me'))
})

const selectedDoc = computed(() => visibleItems.value.find(item => item.uuid === selectedDocUuid.value) || null)

const ownerOptions = computed(() => {
  if (category.value === 'original') {
    return [
      { label: '原创人', value: '' }
    ]
  }

  const owners = [...new Set(visibleItems.value.map(item => item.ownerUid).filter(Boolean))]
  return [
    { label: '发起人', value: '' },
    ...owners.map(ownerUid => ({
      label: getUserDisplayName(ownerUid),
      value: ownerUid
    }))
  ]
})

const deptOptions = computed(() => {
  const deptCodes = [...new Set(visibleItems.value.map(item => item.deptCode).filter((value): value is string => Boolean(value)))]
  return [
    { label: '部门', value: '' },
    ...deptCodes.map(deptCode => ({
      label: getDepartmentDisplayName(deptCode),
      value: deptCode
    }))
  ]
})

const getUserDisplayName = (uid?: string | null) => {
  const normalized = String(uid || '').trim()
  if (!normalized) return ''
  return accountStore.getUserByUid(normalized)?.realName || normalized
}

const getDepartmentDisplayName = (deptCode?: string | null) => {
  const normalized = String(deptCode || '').trim()
  if (!normalized) return '-'
  return accountStore.getDepartmentById(normalized)?.name || normalized
}

const getPrimaryUserLabel = (item: CollabDocItem) => {
  if (category.value === 'original') return '我'
  return getUserDisplayName(item.ownerUid)
}

const loadRelatedMetadata = async () => {
  const userIds = [...new Set(visibleItems.value.map(item => item.ownerUid).filter(Boolean))]
  try {
    await loadPermissions()
    if (userIds.length) {
      await accountStore.fetchUsersBatch(userIds)
    }
    await accountStore.fetchDepartments()
  } catch (error) {
    console.error('Failed to load collaboration metadata:', error)
  }
}

const formatDateTime = (dateStr?: string) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getAccessLabel = (item: CollabDocItem) => {
  if (item.published) return '只读'
  return item.readonly ? '只读共享' : '可编辑'
}

const getExecutionStatusLabel = (status?: string | null) => {
  const labels: Record<string, string> = {
    pending_seal: '待盖章',
    pending_send: '待发送',
    pending_receive: '待接收',
    sent: '已发送',
    received: '已接收'
  }
  return status ? (labels[status] || status) : '-'
}

const canConfirmSeal = computed(() => {
  if (!selectedDoc.value) return false
  return selectedDoc.value.reviewType === '对外发文'
    && selectedDoc.value.reviewExecutionStatus === 'pending_seal'
    && selectedDoc.value.reviewId !== null
    && hasRole('seal_admin')
})

const canConfirmSend = computed(() => {
  if (!selectedDoc.value) return false
  const currentUid = String(user.value || '').trim()
  return selectedDoc.value.reviewType === '对外发文'
    && selectedDoc.value.reviewExecutionStatus === 'pending_send'
    && selectedDoc.value.reviewId !== null
    && selectedDoc.value.ownerUid === currentUid
})

const canConfirmReceive = computed(() => {
  if (!selectedDoc.value) return false
  return selectedDoc.value.reviewType === '对外发文'
    && selectedDoc.value.reviewExecutionStatus === 'pending_receive'
    && selectedDoc.value.reviewId !== null
    && selectedDoc.value.relationTypes.includes('outside_sender')
})

const loadPreview = async (uuid: string) => {
  previewLoading.value = true
  previewContent.value = ''
  previewAbstract.value = ''
  previewError.value = ''
  previewReadonly.value = true

  try {
    const response = await $fetch<DocumentPreviewResponse>(`/api/documents/${uuid}`)
    if (response.success) {
      previewContent.value = response.data?.content || ''
      previewAbstract.value = response.data?.ai_abstract || ''
      previewReadonly.value = response.data?.readonly_flag === 1
    }
  } catch (error: unknown) {
    const err = error as { data?: { message?: string }, message?: string }
    previewError.value = err.data?.message || err.message || '预览加载失败'
  } finally {
    previewLoading.value = false
  }
}

const selectDocument = async (item: CollabDocItem | null) => {
  selectedDocUuid.value = item?.uuid || ''
  if (!item?.uuid) {
    previewContent.value = ''
    previewAbstract.value = ''
    previewError.value = ''
    previewReadonly.value = true
    return
  }

  await loadPreview(item.uuid)
}

const clearSelection = () => {
  selectedDocUuid.value = ''
  previewContent.value = ''
  previewAbstract.value = ''
  previewError.value = ''
  previewReadonly.value = true
}

const bootstrapSelection = async () => {
  await loadRelatedMetadata()
  clearSelection()
}

watch([items, sharedTab], async () => {
  if (selectedDocUuid.value && visibleItems.value.some(item => item.uuid === selectedDocUuid.value)) {
    return
  }
  await bootstrapSelection()
}, { immediate: true })

const openDocument = () => {
  if (!selectedDoc.value) return

  if (previewContent.value) {
    setDocumentPreviewBootstrap(selectedDoc.value.uuid, {
      content: previewContent.value,
      aiAbstract: previewAbstract.value
    })
  }

  router.push(`/documents/${selectedDoc.value.uuid}?fromCollab=1`)
}

const handleSealSuccess = async () => {
  await refresh()
  const current = visibleItems.value.find(item => item.uuid === selectedDocUuid.value) || null
  await selectDocument(current)
}

const handleSendSuccess = async () => {
  await refresh()
  const current = visibleItems.value.find(item => item.uuid === selectedDocUuid.value) || null
  await selectDocument(current)
}

const handleReceiveSuccess = async () => {
  await refresh()
  const current = visibleItems.value.find(item => item.uuid === selectedDocUuid.value) || null
  await selectDocument(current)
}
</script>

<template>
  <UDashboardPanel grow>
    <div class="flex items-center justify-between gap-2 px-4 py-2 border-b border-default flex-wrap">
      <UTabs
        v-model="category"
        :items="categoryItems"
        :content="false"
        variant="pill"
        color="secondary"
        size="md"
      />
      <div class="flex items-center gap-2">
        <USelectMenu
          v-if="category !== 'shared'"
          v-model="scope"
          :items="scopeOptions"
          value-key="value"
          label-key="label"
          class="w-30"
          :search-input="false"
        />
        <USelectMenu
          v-if="category !== 'original'"
          v-model="selectedOwnerUid"
          :items="ownerOptions"
          value-key="value"
          label-key="label"
          class="w-36"
          :search-input="false"
        />
        <USelectMenu
          v-model="selectedDeptCode"
          :items="deptOptions"
          value-key="value"
          label-key="label"
          class="w-28"
          :search-input="false"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          :loading="pending"
          @click="refresh()"
        />
        <UButton
          v-if="panelCollapsed"
          icon="i-lucide-folder-tree"
          variant="ghost"
          size="sm"
          @click="showPanel"
        >
          列表
        </UButton>
      </div>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <aside
        v-if="!panelCollapsed"
        class="relative border-r border-default bg-default flex flex-col overflow-hidden shrink-0"
        :style="{ width: panelWidth + 'px' }"
      >
        <div
          v-if="category === 'shared'"
          class="px-3 pt-3"
        >
          <button
            v-for="tab in sharedTabs"
            :key="tab.value"
            class="inline-flex items-center gap-1.5 px-1 py-2 mr-5 text-sm border-b-2 transition-colors"
            :class="sharedTab === tab.value
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted hover:text-default'"
            @click="sharedTab = tab.value"
          >
            <UIcon :name="tab.icon" class="size-4" />
            {{ tab.label }}
          </button>
        </div>

        <div class="px-3 py-2 text-sm text-muted flex justify-center">
          共 {{ visibleItems.length }} 条
        </div>

        <div class="flex-1 overflow-y-auto p-2 space-y-2">
          <div v-if="pending && visibleItems.length === 0" class="flex justify-center py-6">
            <UIcon name="i-lucide-loader-2" class="w-5 h-5 animate-spin text-muted" />
          </div>

          <div
            v-else-if="visibleItems.length === 0"
            class="rounded-lg border border-dashed border-default p-5 text-sm text-muted text-center"
          >
            暂无匹配文档
          </div>

          <button
            v-for="item in visibleItems"
            :key="item.uuid"
            class="w-full text-left rounded-xl border p-3 transition-all"
            :class="selectedDocUuid === item.uuid
              ? 'border-primary bg-primary-50/60 dark:bg-primary-900/20'
              : 'border-default bg-default hover:border-primary/40 hover:bg-elevated'"
            @click="selectDocument(item)"
          >
            <div class="flex items-start gap-2">
              <div class="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <UIcon name="i-lucide-file-text" class="w-4 h-4" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold truncate">
                  {{ item.title || '无标题文档' }}
                </div>
                <div class="mt-1 text-xs text-muted truncate">
                  <span>{{ getPrimaryUserLabel(item) }}</span>
                  <span>· {{ item.locationLabel }}</span>
                  <span>· {{ formatDateTime(item.updatedAt) }}</span>
                </div>
              </div>
            </div>
          </button>
        </div>
      </aside>

      <div
        v-if="!panelCollapsed"
        class="w-1.5 shrink-0 cursor-col-resize bg-default hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 -ml-px"
        @mousedown.prevent="onResizeStart"
      />

      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <div
          v-if="selectedDoc"
          class="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-3 border-b border-default bg-default gap-3 sm:gap-0"
        >
          <div class="flex items-center gap-1.5 text-sm font-medium overflow-hidden">
            <UIcon name="i-lucide-file-text" class="w-4 h-4 text-muted shrink-0" />
            <span class="text-default truncate" :title="selectedDoc.title">{{ selectedDoc.title }}</span>
            <span class="text-muted shrink-0">· {{ selectedDoc.locationLabel }}</span>
            <span class="text-muted shrink-0">· {{ formatDateTime(selectedDoc.updatedAt) }}</span>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <UButton
              v-if="canConfirmSeal"
              icon="i-lucide-stamp"
              size="sm"
              color="warning"
              variant="soft"
              @click="showSealModal = true"
            >
              确认盖章
            </UButton>
            <UButton
              v-if="canConfirmSend"
              icon="i-lucide-send"
              size="sm"
              color="primary"
              variant="soft"
              @click="showSendModal = true"
            >
              确认发送
            </UButton>
            <UButton
              v-if="canConfirmReceive"
              icon="i-lucide-mail-check"
              size="sm"
              color="success"
              variant="soft"
              @click="showReceiveModal = true"
            >
              确认接收
            </UButton>
            <UButton
              icon="i-lucide-arrow-up-right"
              size="sm"
              color="primary"
              @click="openDocument"
            >
              {{ previewReadonly ? '查看原文' : '打开文档' }}
            </UButton>
          </div>
        </div>

        <div class="flex-1 overflow-auto p-4">
          <div v-if="!selectedDoc" class="h-full flex items-center justify-center">
            <div class="text-center text-muted">
              <UIcon name="i-lucide-file-search" class="w-14 h-14 mx-auto mb-3" />
              <p>请从左侧选择文档进行预览</p>
            </div>
          </div>

          <div v-else class="h-full flex flex-col gap-3">
            <div class="rounded-xl border border-default bg-default px-4 py-3 shrink-0">
              <div class="flex items-center gap-4 overflow-x-auto text-sm whitespace-nowrap">
                <div class="shrink-0">
                  <span class="text-muted">{{ category === 'original' ? '原创人' : '发起人' }}：</span>
                  <span class="font-medium">{{ category === 'original' ? '我' : getUserDisplayName(selectedDoc.ownerUid) }}</span>
                </div>
                <div class="shrink-0 text-muted">
                  |
                </div>
                <div class="shrink-0">
                  <span class="text-muted">所属部门：</span>
                  <span class="font-medium">{{ getDepartmentDisplayName(selectedDoc.deptCode) }}</span>
                </div>
                <div class="shrink-0 text-muted">
                  |
                </div>
                <div class="shrink-0">
                  <span class="text-muted">协同关系：</span>
                  <span class="font-medium">{{ selectedDoc.relationLabels.join('、') }}</span>
                </div>
                <div class="shrink-0 text-muted">
                  |
                </div>
                <div class="shrink-0">
                  <span class="text-muted">访问权限：</span>
                  <span class="font-medium">{{ getAccessLabel(selectedDoc) }}</span>
                </div>
                <div class="shrink-0 text-muted">
                  |
                </div>
                <div class="shrink-0">
                  <span class="text-muted">发布状态：</span>
                  <span class="font-medium">{{ selectedDoc.published ? '已发布（只读）' : '未发布' }}</span>
                </div>
                <template v-if="selectedDoc.reviewExecutionStatus">
                  <div class="shrink-0 text-muted">
                    |
                  </div>
                  <div class="shrink-0">
                    <span class="text-muted">执行状态：</span>
                    <span class="font-medium">{{ getExecutionStatusLabel(selectedDoc.reviewExecutionStatus) }}</span>
                  </div>
                </template>
              </div>
            </div>

            <div class="flex-1 min-h-0 w-full max-w-4xl mx-auto rounded-xl border border-default bg-default overflow-hidden">
              <div v-if="previewLoading" class="h-full min-h-60 flex items-center justify-center">
                <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-primary" />
              </div>
              <div v-else-if="previewError" class="h-full flex items-center justify-center text-error text-sm">
                {{ previewError }}
              </div>
              <div v-else-if="previewContent" class="h-full overflow-auto">
                <div
                  v-if="previewAbstract"
                  class="border-b border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 px-4 py-2.5"
                >
                  <div class="flex items-start gap-2">
                    <UIcon name="i-lucide-sparkles" class="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <span class="text-xs font-medium text-primary">AI 摘要</span>
                      <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mt-0.5">
                        {{ previewAbstract }}
                      </p>
                    </div>
                  </div>
                </div>
                <EditorDocLazyPreview :content="previewContent" />
              </div>
              <div v-else class="h-full flex items-center justify-center text-muted text-sm">
                无法预览此文件
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>

    <ReviewSealConfirmModal
      v-if="selectedDoc?.reviewId"
      v-model:open="showSealModal"
      :review-id="selectedDoc.reviewId"
      :doc-title="selectedDoc.title"
      @success="handleSealSuccess"
    />
    <ReviewSendConfirmModal
      v-if="selectedDoc?.reviewId"
      v-model:open="showSendModal"
      :review-id="selectedDoc.reviewId"
      :doc-title="selectedDoc.title"
      @success="handleSendSuccess"
    />
    <ReviewReceiveConfirmModal
      v-if="selectedDoc?.reviewId"
      v-model:open="showReceiveModal"
      :review-id="selectedDoc.reviewId"
      :doc-title="selectedDoc.title"
      @success="handleReceiveSuccess"
    />
  </UDashboardPanel>
</template>
