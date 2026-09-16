<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

interface Item { biz_id: string, product_code: string, title: string, scope_summary: string, lifecycle: string, revision: number }
const props = defineProps<{ productCode: string, workspaceRevision: number, cycle: ProductPlanningCycle }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const code = props.productCode, cycleId = props.cycle.biz_id
const page = ref(1), pageSize = 10, lifecycle = ref('proposed')
const { search, debounced, flush, reset } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
watch(lifecycle, () => {
  page.value = 1
})
const query = computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined, lifecycle: lifecycle.value }))
const { data, status, error: listError, refresh } = await useFetch(`/api/v1/products/${encodeURIComponent(code)}/planning-items`, {
  server: false, query,
  transform: (response: { code: number, data: { items: Item[], total: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(item => item.product_code !== code || !item.biz_id || !Number.isSafeInteger(item.revision) || item.revision < 1)) throw new Error('规划事项响应不完整')
    return response.data
  }
})
const selected = ref<Item | null>(null), busy = ref(false), error = ref<Error | null>(null)
const versions = ref({ expectedRevision: props.workspaceRevision, expectedCycleRevision: props.cycle.revision })
const listAlert = useApiErrorAlert(listError, { fallbackTitle: '可选事项加载失败' })
const alert = useApiErrorAlert(error, { fallbackTitle: '添加候选失败' })
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
async function reread() {
  if (busy.value || !selected.value) return
  busy.value = true
  error.value = null
  try {
    const [cycle, item] = await Promise.all([
      $fetch<{ code: number, data: ProductPlanningCycle & { workspace_revision: number } }>(`/api/v1/products/${encodeURIComponent(code)}/planning-cycles/${cycleId}`, { timeout: 15000 }),
      $fetch<{ code: number, data: Item }>(`/api/v1/products/${encodeURIComponent(code)}/planning-items/${selected.value.biz_id}`, { timeout: 15000 })
    ])
    if (cycle.code !== 0 || cycle.data?.biz_id !== cycleId || cycle.data.product_code !== code || !['draft', 'open'].includes(cycle.data.status) || !Number.isSafeInteger(cycle.data.revision) || cycle.data.revision < 1 || !Number.isSafeInteger(cycle.data.workspace_revision) || cycle.data.workspace_revision < 1) throw new Error('周期已关闭或不可读取，请返回周期列表核对')
    if (item.code !== 0 || item.data?.biz_id !== selected.value.biz_id || item.data.product_code !== code || !['proposed', 'in_delivery'].includes(item.data.lifecycle) || !Number.isSafeInteger(item.data.revision) || item.data.revision < 1) throw new Error('事项已变化且不可添加，请重新选择')
    selected.value = item.data
    versions.value = { expectedRevision: cycle.data.workspace_revision, expectedCycleRevision: cycle.data.revision }
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('刷新选择失败')
  } finally {
    busy.value = false
  }
}
async function save() {
  if (busy.value || !selected.value) return
  error.value = null
  const body = { ...versions.value, itemId: selected.value.biz_id, expectedItemRevision: selected.value.revision }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    const response = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(code)}/planning-cycles/${cycleId}/items`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('添加结果不完整，请重试')
    busy.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('添加候选失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="min-w-0 space-y-4">
    <h1 class="break-words text-xl font-semibold">
      添加候选：{{ cycle.title }}
    </h1>
    <p class="text-sm text-muted">
      从已有规划事项中选择。添加后进入候选集合；已存在的事项保留原选择结果和顺序。
    </p>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="flush">
      <UFormField label="搜索规划事项" class="min-w-0 flex-1 basis-48">
        <UInput
          v-model="search"
          :disabled="busy"
          class="w-full"
          placeholder="标题或范围"
        />
      </UFormField>
      <UFormField label="事项阶段">
        <USelect v-model="lifecycle" :disabled="busy" :items="[{ label: '待规划', value: 'proposed' }, { label: '交付中', value: 'in_delivery' }]" />
      </UFormField>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        :disabled="busy"
        @click="reset(); page = 1; refresh()"
      >
        刷新列表
      </UButton>
    </form>
    <UAlert v-if="listAlert" v-bind="listAlert" />
    <p v-if="status === 'pending'" role="status">
      正在加载规划事项…
    </p>
    <div v-if="status === 'success'" class="space-y-3">
      <div v-for="item in data?.items || []" :key="item.biz_id" class="space-y-2 rounded-lg border border-default p-3">
        <p class="break-words font-medium">
          {{ item.title }}
        </p>
        <p class="whitespace-pre-wrap break-words text-sm text-muted">
          {{ item.scope_summary }}
        </p>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="busy || !['proposed', 'in_delivery'].includes(item.lifecycle)"
          :aria-pressed="selected?.biz_id === item.biz_id"
          @click="selected = item"
        >
          {{ selected?.biz_id === item.biz_id ? '已选择' : '选择此事项' }}
        </UButton>
      </div>
      <CommonEmptyState
        v-if="!data?.items.length"
        icon="i-lucide-search"
        title="暂无符合条件的事项"
        description="可调整关键词或事项阶段。"
      />
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-muted">共 {{ data?.total || 0 }} 个事项</span>
        <UPagination
          v-model:page="page"
          :total="data?.total || 0"
          :items-per-page="pageSize"
          :sibling-count="0"
          :disabled="busy"
        />
      </div>
    </div>
    <div v-if="selected" class="space-y-2 rounded-lg border border-default p-3">
      <p class="break-words font-medium">
        已选择：{{ selected.title }}
      </p>
      <p class="whitespace-pre-wrap break-words text-sm">
        {{ selected.scope_summary }}
      </p>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="reread"
      >
        刷新所选事项与周期
      </UButton>
      <p class="text-sm text-muted">
        若提示版本冲突，请刷新并核对上方范围后重新提交。
      </p>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <div class="flex flex-wrap gap-3">
      <UButton :loading="busy" :disabled="!selected" @click="save">
        添加到周期候选
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="emit('cancel')"
      >
        返回候选列表
      </UButton>
    </div>
  </div>
</template>
