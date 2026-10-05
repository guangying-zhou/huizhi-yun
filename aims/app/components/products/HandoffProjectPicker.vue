<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

const { moduleUrl, cacheKey, hosted } = useAimsModule()
const props = defineProps<{ productCode: string, disabled?: boolean }>()
interface Project { id: number, project_code: string, name: string, category: string, lifecycle_status: string }
const selected = defineModel<Project | null>({ default: null })
const page = ref(1)
const pageSize = 20
const { search, debounced, flush } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const { data, status, error, refresh } = useFetch(() => hosted ? moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/handoff/projects`) : '/api/v1/projects', {
  server: false, key: computed(() => cacheKey('handoff-projects:' + props.productCode)),
  query: computed(() => ({ ...(hosted ? {} : { product_code: props.productCode, category: 'product_dev', lifecycle_status: 'active' }), search: debounced.value || undefined, page: page.value, pageSize })),
  transform: (response: { code: number, data: { items: Project[], total: number } }) => {
    const result = response.data
    if (response.code !== 0 || !Array.isArray(result?.items) || !Number.isSafeInteger(result.total) || result.total < 0 || result.items.some(item => !Number.isSafeInteger(item.id) || item.id < 1 || !item.project_code || typeof item.name !== 'string' || item.category !== 'product_dev' || item.lifecycle_status !== 'active')) throw new Error('项目列表响应不完整')
    return result
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '目标项目加载失败' })
watch(() => props.productCode, () => {
  selected.value = null
  page.value = 1
})
</script>

<template>
  <section class="min-w-0 space-y-3">
    <h2 class="font-semibold">
      目标研发项目
    </h2>
    <p class="text-sm text-muted">
      仅展示你可见、已关联当前产品且处于启用状态的研发项目。提交时还会核验项目需求编辑权限。
    </p>
    <div v-if="selected" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary p-3">
      <p class="min-w-0 break-words">
        已选：{{ selected.name }} · {{ selected.project_code }}
      </p>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="disabled"
        @click="selected = null"
      >
        清除选择
      </UButton>
    </div>
    <form class="flex flex-wrap items-end gap-2" @submit.prevent="flush">
      <UFormField label="搜索项目" class="min-w-0 flex-1">
        <UInput
          v-model="search"
          class="w-full"
          placeholder="项目名称或编码"
          :disabled="disabled"
        />
      </UFormField>
      <UButton
        color="neutral"
        variant="outline"
        :loading="status === 'pending'"
        :disabled="disabled"
        @click="refresh()"
      >
        刷新项目
      </UButton>
    </form>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载项目…
    </p>
    <template v-if="status === 'success' && data">
      <p class="text-sm text-muted">
        共 {{ data.total }} 个项目
      </p>
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-folder-search"
        title="本页没有可选项目"
        description="请确认目标项目已启用并关联当前产品，或更换搜索词。"
      />
      <div v-for="project in data.items" :key="project.id" class="flex flex-wrap items-center justify-between gap-2 border-b border-default py-3">
        <p class="min-w-0 break-words">
          {{ project.name }} · {{ project.project_code }}
        </p>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="disabled || selected?.id === project.id"
          @click="selected = project"
        >
          {{ selected?.id === project.id ? '已选择' : '选择项目' }}
        </UButton>
      </div>
      <UPagination
        v-if="data.total > pageSize"
        v-model:page="page"
        :items-per-page="pageSize"
        :total="data.total"
        :sibling-count="0"
        :disabled="disabled"
      />
    </template>
  </section>
</template>
