<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

const { moduleUrl, hosted, cacheKey } = useAimsModule()
/** 在模块树中选择归属；模块是可选分类，不把它变成创建需求的前置条件。 */
const props = withDefaults(defineProps<{
  productCode: string
  modelValue: number | null
  disabled?: boolean
  allowUnassigned?: boolean
  initialLabel?: string
}>(), { disabled: false, allowUnassigned: true, initialLabel: '' })
const emit = defineEmits<{ 'update:modelValue': [value: number | null], 'selected': [value: { id: number | null, name: string }] }>()
interface ComponentRow { id: number, name: string, product_code: string, parent_id: number | null, child_count: number }
const trail = ref<{ id: number, name: string }[]>([])
const parentId = computed(() => trail.value.at(-1)?.id ?? null)
const page = ref(1)
const pageSize = 20
const selected = ref<{ id: number | null, name: string } | null>(props.modelValue === null ? { id: null, name: '未分类' } : props.initialLabel ? { id: props.modelValue, name: props.initialLabel } : null)
const { data, status, error, refresh } = useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/components`), { ...(hosted ? { key: computed(() => cacheKey('aims/app/components/products/ComponentPicker.vue:0' + ':' + String(toValue(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/components`))))) } : {}),
  server: false,
  query: computed(() => ({ parentId: parentId.value ?? undefined, page: page.value, pageSize })),
  transform: (response: { code: number, data: { items: ComponentRow[], total: number, parent_id: number | null } }) => {
    if (response.code !== 0 || response.data?.parent_id !== parentId.value || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(item => !Number.isSafeInteger(item.id) || item.id < 1 || item.product_code !== props.productCode || item.parent_id !== parentId.value || !item.name.trim())) throw new Error('模块选择列表响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '模块列表加载失败' })
function select(value: { id: number | null, name: string }) {
  if (props.disabled) return
  selected.value = value
  emit('update:modelValue', value.id)
  emit('selected', value)
}
function enter(item: ComponentRow) {
  if (props.disabled || item.child_count < 1) return
  page.value = 1
  trail.value = [...trail.value, { id: item.id, name: item.name }]
}
function back(depth: number) {
  if (props.disabled) return
  page.value = 1
  trail.value = trail.value.slice(0, depth)
}
watch(() => props.modelValue, (value) => {
  if (value === null) selected.value = { id: null, name: '未分类' }
  else if (selected.value?.id !== value) selected.value = props.initialLabel ? { id: value, name: props.initialLabel } : { id: value, name: `模块 #${value}` }
})
watch(() => props.productCode, () => {
  trail.value = []
  page.value = 1
  selected.value = props.modelValue === null ? { id: null, name: '未分类' } : null
})
</script>

<template>
  <div class="min-w-0 space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="disabled || !trail.length"
        @click="back(0)"
      >
        全部模块
      </UButton>
      <template v-for="(item, index) in trail" :key="item.id">
        <span aria-hidden="true" class="text-muted">/</span>
        <UButton
          color="neutral"
          variant="link"
          size="sm"
          :disabled="disabled || index === trail.length - 1"
          @click="back(index + 1)"
        >
          {{ item.name }}
        </UButton>
      </template>
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        :loading="status === 'pending'"
        :disabled="disabled"
        @click="refresh()"
      >
        刷新
      </UButton>
    </div>
    <p class="text-sm text-muted">
      当前选择：{{ selected?.name || '尚未选择' }}
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      v-if="allowUnassigned"
      color="neutral"
      variant="outline"
      size="sm"
      :disabled="disabled"
      @click="select({ id: null, name: '未分类' })"
    >
      不分类
    </UButton>
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在加载模块…
    </p>
    <template v-else-if="data">
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-folder-tree"
        title="当前层级暂无模块"
        description="可返回上一级选择其他模块。"
      />
      <div v-for="item in data.items" :key="item.id" class="flex min-w-0 flex-wrap items-center gap-2 rounded border border-default p-2">
        <span class="min-w-0 flex-1 break-words text-sm">{{ item.name }}</span>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="disabled"
          @click="select({ id: item.id, name: item.name })"
        >
          {{ selected?.id === item.id ? '已选择' : '选择' }}
        </UButton>
        <UButton
          v-if="item.child_count"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="disabled"
          @click="enter(item)"
        >
          子模块
        </UButton>
      </div>
      <UPagination
        v-if="data.total > pageSize"
        v-model:page="page"
        :total="data.total"
        :items-per-page="pageSize"
        :sibling-count="0"
        :disabled="disabled"
      />
    </template>
  </div>
</template>
