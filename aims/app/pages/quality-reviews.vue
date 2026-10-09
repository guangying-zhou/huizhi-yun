<script setup lang="ts">
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目文档质量检查'
})

type ChecklistItem = {
  code?: string
  label?: string
  title?: string
  required?: boolean
}

type ChecklistVersion = {
  id: number
  checklistCode: string
  versionNo: number
  title: string
  items: ChecklistItem[]
  itemsSha256: string
  status: 'draft' | 'published'
}

type QueueItem = {
  submissionId: number
  submissionNo: string
  documentSource: 'codocs' | 'repo'
  documentUuid: string | null
  documentVersionId: number | null
  documentVersionNum: number | null
  repoProjectCode: string | null
  repoFilePath: string | null
  repoCommitId: string | null
  contentSha256: string
  reviewRoute: 'qa' | 'pm_completeness_then_director_quality'
  reviewRole: 'qa' | 'project_director'
  deliverableId: number
  deliverableName: string
  required: boolean
  projectId: number
  projectCode: string
  projectName: string
  checklistVersionId: number
  checklistTitle: string
  checklistVersionNo: number
  checklistItems: ChecklistItem[]
  lastReturnComment?: string | null
  previousDocumentVersionNum?: number | null
  previousContentSha256?: string | null
  isRecheck?: boolean
  submittedAt: string
}

type ReviewContent = {
  documentSource?: 'codocs' | 'repo'
  documentUuid: string | null
  versionId: number | null
  versionNum: number | null
  repoProjectCode?: string | null
  repoFilePath?: string | null
  repoCommitId?: string | null
  title: string
  contentSize: number
  contentSha256: string
  content: string
}

const toast = useToast()
const { hasPermission } = usePermissions()
const { setRefresh, clearRefresh } = usePageActions()
const canConfigure = computed(() => hasPermission('quality_reviews', 'configure'))
const queue = ref<QueueItem[]>([])
const checklists = ref<ChecklistVersion[]>([])
const selectedId = ref<number | null>(null)
const content = ref<ReviewContent | null>(null)
const loading = ref(false)
const contentLoading = ref(false)
const reviewing = ref(false)
const reviewComment = ref('')
const checklistResults = ref<Record<string, boolean>>({})

const selected = computed(() => queue.value.find(item => item.submissionId === selectedId.value) || null)

function requestErrorMessage(error: unknown) {
  const candidate = error as { data?: { message?: string }, message?: string }
  return candidate.data?.message || candidate.message
}

function itemKey(item: ChecklistItem, index: number) {
  return String(item.code || `item-${index + 1}`)
}

function itemLabel(item: ChecklistItem, index: number) {
  return String(item.label || item.title || `检查项 ${index + 1}`)
}

function snapshotLabel(item: QueueItem) {
  return item.documentSource === 'repo'
    ? `仓库 @ ${item.repoCommitId?.slice(0, 8) || '未知提交'}`
    : `Codocs v${item.documentVersionNum}`
}

function resetReviewForm(item: QueueItem | null) {
  reviewComment.value = ''
  checklistResults.value = {}
  for (const [index, checklistItem] of (item?.checklistItems || []).entries()) {
    checklistResults.value[itemKey(checklistItem, index)] = false
  }
}

async function loadQueue() {
  loading.value = true
  try {
    const response = await $fetch<{ code: number, data: { items?: QueueItem[] } }>('/api/v1/quality-reviews/queue')
    queue.value = response.data?.items || []
    if (!queue.value.some(item => item.submissionId === selectedId.value)) {
      selectedId.value = queue.value[0]?.submissionId || null
    }
  } catch (error: unknown) {
    queue.value = []
    toast.add({ title: '无法加载质量检查队列', description: requestErrorMessage(error), color: 'error' })
  } finally {
    loading.value = false
  }
}

async function loadChecklists() {
  if (!canConfigure.value) return
  try {
    const response = await $fetch<{ code: number, data: { items?: ChecklistVersion[] } }>('/api/v1/qa-checklists')
    checklists.value = response.data?.items || []
  } catch {
    checklists.value = []
  }
}

async function loadContent(item: QueueItem | null) {
  content.value = null
  resetReviewForm(item)
  if (!item) return
  contentLoading.value = true
  try {
    const response = await $fetch<{ code: number, data: ReviewContent }>(`/api/v1/quality-reviews/${item.submissionId}/content`)
    content.value = response.data
  } catch (error: unknown) {
    toast.add({ title: '无法读取确定文档版本', description: requestErrorMessage(error), color: 'error' })
  } finally {
    contentLoading.value = false
  }
}

watch(selected, item => loadContent(item), { immediate: true })

const allRequiredChecked = computed(() => {
  const items = selected.value?.checklistItems || []
  return items.every((item, index) => item.required === false || checklistResults.value[itemKey(item, index)])
})

async function submitReview(action: 'pass' | 'return') {
  const item = selected.value
  if (!item) return
  if (action === 'pass' && !allRequiredChecked.value) {
    toast.add({ title: '请先完成全部必检项', color: 'warning' })
    return
  }
  if (action === 'return' && !reviewComment.value.trim()) {
    toast.add({ title: '退回时必须说明问题', color: 'warning' })
    return
  }
  reviewing.value = true
  try {
    await $fetch(`/api/v1/deliverable-submissions/${item.submissionId}:review-quality`, {
      method: 'POST',
      body: {
        action,
        comment: reviewComment.value.trim(),
        checklistResults: item.checklistItems.map((checklistItem, index) => ({
          code: itemKey(checklistItem, index),
          label: itemLabel(checklistItem, index),
          passed: Boolean(checklistResults.value[itemKey(checklistItem, index)])
        }))
      }
    })
    toast.add({ title: action === 'pass' ? '质量检查已通过' : '已退回修改', color: action === 'pass' ? 'success' : 'warning' })
    await loadQueue()
  } catch (error: unknown) {
    toast.add({ title: '处理失败', description: requestErrorMessage(error), color: 'error' })
  } finally {
    reviewing.value = false
  }
}

const checklistModalOpen = ref(false)
const checklistTitle = ref('项目文档标准检查清单')
const checklistLines = ref('结构完整且章节齐全\n交付范围与验收标准一致\n关键结论有数据或记录支撑\n文档内容无明显错误和遗留占位')
const savingChecklist = ref(false)

async function createAndPublishChecklist() {
  const labels = checklistLines.value.split('\n').map(item => item.trim()).filter(Boolean)
  if (!checklistTitle.value.trim() || labels.length === 0) return
  savingChecklist.value = true
  try {
    const created = await $fetch<{ code: number, data: { id: number } }>('/api/v1/qa-checklists', {
      method: 'POST',
      body: {
        checklistCode: 'PROJECT_DOCUMENT_STANDARD',
        title: checklistTitle.value.trim(),
        items: labels.map((label, index) => ({ code: `DOC-${index + 1}`, label, required: true }))
      }
    })
    await $fetch(`/api/v1/qa-checklists/${created.data.id}:publish`, { method: 'POST' })
    checklistModalOpen.value = false
    toast.add({ title: '检查清单新版本已发布', color: 'success' })
    await loadChecklists()
  } catch (error: unknown) {
    toast.add({ title: '发布失败', description: requestErrorMessage(error), color: 'error' })
  } finally {
    savingChecklist.value = false
  }
}

async function refreshPage() {
  await Promise.all([loadQueue(), loadChecklists()])
}

onMounted(async () => {
  setRefresh(refreshPage)
  await refreshPage()
})

onBeforeUnmount(clearRefresh)
</script>

<template>
  <UDashboardPanel id="quality-reviews" :ui="{ body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex items-center justify-between border-b border-default px-4 py-3">
        <div>
          <h1 class="font-semibold text-highlighted">
            确定版本质量检查
          </h1>
          <p class="text-xs text-muted">
            每项结论永久绑定文档版本、内容哈希和检查清单版本。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UBadge color="neutral" variant="subtle">
            待处理 {{ queue.length }}
          </UBadge>
          <UButton
            v-if="canConfigure"
            icon="i-lucide-list-checks"
            label="发布清单新版本"
            variant="soft"
            @click="checklistModalOpen = true"
          />
        </div>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)_22rem]">
        <aside class="min-h-0 overflow-y-auto border-r border-default p-3">
          <div v-if="loading" class="py-10 text-center text-sm text-muted">
            正在加载…
          </div>
          <div v-else-if="queue.length === 0" class="rounded-lg border border-dashed border-default p-6 text-center text-sm text-muted">
            暂无待处理文档
          </div>
          <button
            v-for="item in queue"
            :key="item.submissionId"
            type="button"
            class="mb-2 w-full rounded-lg border p-3 text-left transition-colors"
            :class="selectedId === item.submissionId ? 'border-primary bg-primary/5' : 'border-default hover:bg-elevated'"
            @click="selectedId = item.submissionId"
          >
            <div class="flex items-start justify-between gap-2">
              <span class="text-xs font-medium text-primary">{{ item.projectCode }}</span>
              <UBadge :color="item.reviewRole === 'project_director' ? 'warning' : 'info'" variant="subtle" size="xs">
                {{ item.reviewRole === 'project_director' ? '冲突转交' : item.isRecheck ? '复检' : 'QA' }}
              </UBadge>
            </div>
            <p class="mt-1 line-clamp-2 text-sm font-medium text-highlighted">
              {{ item.deliverableName }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ snapshotLabel(item) }} · 清单 v{{ item.checklistVersionNo }}
            </p>
          </button>
        </aside>

        <main class="min-h-0 overflow-y-auto p-4">
          <div v-if="!selected" class="flex h-full items-center justify-center text-sm text-muted">
            请选择待检查文档
          </div>
          <template v-else>
            <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="text-lg font-semibold text-highlighted">
                  {{ content?.title || selected.deliverableName }}
                </h2>
                <p class="text-xs text-muted">
                  {{ selected.projectName }} · {{ snapshotLabel(selected) }}
                </p>
              </div>
              <UBadge color="neutral" variant="outline" class="font-mono">
                SHA-256 {{ selected.contentSha256.slice(0, 12) }}…
              </UBadge>
            </div>
            <UAlert
              v-if="selected.lastReturnComment"
              color="warning"
              variant="subtle"
              icon="i-lucide-message-square-warning"
              title="上次退回问题"
              :description="selected.lastReturnComment"
              class="mb-4"
            />
            <UAlert
              v-if="selected.isRecheck"
              color="info"
              variant="subtle"
              icon="i-lucide-git-compare"
              title="复检版本变化"
              :description="`上次退回${selected.previousDocumentVersionNum ? `版本 v${selected.previousDocumentVersionNum}` : '快照'}，本次为 ${snapshotLabel(selected)}；内容哈希${selected.previousContentSha256 === selected.contentSha256 ? '未变化' : '已变化'}。`"
              class="mb-4"
            />
            <div v-if="contentLoading" class="py-16 text-center text-sm text-muted">
              正在校验并读取确定版本…
            </div>
            <pre v-else-if="content" class="min-h-96 whitespace-pre-wrap rounded-lg border border-default bg-elevated/40 p-5 font-sans text-sm leading-7 text-highlighted">{{ content.content }}</pre>
          </template>
        </main>

        <aside class="min-h-0 overflow-y-auto border-l border-default p-4">
          <template v-if="selected">
            <h3 class="font-semibold text-highlighted">
              {{ selected.checklistTitle }}
            </h3>
            <p class="mb-4 text-xs text-muted">
              版本 {{ selected.checklistVersionNo }}，提交后不可变
            </p>
            <div class="space-y-3">
              <UCheckbox
                v-for="(item, index) in selected.checklistItems"
                :key="itemKey(item, index)"
                v-model="checklistResults[itemKey(item, index)]"
                :label="itemLabel(item, index)"
              />
            </div>
            <UFormField label="审查意见" class="mt-5">
              <UTextarea
                v-model="reviewComment"
                :rows="5"
                class="w-full"
                placeholder="通过可选填；退回必须说明问题和修改要求"
              />
            </UFormField>
            <div class="mt-4 grid grid-cols-2 gap-2">
              <UButton
                label="退回修改"
                color="error"
                variant="soft"
                :loading="reviewing"
                @click="submitReview('return')"
              />
              <UButton
                label="检查通过"
                color="success"
                :disabled="!allRequiredChecked"
                :loading="reviewing"
                @click="submitReview('pass')"
              />
            </div>
          </template>
        </aside>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="checklistModalOpen" title="发布检查清单新版本">
    <template #body>
      <div class="space-y-4">
        <UAlert
          color="info"
          variant="subtle"
          title="发布后不可修改"
          description="后续调整会生成新版本，历史提交继续引用原版本。"
        />
        <UFormField label="清单标题">
          <UInput v-model="checklistTitle" class="w-full" />
        </UFormField>
        <UFormField label="检查项" description="每行一项，当前均作为必检项">
          <UTextarea v-model="checklistLines" :rows="8" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        label="取消"
        @click="checklistModalOpen = false"
      />
      <UButton label="创建并发布" :loading="savingChecklist" @click="createAndPublishChecklist" />
    </template>
  </UModal>
</template>
