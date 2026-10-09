<script setup lang="ts">
type OperationStatus = 'pending' | 'processing' | 'retry_wait' | 'partial_unknown' | 'succeeded' | 'failed_permanent' | 'dead_letter' | 'cancelled'
interface OperationRow {
  operationId: string
  targetApp: string
  operationCode: string
  sourceBizType: string
  sourceBizCode: string
  status: OperationStatus
  attemptCount: number
  maxAttempts: number
  version: number
  lastErrorCode?: string
  lastErrorClass?: string
  updatedAt: string
}
interface AttemptRow {
  operationId: string
  operationCode: string
  attemptNo: number
  status: string
  errorCode?: string
  errorClass?: string
  targetBizType?: string
  targetBizCode?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
}
interface ApiEnvelope<T> {
  code?: number
  data: T
  message?: string
}

const { sourceApp, title, canReplay, apiBase } = defineProps<{
  sourceApp: 'aims' | 'altoc' | 'assets' | 'finance' | 'people'
  title?: string
  canReplay?: boolean
  apiBase?: string
}>()
const operationApiBase = `/${String(apiBase || '/api/v1/integration-operations').trim().replace(/^\/+|\/+$/g, '')}`
const toast = useToast()
const route = useRoute()
const requestedStatus = String(route.query.status || '')
const requestedOperationId = String(route.query.operationId || '').trim()
const knownStatuses = new Set<OperationStatus>([
  'pending', 'processing', 'retry_wait', 'partial_unknown', 'succeeded', 'failed_permanent', 'dead_letter', 'cancelled'
])
const status = ref<string>(knownStatuses.has(requestedStatus as OperationStatus) ? requestedStatus : 'all')
const loading = ref(false)
const loadingMore = ref(false)
const items = ref<OperationRow[]>([])
const nextCursor = ref<string | null>(null)
const selected = ref<OperationRow | null>(null)
const attempts = ref<AttemptRow[]>([])
const detailOpen = ref(false)
const attemptLoading = ref(false)
const replayReason = ref('')
const replayLoading = ref(false)

const statusOptions = [
  { label: '全部状态', value: 'all' }, { label: '待处理', value: 'pending' }, { label: '处理中', value: 'processing' },
  { label: '等待重试', value: 'retry_wait' }, { label: '结果未知', value: 'partial_unknown' }, { label: '成功', value: 'succeeded' },
  { label: '永久失败', value: 'failed_permanent' }, { label: '死信', value: 'dead_letter' }, { label: '已取消', value: 'cancelled' }
]
const columns = [
  { accessorKey: 'operationCode', header: '操作' }, { accessorKey: 'targetApp', header: '目标' },
  { accessorKey: 'sourceBizCode', header: '业务对象' }, { accessorKey: 'status', header: '状态' },
  { accessorKey: 'attemptCount', header: '尝试' }, { accessorKey: 'updatedAt', header: '更新时间' }, { accessorKey: 'actions', header: '' }
]
const attemptColumns = [
  { accessorKey: 'attemptNo', header: '#' },
  { accessorKey: 'status', header: '结果' },
  { accessorKey: 'errorCode', header: '错误码' }, { accessorKey: 'durationMs', header: '耗时' }, { accessorKey: 'startedAt', header: '开始时间' }
]
const statusColors: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'error'> = {
  pending: 'neutral', processing: 'info', retry_wait: 'warning', partial_unknown: 'warning', succeeded: 'success',
  failed_permanent: 'error', dead_letter: 'error', cancelled: 'neutral'
}
const replayable = computed(() => canReplay && (selected.value?.status === 'failed_permanent' || selected.value?.status === 'dead_letter'))

function formatTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}
function errorMessage(error: unknown) {
  const candidate = error as { data?: { message?: string }, message?: string }
  return candidate?.data?.message || candidate?.message || '请求失败'
}

async function load(reset = true) {
  const pending = reset ? loading : loadingMore
  pending.value = true
  try {
    const response = await $fetch<ApiEnvelope<{ items: OperationRow[], nextCursor: string | null }>>(operationApiBase, {
      query: { status: status.value === 'all' ? undefined : status.value, limit: 50, cursor: reset ? undefined : nextCursor.value || undefined }
    })
    items.value = reset ? response.data.items : [...items.value, ...response.data.items]
    nextCursor.value = response.data.nextCursor
  } catch (error) {
    toast.add({ title: '加载跨应用操作失败', description: errorMessage(error), color: 'error' })
  } finally { pending.value = false }
}

async function openDetail(row: OperationRow) {
  selected.value = row
  detailOpen.value = true
  replayReason.value = ''
  attemptLoading.value = true
  try {
    const response = await $fetch<ApiEnvelope<{ items: AttemptRow[] }>>(`${operationApiBase}/${encodeURIComponent(row.operationId)}/attempts`)
    attempts.value = response.data.items
  } catch (error) {
    attempts.value = []
    toast.add({ title: '加载尝试时间线失败', description: errorMessage(error), color: 'error' })
  } finally { attemptLoading.value = false }
}

async function replay() {
  const reason = replayReason.value.trim()
  if (!selected.value || !reason || reason.length > 500) return
  replayLoading.value = true
  try {
    await $fetch(`${operationApiBase}/${encodeURIComponent(selected.value.operationId)}/replay`, {
      method: 'POST', body: { expectedVersion: selected.value.version, reason }
    })
    toast.add({ title: '已提交受控重放', color: 'success' })
    detailOpen.value = false
    await load()
  } catch (error) {
    toast.add({ title: '重放失败', description: errorMessage(error), color: 'error' })
  } finally { replayLoading.value = false }
}

watch(status, () => load())
onMounted(async () => {
  await load()
  if (!requestedOperationId) return
  const requested = items.value.find(item => item.operationId === requestedOperationId)
  if (requested) await openDetail(requested)
})
</script>

<template>
  <UDashboardPanel :id="`${sourceApp}-integration-operations`">
    <template #body>
      <div class="space-y-4 p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-lg font-semibold text-default">
              {{ title || '跨应用操作' }}
            </h1>
            <p class="mt-1 text-sm text-muted">
              只展示脱敏身份、状态和尝试记录；命令与响应正文不会返回到浏览器。
            </p>
          </div>
          <div class="flex items-center gap-2">
            <USelect
              v-model="status"
              :items="statusOptions"
              value-key="value"
              class="w-36"
            />
            <UButton
              icon="i-lucide-refresh-cw"
              label="刷新"
              variant="soft"
              :loading="loading"
              @click="load()"
            />
          </div>
        </div>

        <UCard :ui="{ body: 'p-0' }">
          <UTable :data="items" :columns="columns" :loading="loading">
            <template #operationCode-cell="{ row }">
              <div class="max-w-80">
                <p class="truncate font-mono text-xs">
                  {{ row.original.operationCode }}
                </p>
              </div>
            </template>
            <template #sourceBizCode-cell="{ row }">
              <span class="text-sm">{{ row.original.sourceBizType }}:{{ row.original.sourceBizCode }}</span>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="statusColors[row.original.status] || 'neutral'" variant="subtle">
                {{ row.original.status }}
              </UBadge>
            </template>
            <template #attemptCount-cell="{ row }">
              <span class="tabular-nums">{{ row.original.attemptCount }}/{{ row.original.maxAttempts }}</span>
            </template>
            <template #updatedAt-cell="{ row }">
              <span class="whitespace-nowrap text-sm text-muted">{{ formatTime(row.original.updatedAt) }}</span>
            </template>
            <template #actions-cell="{ row }">
              <UButton
                label="详情"
                size="xs"
                variant="ghost"
                @click="openDetail(row.original)"
              />
            </template>
            <template #empty>
              <div class="py-10 text-center text-sm text-muted">
                暂无跨应用操作
              </div>
            </template>
          </UTable>
        </UCard>
        <div v-if="nextCursor" class="flex justify-center">
          <UButton
            label="加载更多"
            variant="soft"
            :loading="loadingMore"
            @click="load(false)"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="detailOpen" title="跨应用操作详情" :ui="{ content: 'sm:max-w-6xl' }">
    <template #body>
      <div v-if="selected" class="space-y-5">
        <div class="grid gap-3 text-sm md:grid-cols-3">
          <div>
            <p class="text-muted">
              Operation ID
            </p><p class="break-all font-mono text-xs">
              {{ selected.operationId }}
            </p>
          </div>
          <div>
            <p class="text-muted">
              目标应用
            </p><p>{{ selected.targetApp }}</p>
          </div>
          <div>
            <p class="text-muted">
              当前状态
            </p><UBadge :color="statusColors[selected.status] || 'neutral'" variant="subtle">
              {{ selected.status }}
            </UBadge>
          </div>
        </div>
        <UAlert
          v-if="selected.lastErrorCode"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="`${selected.lastErrorClass || 'error'} · ${selected.lastErrorCode}`"
          description="查看稳定错误分类后，可按审计流程执行受控重放。"
        />
        <div>
          <h2 class="mb-2 text-sm font-semibold">
            尝试时间线
          </h2>
          <UTable :data="attempts" :columns="attemptColumns" :loading="attemptLoading">
            <template #status-cell="{ row }">
              <UBadge :color="statusColors[row.original.status] || 'neutral'" variant="subtle">
                {{ row.original.status }}
              </UBadge>
            </template>
            <template #durationMs-cell="{ row }">
              {{ row.original.durationMs == null ? '-' : `${row.original.durationMs} ms` }}
            </template>
            <template #startedAt-cell="{ row }">
              <span class="whitespace-nowrap text-sm">{{ formatTime(row.original.startedAt) }}</span>
            </template>
          </UTable>
        </div>
        <UFormField v-if="replayable" label="重放原因" description="将使用原冻结命令、租户和目标身份；不可修改 payload。">
          <UTextarea
            v-model="replayReason"
            :rows="3"
            :maxlength="500"
            class="w-full"
            placeholder="填写可审计的人工重放原因"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton label="关闭" variant="ghost" @click="detailOpen = false" /><UButton
          v-if="replayable"
          label="受控重放"
          color="warning"
          :disabled="!replayReason.trim() || replayReason.trim().length > 500"
          :loading="replayLoading"
          @click="replay"
        />
      </div>
    </template>
  </UModal>
</template>
