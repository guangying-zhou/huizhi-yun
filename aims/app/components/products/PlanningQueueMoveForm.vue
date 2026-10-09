<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'
import type { ProductPlanningDetail } from '~/types/productPlanning'
import { validProductQueueReceipt } from '~/utils/productQueueReceipt'

interface Anchor { biz_id: string, product_code: string, title: string, scope_summary: string }
const props = defineProps<{ productCode: string, cycle: ProductPlanningCycle, item: ProductPlanningDetail, workspaceRevision: number }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const code = props.productCode, cycleId = props.cycle.biz_id
const page = ref(1), pageSize = 10
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const { data, status, error: readError, refresh } = await useFetch(`/api/v1/products/${encodeURIComponent(code)}/planning-cycles/${cycleId}/items`, {
  server: false, query: computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined, sort: 'decision' })),
  transform: (response: { code: number, data: { items: Anchor[], total: number, cycle_biz_id: string, queue_revision: number } }) => {
    if (response.code !== 0 || response.data?.cycle_biz_id !== cycleId || !Array.isArray(response.data.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(item => item.product_code !== code || !item.biz_id)) throw new Error('周期目标事项响应不完整')
    return response.data
  }
})
const selected = ref<Anchor | null>(null), position = ref('before'), reason = ref(''), busy = ref(false), error = ref<Error | null>(null)
const listAlert = useApiErrorAlert(readError, { fallbackTitle: '目标事项加载失败' })
const alert = useApiErrorAlert(error, { fallbackTitle: '调序失败' })
const { confirm } = useConfirm()
const versions = { expectedRevision: props.workspaceRevision, expectedCycleRevision: props.cycle.revision, expectedQueueRevision: props.cycle.queue_revision }
const stale = computed(() => status.value === 'success' && data.value?.queue_revision !== versions.expectedQueueRevision)
interface Impact { item_biz_id: string, title: string, selection_status: string, before_position: number, after_position: number }
const preview = ref<{ payload: string, affected: Impact[], total: number } | null>(null)
const impactPage = ref(1)
watch([selected, position, reason], () => {
  preview.value = null
  impactPage.value = 1
})
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
async function save() {
  if (busy.value || !selected.value || stale.value) return
  error.value = null
  if (!reason.value.trim()) {
    error.value = new Error('请填写调整理由')
    return
  }
  const body = { ...versions, itemId: props.item.biz_id, ...(position.value === 'before' ? { beforeId: selected.value.biz_id } : { afterId: selected.value.biz_id }), reason: reason.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    if (preview.value?.payload !== payload) {
      const result = await $fetch<{ code: number, data: { cycle_biz_id: string, workspace_revision: number, cycle_revision: number, queue_revision: number, affected: Impact[], total: number } }>(`/api/v1/products/${encodeURIComponent(code)}/planning-cycles/${cycleId}/move-preview`, { method: 'POST', body, timeout: 15000 })
      const value = result.data
      if (result.code !== 0 || value?.cycle_biz_id !== cycleId || value.workspace_revision !== versions.expectedRevision || value.cycle_revision !== versions.expectedCycleRevision || value.queue_revision !== versions.expectedQueueRevision || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.affected) || value.affected.length > value.total || value.affected.some(item => !item.item_biz_id || !Number.isSafeInteger(item.before_position) || !Number.isSafeInteger(item.after_position) || item.before_position < 1 || item.after_position < 1)) throw new Error('调序影响预览不完整，请重试')
      preview.value = { payload, affected: value.affected, total: value.total }
      impactPage.value = 1
      return
    }
    if (!(await confirm({ title: '确认调整周期顺序', message: `将“${props.item.title}”移到“${selected.value.title}”${position.value === 'before' ? '之前' : '之后'}。\n理由：${reason.value}\n共有 ${preview.value.affected.length} 个事项的位置变化，详见已展示预览。系统将检查完整队列版本及已选前置关系，不改变评分、选择结果或版本承诺。`, tone: 'warning', confirmLabel: '确认调序' }))) return
    const response = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(code)}/planning-cycles/${cycleId}/move`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (!validProductQueueReceipt(response, { cycleId, workspaceRevision: versions.expectedRevision, cycleRevision: versions.expectedCycleRevision, queueRevision: versions.expectedQueueRevision })) throw new Error('调序响应不完整，请重试')
    busy.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('调序失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="min-w-0 space-y-4">
    <h1 class="break-words text-xl font-semibold">
      调整顺序：{{ item.title }}
    </h1>
    <p class="whitespace-pre-wrap break-words text-sm">
      {{ item.scope_summary }}
    </p>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
      <UFormField label="搜索目标事项" class="min-w-0 flex-1">
        <UInput
          v-model="search"
          :disabled="busy"
          class="w-full"
          placeholder="目标事项标题或范围"
        />
      </UFormField>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :disabled="busy"
        @click="refresh()"
      >
        刷新目标列表
      </UButton>
    </form>
    <UAlert v-if="listAlert" v-bind="listAlert" />
    <UAlert
      v-if="stale"
      color="warning"
      title="周期顺序已变化"
      description="请返回候选列表核对最新顺序，再重新发起调整。"
    />
    <p v-if="status === 'pending'" role="status">
      正在加载目标事项…
    </p>
    <template v-if="status === 'success'">
      <div v-for="anchor in data?.items || []" :key="anchor.biz_id" class="space-y-2 rounded-lg border border-default p-3">
        <p class="break-words font-medium">
          {{ anchor.title }}
        </p>
        <p class="whitespace-pre-wrap break-words text-sm text-muted">
          {{ anchor.scope_summary }}
        </p>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="busy || stale || anchor.biz_id === item.biz_id"
          :aria-pressed="selected?.biz_id === anchor.biz_id"
          @click="selected = anchor"
        >
          {{ anchor.biz_id === item.biz_id ? '当前移动事项' : selected?.biz_id === anchor.biz_id ? '已选为目标' : '选为目标' }}
        </UButton>
      </div>
      <CommonEmptyState
        v-if="!data?.items.length"
        icon="i-lucide-search"
        title="暂无符合条件的目标"
        description="请调整关键词；目标必须属于本周期。"
      />
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-muted">共 {{ data?.total || 0 }} 个事项（含当前事项）</span><UPagination
          v-model:page="page"
          :total="data?.total || 0"
          :items-per-page="pageSize"
          :sibling-count="0"
          :disabled="busy"
        />
      </div>
    </template>
    <form class="space-y-3" @submit.prevent="save">
      <p v-if="selected" class="break-words font-medium">
        目标：{{ selected.title }}
      </p>
      <UFormField label="相对位置">
        <USelect v-model="position" :disabled="busy" :items="[{ label: '移到目标之前', value: 'before' }, { label: '移到目标之后', value: 'after' }]" />
      </UFormField>
      <UFormField label="调整理由" required>
        <UTextarea
          v-model="reason"
          :disabled="busy"
          required
          :maxlength="2000"
          class="w-full"
        />
      </UFormField>
      <section v-if="preview" class="space-y-3 rounded-lg border border-default p-3">
        <h2 class="font-semibold">
          调序影响：{{ preview.affected.length }} 个事项（周期共 {{ preview.total }} 项）
        </h2>
        <p class="text-sm text-muted">
          仅预览位置变化；前置条件在正式提交时再次校验。
        </p>
        <p v-if="!preview.affected.length" class="text-sm">
          当前已在目标位置，无需调整。
        </p>
        <div v-for="impact in preview.affected.slice((impactPage - 1) * 20, impactPage * 20)" :key="impact.item_biz_id" class="space-y-1 border-t border-default pt-2">
          <p class="break-words font-medium">
            {{ impact.title }}
          </p>
          <p class="text-sm">
            第 {{ impact.before_position }} 位 → 第 {{ impact.after_position }} 位 · {{ ({ candidate: '候选', selected: '已选入', deferred: '暂缓' } as Record<string, string>)[impact.selection_status] || impact.selection_status }}
          </p>
        </div>
        <UPagination
          v-if="preview.affected.length > 20"
          v-model:page="impactPage"
          :total="preview.affected.length"
          :items-per-page="20"
          :sibling-count="0"
          :disabled="busy"
        />
      </section>
      <UAlert v-if="alert" v-bind="alert" />
      <p v-if="error" class="text-sm text-muted">
        选择与理由已保留。版本冲突时请返回核对最新队列，依赖冲突时请先处理前置关系。
      </p>
      <div class="flex flex-wrap gap-3">
        <UButton type="submit" :loading="busy" :disabled="!selected || stale">
          {{ preview ? '确认并调整顺序' : '预览调序影响' }}
        </UButton><UButton
          type="button"
          color="neutral"
          variant="ghost"
          :disabled="busy"
          @click="emit('cancel')"
        >
          返回周期候选
        </UButton>
      </div>
    </form>
  </div>
</template>
