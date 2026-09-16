<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

const props = defineProps<{ productCode: string, workspaceRevision: number, cycle: ProductPlanningCycle, closing?: boolean }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const reason = ref(''), busy = ref(false), error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '周期流转失败' })
const { confirm } = useConfirm()
const code = props.productCode, id = props.cycle.biz_id
const expectedRevision = props.workspaceRevision, expectedCycleRevision = props.cycle.revision
const budgets = { total_person_days: '总容量', reserve_person_days: '应急预留', reliability_person_days: '可靠性与技术治理', usability_person_days: '体验优化', growth_person_days: '新功能与业务增长' }
const missing = computed(() => {
  const items: string[] = []
  if (props.closing) return items
  for (const [key, label] of Object.entries(budgets)) if (props.cycle.budget?.[key as keyof typeof budgets] == null) items.push(`${label}尚未确定`)
  if (!props.cycle.metric_definition) items.push('成功指标尚未定义')
  if (props.cycle.target_value == null) items.push('目标值尚未确定')
  return items
})
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
async function save() {
  if (busy.value || missing.value.length) return
  error.value = null
  if (!reason.value.trim()) {
    error.value = new Error(props.closing ? '请填写关闭理由' : '请填写开放理由')
    return
  }
  const body = { expectedRevision, expectedCycleRevision, reason: reason.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    if (!(await confirm({ title: props.closing ? '确认关闭规划周期' : '确认开放规划周期', message: props.closing ? `${props.cycle.title}\n关闭理由：${body.reason}\n关闭后不能继续在本周期评估、选入或调整队列，也不能重新开放。已有评分和决定保留；未完成事项不会自动结束或转入下一周期。` : `${props.cycle.title}\n开放理由：${body.reason}\n开放后将进入周期评估阶段，目标和容量不能再通过草案编辑修改；不会自动选入事项或承诺版本。`, tone: 'warning', confirmLabel: props.closing ? '关闭周期' : '开放周期' }))) return
    const response = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(code)}/planning-cycles/${id}/${props.closing ? 'close' : 'open'}`, { method: 'POST', timeout: 15000, body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('周期流转结果不完整，请重试')
    busy.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('周期流转失败')
  } finally { busy.value = false }
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="save">
    <h1 class="text-xl font-semibold break-words">
      {{ cycle.title }}
    </h1>
    <p class="text-sm">
      {{ cycle.starts_on }} 至 {{ cycle.ends_on }}
    </p>
    <p class="whitespace-pre-wrap break-words text-sm">
      {{ cycle.goal_summary }}
    </p>
    <div v-if="cycle.metric_definition" class="space-y-1 text-sm">
      <p class="font-medium">
        {{ cycle.metric_definition.name }}（{{ cycle.metric_definition.unit }}）
      </p>
      <p class="whitespace-pre-wrap break-words">
        {{ cycle.metric_definition.measurement_method }}
      </p>
      <p>基线：{{ cycle.baseline_value ?? '未知' }} · 目标：{{ cycle.target_value ?? '未知' }}</p>
    </div>
    <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <div v-for="(label, key) in budgets" :key="key">
        <dt class="text-muted">
          {{ label }}（人日）
        </dt><dd>{{ cycle.budget?.[key] ?? '未确定' }}</dd>
      </div>
    </dl>
    <UAlert
      v-if="missing.length"
      color="warning"
      title="请先完善周期草案"
      :description="missing.join('；')"
    />
    <UAlert v-if="alert" v-bind="alert" />
    <UFormField :label="closing ? '关闭理由' : '开放理由'" name="cycleTransitionReason" required>
      <UTextarea
        v-model="reason"
        required
        :maxlength="2000"
        :disabled="busy"
        class="w-full"
      />
    </UFormField>
    <p class="text-sm text-muted">
      {{ closing ? '关闭后可新建并开放下一周期；未完成事项需显式加入新周期并重新评估。关闭不代表事项已交付。' : '每个产品同时只能有一个开放周期。系统将在提交时重新检查容量、指标、期间及其他开放周期。' }}
    </p>
    <div class="flex flex-wrap gap-3">
      <UButton type="submit" :loading="busy" :disabled="missing.length > 0">
        {{ closing ? '关闭周期' : '开放周期' }}
      </UButton>
      <UButton
        type="button"
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
