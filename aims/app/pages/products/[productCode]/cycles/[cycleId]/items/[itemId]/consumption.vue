<script setup lang="ts">
import type { ProductPlanningDetail } from '~/types/productPlanning'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '核验已发生投入', layoutHeaderProjectSwitcher: false })
interface Confirmation { confirmation_id: string, spent_person_days: string, confirmed_by: string, confirmed_at: string, reason: string }
interface Consumption { cycle_biz_id: string, item_biz_id: string, workspace_revision: number, cycle_revision: number, queue_revision: number, item_revision: number, scope_revision: number, product_status: string, cycle_status: string, lifecycle: string, selection_status: string, current: boolean, pending: Confirmation | null, blocker: { message: string } | null }
const route = useRoute()
const code = computed(() => String(route.params.productCode || '')), cycleId = computed(() => String(route.params.cycleId || '')), itemId = computed(() => String(route.params.itemId || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}`)
const endpoint = computed(() => `${base.value}/planning-cycles/${cycleId.value}/items/${itemId.value}/consumption`)
const spent = ref(''), reason = ref(''), busy = ref(false), blocked = ref(true), refreshed = ref(false), failure = ref<Error | null>(null)
const item = ref<ProductPlanningDetail | null>(null), record = ref<Consumption | null>(null)
const { confirm } = useConfirm(), toast = useToast()
const alert = useApiErrorAlert(failure, { fallbackTitle: '投入核验失败' })
const body = computed(() => ({ expectedRevision: record.value?.workspace_revision, expectedCycleRevision: record.value?.cycle_revision, expectedQueueRevision: record.value?.queue_revision, expectedItemRevision: record.value?.item_revision, expectedScopeRevision: record.value?.scope_revision, spentPersonDays: spent.value, reason: reason.value }))
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
async function reload() {
  if (busy.value) return
  busy.value = true
  blocked.value = true
  refreshed.value = false
  failure.value = null
  try {
    const permission = await $fetch<{ code: number, data: { product_code: string, status: string, assess: boolean } }>(`${base.value}/planning-cycles/permissions`, { timeout: 15000 })
    if (permission.code !== 0 || permission.data?.product_code !== code.value || permission.data.status !== 'active' || !permission.data.assess) throw new Error('当前产品不可核验或您没有投入评估权限')
    const detail = await $fetch<{ code: number, data: ProductPlanningDetail }>(`${base.value}/planning-items/${itemId.value}`, { timeout: 15000 })
    const response = await $fetch<{ code: number, data: Consumption }>(endpoint.value, { timeout: 15000 })
    const value = response.data
    if (detail.code !== 0 || detail.data?.product_code !== code.value || detail.data.biz_id !== itemId.value || response.code !== 0 || value?.cycle_biz_id !== cycleId.value || value.item_biz_id !== itemId.value) throw new Error('事项或确认记录不完整')
    if (value.product_status !== 'active' || value.cycle_status !== 'open' || value.lifecycle !== 'in_delivery' || value.selection_status !== 'selected') throw new Error('仅开放周期内已开工的已选事项允许核验撤回投入')
    if (value.workspace_revision !== detail.data.workspace_revision || value.item_revision !== detail.data.revision || value.scope_revision !== detail.data.scope_revision) throw new Error('读取期间事项已变化，请重新读取；填写内容已保留')
    for (const version of [value.workspace_revision, value.cycle_revision, value.queue_revision, value.item_revision, value.scope_revision]) if (!Number.isSafeInteger(version) || version < 1) throw new Error('版本信息不完整')
    item.value = detail.data
    record.value = value
    blocked.value = false
    refreshed.value = true
  } catch (cause) {
    failure.value = cause instanceof Error ? cause : new Error('读取失败，填写内容已保留')
  } finally {
    busy.value = false
  }
}
async function save() {
  if (busy.value || blocked.value || !record.value || !item.value) return
  failure.value = null
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(spent.value) || Number(spent.value) > 1000000 || !reason.value.trim()) {
    failure.value = new Error('请明确填写已发生人日（最多两位小数）和核验依据；未知不能填零')
    return
  }
  const payload = JSON.stringify(body.value)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    if (!(await confirm({ title: '确认已发生投入', message: `事项：${item.value.title}\n范围：${item.value.scope_summary}\n已发生：${spent.value} 人日\n核验依据：${reason.value}\n本次仅记录投入确认，不释放预算。${record.value.pending ? '已有待用确认将被替换，旧记录保留于审计。' : ''}`, tone: 'warning', confirmLabel: '确认核验' }))) return
    const result = await $fetch<{ code: number }>(endpoint.value, { method: 'POST', body: JSON.parse(payload), headers: { 'Idempotency-Key': retry.key }, timeout: 15000 })
    if (result.code !== 0) throw new Error('确认结果不完整，请重试')
    toast.add({ title: '投入已确认，尚未撤回事项', color: 'success' })
    busy.value = false
    await navigateTo(`/products/${encodeURIComponent(code.value)}/cycles/${cycleId.value}/items`)
  } catch (cause) {
    failure.value = cause instanceof Error ? cause : new Error('确认失败，填写内容已保留')
  } finally {
    busy.value = false
  }
}
watch([code, cycleId, itemId], () => {
  item.value = null
  record.value = null
  spent.value = ''
  reason.value = ''
  retry = undefined
  void reload()
})
onMounted(reload)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-3xl space-y-4 p-4 sm:p-6">
    <h1 class="break-words text-xl font-semibold">
      核验已发生投入{{ item ? `：${item.title}` : '' }}
    </h1>
    <p v-if="item" class="whitespace-pre-wrap break-words text-sm">
      {{ item.scope_summary }}
    </p>
    <p class="text-sm text-muted">
      填写截至本次核验实际发生的人日。尚不清楚时请先核验；只有确认未发生投入时才能填写零。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      color="neutral"
      variant="outline"
      :disabled="busy"
      @click="reload"
    >
      重新读取并保留填写内容
    </UButton>
    <p v-if="busy" role="status">
      正在处理，请稍候…
    </p>
    <p v-else-if="refreshed" class="text-sm text-muted">
      已读取最新范围与版本，请核对后确认。
    </p>
    <div v-if="record?.pending" class="space-y-2 rounded-lg border border-default p-4 text-sm">
      <h2 class="font-semibold">
        已有投入确认 · {{ record.current ? '与当前范围匹配' : '需要重新核验' }}
      </h2>
      <p>已发生 {{ record.pending.spent_person_days }} 人日</p>
      <p class="break-words">
        {{ record.pending.reason }}
      </p>
      <p class="break-all text-muted">
        确认人 {{ record.pending.confirmed_by }} · {{ record.pending.confirmed_at }}
      </p>
    </div>
    <UFormField label="已发生投入（人日）" required>
      <UInput
        v-model="spent"
        class="w-full"
        inputmode="decimal"
        :disabled="busy"
        placeholder="明确填写，未知请先核验"
      />
    </UFormField>
    <UFormField label="核验依据" required>
      <UTextarea
        v-model="reason"
        class="w-full"
        :maxlength="2000"
        :disabled="busy"
        placeholder="说明统计截止时点、已完成工作及核验依据"
      />
    </UFormField>
    <div class="flex flex-wrap gap-2">
      <UButton :disabled="busy || blocked" @click="save">
        确认已发生投入
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="busy"
        :to="`/products/${encodeURIComponent(code)}/cycles/${cycleId}/items`"
      >
        返回候选列表
      </UButton>
    </div>
  </div>
</template>
