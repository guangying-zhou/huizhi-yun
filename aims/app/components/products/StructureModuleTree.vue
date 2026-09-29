<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

const { moduleUrl, hosted, cacheKey } = useAimsModule()
/** 子层仅在展开时读取；每层独立分页，避免一次取完整产品树。 */
const props = withDefaults(defineProps<{
  productCode: string
  parentId?: number | null
  selected: string
  depth?: number
}>(), { parentId: null, depth: 0 })
const emit = defineEmits<{ select: [value: { id: number, name: string }], resolved: [value: { id: number, name: string }] }>()
interface Module { id: number, name: string, product_code: string, parent_id: number | null, child_count: number }
const page = ref(1), pageSize = 20
const expanded = ref<number[]>([])
const { data, status, error, refresh } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/components`), { ...(hosted ? { key: computed(() => cacheKey('StructureModuleTree:1' + ':' + String(props.productCode) + ':' + String(props.parentId ?? 'root'))) } : {}),
  key: computed(() => `product-structure-tree:${props.productCode}:${props.parentId ?? 'root'}`),
  server: false,
  query: computed(() => ({ parentId: props.parentId ?? undefined, page: page.value, pageSize })),
  transform: (response: { code: number, data: { items: Module[], total: number, parent_id: number | null, page: number, pageSize: number } }) => {
    const result = response.data
    if (response.code !== 0 || !result || result.parent_id !== props.parentId || result.page !== page.value || result.pageSize !== pageSize || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || result.items.length > pageSize || result.items.length > result.total || result.items.some(item => !Number.isSafeInteger(item.id) || item.id < 1 || item.product_code !== props.productCode || item.parent_id !== props.parentId || !item.name?.trim() || !Number.isSafeInteger(item.child_count) || item.child_count < 0)) throw new Error('模块树响应不完整，请重试')
    return result
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '模块加载失败' })
function toggle(id: number) {
  expanded.value = expanded.value.includes(id) ? expanded.value.filter(value => value !== id) : [...expanded.value, id]
}
watch([data, () => props.selected], () => {
  const item = data.value?.items.find(item => String(item.id) === props.selected)
  if (item) emit('resolved', { id: item.id, name: item.name })
}, { immediate: true })
watch(page, () => {
  expanded.value = []
})
</script>

<template>
  <div class="min-w-0 space-y-1">
    <div v-if="alert" class="space-y-2">
      <UAlert v-bind="alert" />
      <UButton
        size="sm"
        color="neutral"
        variant="outline"
        @click="refresh()"
      >
        重试加载模块
      </UButton>
    </div>
    <p v-else-if="status === 'pending'" role="status" class="p-2 text-sm text-muted">
      正在加载模块…
    </p>
    <template v-else-if="status === 'success' && data">
      <p v-if="!data.items.length" class="p-2 text-sm text-muted">
        {{ depth ? '暂无子模块' : '暂无模块，可通过管理模块整理产品结构。' }}
      </p>
      <div v-for="item in data.items" :key="item.id" class="min-w-0">
        <div class="flex min-w-0 items-start gap-1 rounded-md" :class="selected === String(item.id) ? 'bg-primary/10' : ''">
          <UButton
            v-if="item.child_count && depth < 2"
            :icon="expanded.includes(item.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            :aria-label="`${expanded.includes(item.id) ? '收起' : '展开'}${item.name}`"
            :aria-expanded="expanded.includes(item.id)"
            color="neutral"
            variant="ghost"
            size="sm"
            class="shrink-0"
            @click="toggle(item.id)"
          />
          <span v-else class="w-7 shrink-0" />
          <UButton
            :color="selected === String(item.id) ? 'primary' : 'neutral'"
            variant="ghost"
            size="sm"
            class="min-w-0 flex-1 justify-start whitespace-normal break-words text-left"
            :aria-pressed="selected === String(item.id)"
            @click="emit('select', { id: item.id, name: item.name })"
          >
            {{ item.name }}
          </UButton>
        </div>
        <StructureModuleTree
          v-if="expanded.includes(item.id)"
          :product-code="productCode"
          :parent-id="item.id"
          :selected="selected"
          :depth="depth + 1"
          class="ml-3 border-l border-default pl-1"
          @select="emit('select', $event)"
          @resolved="emit('resolved', $event)"
        />
      </div>
      <div v-if="data.total > pageSize" class="space-y-1 py-2">
        <p class="text-xs text-muted">
          本层共 {{ data.total }} 个模块 · 第 {{ page }} 页
        </p>
        <UPagination
          v-model:page="page"
          :items-per-page="pageSize"
          :total="data.total"
          :sibling-count="0"
          :show-edges="false"
          :ui="{ first: 'hidden', last: 'hidden', list: 'flex-wrap' }"
          size="xs"
        />
      </div>
    </template>
  </div>
</template>
