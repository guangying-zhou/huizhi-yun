<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

const { moduleUrl, hosted, cacheKey } = useAimsModule()
const props = defineProps<{ productCode: string, itemId: string }>()
interface Detail { biz_id: string, product_code: string, title: string, scope_summary: string, lifecycle: string, investment_category: string, urgency_level: string, deadline: string | null, requests: { biz_id: string, revision: number }[] }
const { data, status, error, refresh } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/planning-items/${props.itemId}`), { ...(hosted ? { key: computed(() => cacheKey('aims/app/components/products/PlanningItemDetail.vue:0' + ':' + String(toValue(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/planning-items/${props.itemId}`))))) } : {}),
  server: false,
  transform: (response: { code: number, data: Detail }) => {
    if (response.code !== 0 || response.data?.biz_id !== props.itemId || response.data.product_code !== props.productCode || !Array.isArray(response.data.requests)) throw new Error('规划事项详情响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '规划详情加载失败' })
const categories: Record<string, string> = { reliability: '可靠性与技术治理', usability: '体验优化', growth: '新功能与业务增长' }
const states: Record<string, string> = { proposed: '待规划', in_delivery: '交付中', delivered: '已交付', cancelled: '已取消', merged: '已合并' }
</script>

<template>
  <div class="space-y-4">
    <UButton
      color="neutral"
      variant="ghost"
      :loading="status === 'pending'"
      @click="refresh()"
    >
      刷新事项详情
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在加载事项详情…
    </p>
    <template v-else-if="status === 'success' && data">
      <p class="font-medium break-words">
        {{ data.title }}
      </p>
      <p class="whitespace-pre-wrap break-words text-sm">
        {{ data.scope_summary }}
      </p>
      <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-muted">
            状态
          </dt><dd>{{ states[data.lifecycle] || data.lifecycle }}</dd>
        </div>
        <div>
          <dt class="text-muted">
            投资类别
          </dt><dd>{{ categories[data.investment_category] || data.investment_category }}</dd>
        </div>
        <div>
          <dt class="text-muted">
            紧急程度建议
          </dt><dd>{{ data.urgency_level }}</dd>
        </div>
        <div>
          <dt class="text-muted">
            期限
          </dt><dd>{{ data.deadline || '未确定' }}</dd>
        </div>
      </dl>
      <p class="text-sm text-muted">
        已关联 {{ data.requests.length }} 条来源需求。来源数量不代表价值分数。
      </p>
      <UButton :to="moduleUrl(`/products/${encodeURIComponent(productCode)}/requests`)" color="neutral" variant="outline">
        进入产品需求池
      </UButton>
    </template>
  </div>
</template>
