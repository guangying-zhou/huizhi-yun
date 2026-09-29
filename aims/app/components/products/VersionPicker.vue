<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

const { moduleUrl, hosted, cacheKey } = useAimsModule()
const props = defineProps<{ productCode: string, disabled?: boolean, searchLabel?: string, includePublished?: boolean, simpleOnly?: boolean }>()
interface Version { id: number, product_code: string, version_code: string, name: string | null, status: string, revision: number, planning_mode?: 'simple' | 'cycle' }
const selected = defineModel<Version | null>({ required: true })
const page = ref(1), pageSize = 20
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const { data, status, error, refresh } = useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/versions`), { ...(hosted ? { key: computed(() => cacheKey('aims/app/components/products/VersionPicker.vue:0' + ':' + String(toValue(() => moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/versions`))))) } : {}), server: false, query: computed(() => ({ page: page.value, pageSize, keyword: debounced.value || undefined })), transform: (response: { code: number, data: { items: Version[], total: number } }) => {
  if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(v => v.product_code !== props.productCode || !Number.isSafeInteger(v.id) || v.id < 1 || !Number.isSafeInteger(v.revision) || v.revision < 1 || !['planning', 'developing', 'released', 'archived'].includes(v.status) || (v.planning_mode !== undefined && !['simple', 'cycle'].includes(v.planning_mode)))) throw new Error('版本选择列表无效')
  return response.data
} })
const alert = useApiErrorAlert(error, { fallbackTitle: '版本列表加载失败' })
watch(() => props.productCode, () => {
  selected.value = null
  page.value = 1
  search.value = ''
})
</script>

<template>
  <div class="min-w-0 space-y-3">
    <UFormField :label="searchLabel || '搜索目标版本'">
      <UInput
        v-model="search"
        class="w-full"
        :disabled="disabled"
        placeholder="版本号或名称"
        @keydown.enter.prevent="flush"
      />
    </UFormField>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      v-if="error"
      color="neutral"
      variant="outline"
      :disabled="disabled"
      @click="refresh()"
    >
      重新读取版本
    </UButton>
    <p v-if="status === 'pending'" role="status">
      正在加载版本…
    </p>
    <p v-if="selected" class="break-words text-sm">
      已选：{{ selected.version_code }} {{ selected.name }}
    </p>
    <template v-if="status === 'success' && data">
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-package"
        title="暂无符合条件的版本"
        description="先在版本计划中创建版本，或调整搜索条件。"
      />
      <div v-for="version in data.items" :key="version.id" class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border border-default p-3">
        <span class="min-w-0 break-words text-sm">{{ version.version_code }} {{ version.name }}</span>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="disabled || (!includePublished && !['planning', 'developing'].includes(version.status)) || (simpleOnly && version.planning_mode !== 'simple')"
          @click="selected = version"
        >
          {{ selected?.id === version.id ? '已选择' : simpleOnly && version.planning_mode !== 'simple' ? '使用高级规划' : includePublished || ['planning', 'developing'].includes(version.status) ? '选择版本' : '已发布或归档' }}
        </UButton>
      </div>
      <p class="text-sm text-muted">
        共 {{ data.total }} 个版本
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
  </div>
</template>
