<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'
import type { ProductRequestRecord } from '../../types/productRequest'

const { moduleUrl, hosted, cacheKey } = useAimsModule()

const props = defineProps<{ productCode: string, disabled?: boolean }>()
const selected = defineModel<ProductRequestRecord[]>({ required: true })
const search = ref(''), keyword = ref(''), page = ref(1)
const { data, status, error, execute } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests`), { ...(hosted ? { key: computed(() => cacheKey('aims/app/components/products/PlanningRequestPicker.vue:0' + ':' + String(toValue(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests`))))) } : {}),
  server: false, immediate: false, watch: false,
  query: computed(() => ({ page: page.value, pageSize: 10, keyword: keyword.value || undefined })),
  transform: (response: { code: number, data: { items: ProductRequestRecord[], total: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(item => item.product_code !== props.productCode)) throw new Error('来源需求响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '来源需求加载失败' })
async function find() {
  if (props.disabled) return
  page.value = 1
  keyword.value = search.value
  await execute()
}
async function changePage(value: number) {
  if (props.disabled) return
  page.value = value
  await execute()
}
function add(item: ProductRequestRecord) {
  if (props.disabled || item.decision_status === 'merged' || selected.value.length >= 100 || selected.value.some(row => row.biz_id === item.biz_id)) return
  selected.value = [...selected.value, { ...item }]
}
function remove(id: string) {
  if (!props.disabled) selected.value = selected.value.filter(item => item.biz_id !== id)
}
</script>

<template>
  <section class="space-y-3 rounded-lg border border-default p-3" aria-label="来源需求选择">
    <h3 class="font-medium">
      来源需求（可选）
    </h3>
    <p class="text-xs text-muted">
      可关联最多 100 条需求；工程治理或调研事项可以不关联。已合并需求请选其最终目标，来源条数不会自动累加价值分。
    </p>
    <div class="flex flex-wrap items-end gap-2">
      <UFormField label="搜索来源需求" name="planningRequestSearch" class="min-w-0 flex-1">
        <UInput
          v-model="search"
          :maxlength="200"
          :disabled="disabled"
          class="w-full"
          @keydown.enter.prevent="find"
        />
      </UFormField>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :disabled="disabled"
        :loading="status === 'pending'"
        @click="find"
      >
        查找需求
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在加载来源需求…
    </p>
    <div v-else-if="status === 'success'" class="space-y-2">
      <p class="text-xs text-muted">
        匹配 {{ data?.total || 0 }} 条记录；已合并项不可选。
      </p>
      <ul class="space-y-2">
        <li v-for="item in data?.items || []" :key="item.biz_id" class="space-y-1">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            :disabled="disabled || item.decision_status === 'merged' || selected.some(row => row.biz_id === item.biz_id) || selected.length >= 100"
            class="max-w-full whitespace-normal text-left"
            @click="add(item)"
          >
            {{ item.title }}{{ item.decision_status === 'merged' ? '（已合并）' : selected.some(row => row.biz_id === item.biz_id) ? '（已选）' : '' }}
          </UButton>
          <p class="line-clamp-2 break-words text-xs text-muted">
            {{ item.problem_statement }}
          </p>
        </li>
      </ul>
      <UPagination
        v-if="(data?.total || 0) > 10"
        :page="page"
        :total="data?.total || 0"
        :items-per-page="10"
        :sibling-count="0"
        :disabled="disabled"
        show-edges
        @update:page="changePage"
      />
    </div>
    <p class="text-sm font-medium">
      已选 {{ selected.length }} 条来源
    </p>
    <ul class="space-y-1">
      <li v-for="item in selected" :key="item.biz_id" class="flex items-start justify-between gap-2">
        <span class="break-words text-sm">{{ item.title }}</span>
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          :disabled="disabled"
          :aria-label="`移除来源：${item.title}`"
          @click="remove(item.biz_id)"
        >
          移除
        </UButton>
      </li>
    </ul>
  </section>
</template>
