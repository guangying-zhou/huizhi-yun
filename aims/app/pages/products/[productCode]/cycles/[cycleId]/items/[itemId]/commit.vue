<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'
import { objectivePositive as positive } from '~/utils/productObjectiveView'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '确认路线承诺', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const cycleId = computed(() => String(route.params.cycleId || ''))
const itemId = computed(() => String(route.params.itemId || ''))
interface Window { biz_id: string, product_code: string, title: string, lifecycle: string, starts_on: string | null, ends_on: string | null, revision: number, workspace_revision: number }
interface Baseline { id: number, starts_on: string, ends_on: string, reason: string, item_snapshot: { biz_id: string, product_code: string } }
const { data, status, error, refresh } = await useAsyncData(() => `roadmap-commit:${code.value}:${cycleId.value}:${itemId.value}`, async () => {
  const product = code.value, cycleKey = cycleId.value, itemKey = itemId.value
  const base = `/api/v1/products/${encodeURIComponent(product)}`
  const [permission, cycle, window, history] = await Promise.all([
    $fetch<{ code: number, data: { product_code: string, status: string, revision: number, commit: boolean } }>(`${base}/roadmaps/permissions`, { timeout: 15000 }),
    $fetch<{ code: number, data: ProductPlanningCycle & { workspace_revision: number } }>(`${base}/planning-cycles/${cycleKey}`, { timeout: 15000 }),
    $fetch<{ code: number, data: Window }>(`${base}/roadmaps/windows/${itemKey}`, { timeout: 15000 }),
    $fetch<{ code: number, data: { item_biz_id: string, workspace_revision: number, item_revision: number, latest_id: number, total: number, items: Baseline[] } }>(`${base}/roadmaps/commitments/${itemKey}`, { query: { page: 1, pageSize: 1 }, timeout: 15000 })
  ])
  if (permission.code !== 0 || permission.data?.product_code !== product || permission.data.status !== 'active' || permission.data.commit !== true) throw new Error('当前没有确认承诺权限')
  if (cycle.code !== 0 || cycle.data?.biz_id !== cycleKey || cycle.data.product_code !== product || cycle.data.status !== 'open') throw new Error('需要开放的规划周期')
  if (window.code !== 0 || window.data?.biz_id !== itemKey || window.data.product_code !== product || !['proposed', 'in_delivery'].includes(window.data.lifecycle) || !window.data.starts_on || !window.data.ends_on) throw new Error('请先为可编辑事项设置探索窗口')
  const root = permission.data.revision
  if (history.code !== 0 || history.data?.item_biz_id !== itemKey || history.data.workspace_revision !== root || history.data.item_revision !== window.data.revision || window.data.workspace_revision !== root || cycle.data.workspace_revision !== root || ![root, window.data.revision, cycle.data.revision, cycle.data.queue_revision].every(positive)) throw new Error('产品或事项已变化，请重新加载')
  const latest = history.data.items?.[0]
  if (!Number.isSafeInteger(history.data.latest_id) || history.data.latest_id < 0 || !Number.isSafeInteger(history.data.total) || history.data.total < 0 || (history.data.total === 0) !== (history.data.latest_id === 0) || (history.data.latest_id > 0 && (!latest || latest.id !== history.data.latest_id || latest.item_snapshot?.biz_id !== itemKey || latest.item_snapshot.product_code !== product))) throw new Error('最新承诺基线不完整')
  return { product, cycle: cycle.data, window: window.data, latest, previousId: history.data.latest_id, root }
}, { server: false })
const reason = ref(''), saving = ref(false), saveError = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '承诺数据加载失败' })
const saveAlert = useApiErrorAlert(saveError, { fallbackTitle: '确认承诺失败' })
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
async function submit() {
  if (saving.value || status.value !== 'success' || !data.value || !reason.value.trim()) return
  const current = data.value
  const body = { cycleId: current.cycle.biz_id, expectedRevision: current.root, expectedItemRevision: current.window.revision, expectedCycleRevision: current.cycle.revision, expectedQueueRevision: current.cycle.queue_revision, expectedPreviousId: current.previousId, reason: reason.value }
  const payload = JSON.stringify({ product: current.product, item: current.window.biz_id, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  saving.value = true
  saveError.value = null
  try {
    if (!await confirm({ title: '确认路线承诺', message: `${current.window.title}\n${current.window.starts_on} 至 ${current.window.ends_on}\n${current.previousId ? '追加新基线，原基线保留。' : '建立首次承诺基线。'}\n原因：${body.reason}`, tone: 'warning', confirmLabel: '确认承诺' })) return
    const result = await $fetch<{ code: number, data: { value: { id: number, product_code: string, item_biz_id: string, cycle_biz_id: string, previous_commitment_id: number, workspace_revision: number } } }, string>(`/api/v1/products/${encodeURIComponent(current.product)}/roadmaps/commit/${current.window.biz_id}`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const receipt = result.data?.value
    if (result.code !== 0 || !receipt || !positive(receipt.id) || receipt.product_code !== current.product || receipt.item_biz_id !== current.window.biz_id || receipt.cycle_biz_id !== current.cycle.biz_id || receipt.previous_commitment_id !== current.previousId || receipt.workspace_revision !== current.root + 1) throw new Error('承诺回执不完整，请重试')
    reason.value = ''
    retry = undefined
    toast.add({ title: '承诺基线已保存', color: 'success' })
    await refresh()
  } catch (cause) {
    saveError.value = cause instanceof Error ? cause : new Error('确认失败，请重试')
  } finally {
    saving.value = false
  }
}
onBeforeRouteLeave(() => !saving.value)
onBeforeRouteUpdate(() => !saving.value)
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
    <UButton
      :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/roadmap`"
      :disabled="saving"
      color="neutral"
      variant="ghost"
    >
      返回季度路线图
    </UButton>
    <h1 class="text-xl font-semibold">
      确认路线承诺
    </h1>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      :disabled="saving"
      :loading="status === 'pending'"
      color="neutral"
      variant="outline"
      @click="refresh()"
    >
      重新加载当前安排
    </UButton>
    <UCard v-if="status === 'success' && data">
      <h2 class="break-words font-semibold">
        {{ data.window.title }}
      </h2>
      <p class="mt-2">
        {{ data.cycle.title }} · {{ data.window.starts_on }} 至 {{ data.window.ends_on }}
      </p>
      <p v-if="data.latest" class="mt-2 text-sm">
        上一基线：{{ data.latest.starts_on }} 至 {{ data.latest.ends_on }} · {{ data.latest.reason }}
      </p>
      <p v-else class="mt-2 text-sm">
        尚无承诺，将建立首次基线。
      </p>
      <UButton :to="`/products/${encodeURIComponent(code)}/planning-items/${itemId}/commitments`" :disabled="saving" variant="link">
        查看完整承诺历史
      </UButton>
      <p class="my-3 text-sm text-muted">
        提交时将核验选入决定、评估和前置依赖，并保存当前事实快照。后续变更追加基线，原记录保留。
      </p>
      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="确认原因" required>
          <UTextarea
            v-model="reason"
            :disabled="saving"
            :maxlength="2000"
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="saveAlert" v-bind="saveAlert" />
        <UButton type="submit" :loading="saving" :disabled="!reason.trim()">
          确认承诺
        </UButton>
      </form>
    </UCard>
  </div>
</template>
