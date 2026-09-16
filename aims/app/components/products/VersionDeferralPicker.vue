<script setup lang="ts">
import type { ProductVersionScope } from '~/types/productVersionScope'

const props = defineProps<{ productCode: string, targetVersionId?: number, disabled?: boolean }>()
const selected = defineModel<{ versionId: number, scopeId: number, expectedVersionRevision: number, expectedScopeRevision: number, label: string } | null>({ required: true })
const version = ref<{ id: number, product_code: string, version_code: string, name: string | null, status: string, revision: number } | null>(null)
const page = ref(1), pageSize = 20
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const endpoint = computed(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/versions/${version.value?.id || 0}/features`)
const { data, status, error, refresh, clear } = await useFetch(endpoint, {
  immediate: false, server: false, watch: false,
  query: computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined })),
  transform: (response: { code: number, data: { items: ProductVersionScope[], total: number, version_revision: number, scope_revision: number } }) => {
    const result = response.data
    if (response.code !== 0 || !Array.isArray(result?.items) || !Number.isSafeInteger(result.total) || result.total < 0 || ![result.version_revision, result.scope_revision].every(n => Number.isSafeInteger(n) && n > 0) || result.items.some(item => item.version_id !== version.value?.id || !Number.isSafeInteger(item.id) || item.id < 1)) throw new Error('原版本范围响应无效')
    return result
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '原范围读取失败' })
watch([() => props.productCode, () => props.targetVersionId], () => {
  version.value = null
  selected.value = null
})
watch(version, () => {
  clear()
  selected.value = null
  page.value = 1
  search.value = ''
  if (version.value) refresh()
})
watch([page, debounced], () => {
  if (version.value) refresh()
})
watch(data, (value) => {
  if (selected.value && (!value || selected.value.expectedVersionRevision !== value.version_revision || selected.value.expectedScopeRevision !== value.scope_revision)) selected.value = null
})
function select(item: ProductVersionScope) {
  if (props.disabled || status.value !== 'success' || !data.value || !version.value || version.value.id === props.targetVersionId || item.version_id !== version.value.id || !data.value.items.some(row => row.id === item.id && row.version_id === item.version_id) || item.status !== 'planned') return
  selected.value = { versionId: version.value.id, scopeId: item.id, expectedVersionRevision: data.value.version_revision, expectedScopeRevision: data.value.scope_revision, label: `${version.value.version_code} · ${item.title}` }
}
</script>

<template>
  <section class="min-w-0 space-y-3 rounded-lg border border-default p-4">
    <h2 class="font-medium">
      选择延期来源
    </h2>
    <p class="text-sm text-muted">
      原范围将保留并标记顺延，新范围使用当前规划事项；原版本需要重新验收。
    </p>
    <ProductsVersionPicker
      v-model="version"
      search-label="搜索原版本"
      :product-code="productCode"
      :disabled="disabled"
    />
    <UAlert v-if="version?.id === targetVersionId" color="warning" title="原版本必须与目标版本不同" />
    <template v-if="version && version.id !== targetVersionId">
      <UFormField label="搜索原范围">
        <UInput
          v-model="search"
          :disabled="disabled"
          class="w-full"
          @keydown.enter.prevent="flush"
        />
      </UFormField>
      <UAlert v-if="alert" v-bind="alert" />
      <UButton
        v-if="error"
        color="neutral"
        :disabled="disabled"
        @click="refresh()"
      >
        重新读取原范围
      </UButton>
      <p v-if="status === 'pending'" role="status">
        正在加载原范围…
      </p>
      <p v-if="selected" class="break-words text-sm">
        已选来源：{{ selected.label }}
      </p>
      <template v-if="status === 'success' && data">
        <CommonEmptyState
          v-if="!data.items.length"
          icon="i-lucide-list"
          title="没有符合条件的范围"
          description="请调整搜索条件或选择其他版本。"
        />
        <div v-for="item in data.items" :key="item.id" class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border border-default p-3">
          <span class="min-w-0 break-words text-sm">{{ item.title }}</span>
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="disabled || item.status !== 'planned'"
            @click="select(item)"
          >
            {{ selected?.scopeId === item.id ? '已选择' : item.status === 'planned' ? '选择原范围' : '不可延期' }}
          </UButton>
        </div>
        <p class="text-sm text-muted">
          共 {{ data.total }} 条范围
        </p>
        <UPagination
          v-if="data.total > pageSize"
          v-model:page="page"
          :items-per-page="pageSize"
          :total="data.total"
          :disabled="disabled"
          :sibling-count="0"
        />
      </template>
    </template>
  </section>
</template>
