<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

const props = defineProps<{ productCode: string, workspaceRevision: number, cycle: ProductPlanningCycle }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const reason = ref('')
const busy = ref(false)
const failure = ref<unknown>(null)
const alert = useApiErrorAlert(failure, { fallbackTitle: '复评记录失败，结论已保留' })
const { confirm } = useConfirm()
const frozen = { code: props.productCode, id: props.cycle.biz_id, root: props.workspaceRevision, revision: props.cycle.revision }
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
async function save() {
  if (busy.value || !reason.value.trim()) return
  const body = { expectedRevision: frozen.root, expectedCycleRevision: frozen.revision, reason: reason.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  failure.value = null
  try {
    if (!await confirm({ title: '确认记录复评', message: `${props.cycle.title}\n复评结论：${reason.value}\n下一次复评安排在本次提交后 ${props.cycle.review_interval_days} 天。已有评分、过期标记和排序保持原状。`, confirmLabel: '记录复评', tone: 'warning' })) return
    const response = await $fetch<{ code: number, data: { value: ProductPlanningCycle } }>(`/api/v1/products/${encodeURIComponent(frozen.code)}/planning-cycles/${frozen.id}/review`, { method: 'POST', body, timeout: 15000, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || result?.biz_id !== frozen.id || result.product_code !== frozen.code || result.status !== 'open' || !result.next_review_at) throw new Error('复评结果不完整，请保留原请求重试')
    busy.value = false
    emit('saved')
  } catch (error) {
    failure.value = error
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <h1 class="text-xl font-semibold break-words">
      {{ cycle.title }} · 记录复评
    </h1>
    <p class="text-sm text-muted">
      核对当前目标、证据、投入与依赖后记录结论。需要调整评分或顺序时，请先完成相应评估与决策操作。
    </p>
    <p class="text-sm">
      下次复评：{{ cycle.next_review_at || '未安排' }} · 复评间隔 {{ cycle.review_interval_days }} 天
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UFormField label="复评结论与待跟进事项" required>
      <UTextarea
        v-model="reason"
        class="w-full"
        :rows="6"
        :maxlength="2000"
        :disabled="busy"
        required
      />
    </UFormField>
    <div class="flex flex-wrap gap-3">
      <UButton type="submit" :loading="busy" :disabled="busy || !reason.trim()">
        记录复评
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="emit('cancel')"
      >
        返回周期列表
      </UButton>
    </div>
  </form>
</template>
