<script setup lang="ts">
import { objectivePositive as positive } from '~/utils/productObjectiveView'

export interface ObjectiveCyclePlanningChoice { id: number, biz_id: string, product_code: string, title: string, status: 'draft' | 'open' | 'closed', revision: number, goal_summary: string, starts_on: string, ends_on: string }
const props = defineProps<{ productCode: string }>()
const emit = defineEmits<{ choose: [item: ObjectiveCyclePlanningChoice] }>()
const page = ref(1), pageSize = 10, status = ref<'all' | 'draft' | 'open' | 'closed'>('all')
const { search, debounced, flush, reset } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
watch(status, () => {
  page.value = 1
})
const states = [
  { label: '全部', value: 'all' },
  { label: '草稿', value: 'draft' },
  { label: '进行中', value: 'open' },
  { label: '已结束', value: 'closed' }
]
const cycleDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const { data, status: fetchStatus, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/planning-cycles`, {
  server: false, query: computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined, status: status.value === 'all' ? undefined : status.value })),
  transform: (response: { code: number, data: { items: unknown[], total: number } }) => {
    const result = response.data
    if (response.code !== 0 || !result || !Number.isSafeInteger(result.total) || result.total < 0 || !Array.isArray(result.items) || result.items.length > pageSize || result.items.length > result.total) throw new Error('规划周期响应不完整')
    const ids = new Set<number>()
    for (const raw of result.items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('规划周期响应不完整')
      const item = raw as Record<string, unknown>
      if (!Number.isSafeInteger(item.id) || !positive(Number(item.id)) || typeof item.id !== 'number' || typeof item.biz_id !== 'string' || !item.biz_id || typeof item.product_code !== 'string' || item.product_code !== props.productCode || typeof item.title !== 'string' || !item.title.trim() || typeof item.status !== 'string' || !['draft', 'open', 'closed'].includes(item.status) || !Number.isSafeInteger(item.revision) || !positive(Number(item.revision)) || typeof item.revision !== 'number' || typeof item.goal_summary !== 'string' || !cycleDate(item.starts_on) || !cycleDate(item.ends_on) || item.ends_on < item.starts_on || (status.value !== 'all' && item.status !== status.value) || ids.has(item.id)) throw new Error('规划周期响应不完整')
      ids.add(item.id as number)
    }
    return result as { items: ObjectiveCyclePlanningChoice[], total: number }
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '规划周期加载失败' })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap gap-2">
      <UInput
        v-model="search"
        aria-label="搜索规划周期"
        placeholder="搜索规划周期"
        class="min-w-0 flex-1"
        @keydown.enter="flush()"
      />
      <USelect v-model="status" :items="states" aria-label="规划周期状态" />
      <UButton color="neutral" variant="ghost" @click="reset()">
        清除搜索
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      v-if="alert"
      color="neutral"
      variant="outline"
      @click="refresh()"
    >
      重试加载
    </UButton>
    <p v-else-if="fetchStatus === 'pending'" class="text-sm text-muted">
      正在加载规划周期…
    </p>
    <template v-else-if="fetchStatus === 'success' && data">
      <p v-if="data.total === 0" class="text-sm text-muted">
        没有符合条件的规划周期。
      </p>
      <div v-for="item in data.items" :key="item.id" class="flex flex-col gap-2 rounded-lg border border-default p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h4 class="font-medium">
              {{ item.title }}
            </h4>
            <p class="text-xs text-muted">
              {{ item.starts_on }} 至 {{ item.ends_on }}
            </p>
          </div>
          <UBadge color="neutral" variant="subtle">
            {{ states.find(state => state.value === item.status)?.label }}
          </UBadge>
        </div>
        <p v-if="item.goal_summary" class="text-xs text-muted line-clamp-2">
          {{ item.goal_summary }}
        </p>
        <div class="flex justify-end">
          <UButton size="sm" variant="outline" @click="emit('choose', item)">
            选择
          </UButton>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted">
          共 {{ data.total }} 个
        </p>
        <UPagination v-model:page="page" :items-per-page="pageSize" :total="data.total" />
      </div>
    </template>
  </div>
</template>
