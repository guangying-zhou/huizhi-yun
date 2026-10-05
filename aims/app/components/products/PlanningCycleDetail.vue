<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

const props = defineProps<{ productCode: string, cycleId: string }>()
const states = { draft: '草案', open: '开放中', closed: '已关闭' }
const budgets = { total_person_days: '总容量', reserve_person_days: '应急预留', reliability_person_days: '可靠性与技术治理', usability_person_days: '体验优化', growth_person_days: '新功能与业务增长' }
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/planning-cycles/${props.cycleId}`, {
  server: false,
  transform: (response: { code: number, data: ProductPlanningCycle }) => {
    if (response.code !== 0 || response.data?.biz_id !== props.cycleId || response.data.product_code !== props.productCode || !Object.hasOwn(states, response.data.status)) throw new Error('周期详情响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '周期详情加载失败' })
</script>

<template>
  <div class="space-y-4">
    <UButton
      color="neutral"
      variant="ghost"
      :loading="status === 'pending'"
      @click="refresh()"
    >
      刷新周期详情
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在加载周期详情…
    </p>
    <template v-else-if="status === 'success' && data">
      <p class="text-sm">
        {{ states[data.status] }} · {{ data.starts_on }} 至 {{ data.ends_on }}
      </p>
      <div>
        <h3 class="font-medium">
          周期目标
        </h3><p class="mt-1 whitespace-pre-wrap break-words text-sm">
          {{ data.goal_summary }}
        </p>
      </div>
      <div v-if="data.metric_definition" class="space-y-1 text-sm">
        <h3 class="font-medium">
          成功指标：{{ data.metric_definition.name }}
        </h3>
        <p>单位：{{ data.metric_definition.unit }} · {{ ({ increase: '提高', decrease: '降低', maintain: '维持' })[data.metric_definition.direction as 'increase' | 'decrease' | 'maintain'] || '方向未确定' }}</p>
        <p class="whitespace-pre-wrap break-words">
          测量口径：{{ data.metric_definition.measurement_method }}
        </p>
      </div>
      <p v-else class="text-sm text-muted">
        成功指标尚未定义
      </p>
      <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div v-for="(label, key) in budgets" :key="key">
          <dt class="text-muted">
            {{ label }}（人日）
          </dt><dd>{{ data.budget?.[key] ?? '未确定' }}</dd>
        </div>
        <div>
          <dt class="text-muted">
            复评间隔
          </dt><dd>{{ data.review_interval_days }} 天</dd>
        </div>
        <div>
          <dt class="text-muted">
            下次复评
          </dt><dd class="break-words">
            {{ data.next_review_at || '尚未安排' }}
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            目标基线
          </dt><dd>{{ data.baseline_value ?? '未确定' }}</dd>
        </div>
        <div>
          <dt class="text-muted">
            目标值
          </dt><dd>{{ data.target_value ?? '未确定' }}</dd>
        </div>
      </dl>
      <p class="text-xs text-muted">
        容量是本周期的规划预算，具体交付安排还需核对事项投入、依赖及团队资源。
      </p>
    </template>
  </div>
</template>
