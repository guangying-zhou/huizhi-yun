<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

const props = defineProps<{ refreshToken?: number, productCode: string, cycleId: string }>()
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/planning-cycles/${encodeURIComponent(props.cycleId)}`, {
  server: false,
  transform: (response: { code: number, data: ProductPlanningCycle }) => {
    const cycle = response.data
    if (response.code !== 0 || !cycle || cycle.biz_id !== props.cycleId || cycle.product_code !== props.productCode || typeof cycle.title !== 'string' || !cycle.title.trim() || typeof cycle.goal_summary !== 'string' || !['draft', 'open', 'closed'].includes(cycle.status)) throw new Error('规划周期目标响应不完整')
    const metric = cycle.metric_definition
    if (metric !== null && (!metric || typeof metric.name !== 'string' || typeof metric.unit !== 'string' || !['increase', 'decrease', 'maintain'].includes(metric.direction) || typeof metric.measurement_method !== 'string')) throw new Error('周期指标定义不完整')
    if ([cycle.baseline_value, cycle.target_value].some(value => value !== null && (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)))) throw new Error('周期指标数值不完整')
    return cycle
  }
})
watch(() => props.refreshToken, () => {
  void refresh()
})
const alert = useApiErrorAlert(error, { fallbackTitle: '周期目标读取失败' })
</script>

<template>
  <section class="space-y-2 rounded-lg border border-default p-3">
    <h3 class="font-semibold">
      规划周期目标
    </h3>
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在读取周期目标…
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      v-if="error"
      variant="outline"
      color="neutral"
      @click="refresh()"
    >
      重新读取目标
    </UButton>
    <template v-if="status === 'success' && data">
      <p class="break-words text-sm">
        {{ data.title }} · {{ { draft: '草稿', open: '进行中', closed: '已关闭' }[data.status] }}
      </p>
      <p class="whitespace-pre-wrap break-words text-sm">
        {{ data.goal_summary || '尚未填写周期目标摘要。' }}
      </p>
      <template v-if="data.metric_definition">
        <p class="break-words text-sm">
          {{ data.metric_definition.name }}（{{ { increase: '提高', decrease: '降低', maintain: '维持' }[data.metric_definition.direction as 'increase' | 'decrease' | 'maintain'] }}）：基线 {{ data.baseline_value ?? '未记录' }} → 目标 {{ data.target_value ?? '未记录' }} {{ data.metric_definition.unit }}
        </p>
        <p class="whitespace-pre-wrap break-words text-sm text-muted">
          测量方式：{{ data.metric_definition.measurement_method || '尚未填写' }}
        </p>
      </template>
      <p v-else class="text-sm text-muted">
        尚未设置周期衡量指标。
      </p>
      <p class="text-xs text-muted">
        当前周期目标适用于整条路线图，不代表每项事项均已关联产品战略目标。
      </p>
      <UButton :to="`/products/${encodeURIComponent(productCode)}/cycles/${encodeURIComponent(cycleId)}/items`" variant="link">
        查看周期规划事项
      </UButton>
    </template>
  </section>
</template>
