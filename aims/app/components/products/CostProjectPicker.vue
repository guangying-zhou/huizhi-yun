<script setup lang="ts">
const props = defineProps<{ productCode: string, disabled?: boolean }>()
interface Project { id: number, project_code: string, name: string, category?: string, lifecycle_status?: string }
const selected = defineModel<Project | null>({ default: null })
const page = ref(1)
const pageSize = 20
const { search, debounced, flush } = useDebouncedSearch({
  onChange: () => {
    page.value = 1
  }
})
const { data, status, error, refresh } = await useFetch('/api/v1/projects', {
  server: false,
  query: computed(() => ({ search: debounced.value || undefined, page: page.value, pageSize })),
  transform: (response: { code: number, data: { items: Project[], total: number } }) => {
    const result = response.data
    if (response.code !== 0 || !Array.isArray(result?.items) || !Number.isSafeInteger(result.total) || result.total < 0 || result.items.some(item => !Number.isSafeInteger(item.id) || item.id < 1 || !item.project_code || typeof item.name !== 'string')) throw new Error('项目列表响应不完整')
    return result
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '经营项目加载失败' })
watch(() => props.productCode, () => {
  selected.value = null
  page.value = 1
})
</script>

<template>
  <section class="min-w-0 space-y-3">
    <h2 class="font-semibold">
      选择经营项目
    </h2>
    <p class="text-sm text-muted">
      展示你可见的项目，可查询历史期间。读取成本时还会核验 Finance 项目权限和产品分摊规则。
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
        description="请更换搜索词，或确认你具有项目查看权限。"
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
