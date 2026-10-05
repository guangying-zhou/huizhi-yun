<script setup lang="ts">
import { objectivePositive as positive } from '~/utils/productObjectiveView'

export interface ObjectivePlanningChoice { id: number, biz_id: string, product_code: string, title: string, lifecycle: string, revision: number }
const props = defineProps<{ productCode: string }>()
const emit = defineEmits<{ choose: [item: ObjectivePlanningChoice] }>()
const page = ref(1), pageSize = 10, lifecycle = ref('proposed')
const { search, debounced, flush, reset } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
watch(lifecycle, () => {
  page.value = 1
})
const states = [{ label: '待规划', value: 'proposed' }, { label: '交付中', value: 'in_delivery' }, { label: '已交付', value: 'delivered' }]
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/planning-items`, {
  server: false, query: computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined, lifecycle: lifecycle.value })),
  transform: (response: { code: number, data: { items: ObjectivePlanningChoice[], total: number } }) => {
    const result = response.data
    if (response.code !== 0 || !result || !Number.isSafeInteger(result.total) || result.total < 0 || !Array.isArray(result.items) || result.items.length > pageSize || result.items.length > result.total || new Set(result.items.map(item => item.id)).size !== result.items.length || result.items.some(item => !positive(item.id) || !positive(item.revision) || item.product_code !== props.productCode || typeof item.biz_id !== 'string' || !item.biz_id || typeof item.title !== 'string' || !item.title.trim() || item.lifecycle !== lifecycle.value)) throw new Error('可选规划事项响应不完整')
    return result
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '可选规划事项加载失败' })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap gap-2">
      <UInput
        v-model="search"
        aria-label="搜索规划事项"
        placeholder="搜索事项标题或范围"
        class="min-w-0 flex-1"
        @keydown.enter="flush()"
      />
      <USelect v-model="lifecycle" :items="states" aria-label="规划事项状态" />
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
    <p v-else-if="status === 'pending'" class="text-sm text-muted">
      正在加载可选事项…
    </p>
    <template v-else-if="status === 'success' && data">
      <p v-if="data.total === 0" class="text-sm text-muted">
        没有符合条件的规划事项。
      </p>
      <div v-for="item in data.items" :key="item.id" class="flex items-center justify-between gap-3 rounded-lg border border-default p-3">
        <span class="min-w-0 break-words">{{ item.title }}</span>
        <UButton size="sm" variant="outline" @click="emit('choose', item)">
          选择
        </UButton>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted">
          共 {{ data.total }} 项
        </p>
        <UPagination v-model:page="page" :items-per-page="pageSize" :total="data.total" />
      </div>
    </template>
  </div>
</template>
