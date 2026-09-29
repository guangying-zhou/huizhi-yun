<script setup lang="ts">
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'
import { statusLabel, statusColor, typeLabel, priorityColor } from '../../app/config/requirement'
import { priorityConfig } from '../../app/config/work-item'
import type { Priority } from '../../app/types/aims'
import { useAimsModule } from '../useAimsModule'

type Requirement = { id: number, req_code?: string, reqCode?: string, title?: string, type?: string, priority?: string, status?: string }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const projectId = computed(() => String(route.params.id || ''))
const { page, pageSize } = useListPage({ pageSize: 20 })
const { search, debounced, flush } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const items = ref<Requirement[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ code?: number, data?: { items?: Requirement[], total?: number } | Requirement[] }>(moduleUrl(`/api/v1/projects/${projectId.value}/requirements`), { query: { page: page.value, pageSize, ...(debounced.value.trim() ? { search: debounced.value.trim() } : {}) } })
    if (response.code !== 0) throw Error('项目需求暂不可用')
    items.value = Array.isArray(response.data) ? response.data : (response.data?.items || [])
    total.value = Array.isArray(response.data) ? response.data.length : Number(response.data?.total || 0)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '项目需求暂不可用'
  } finally {
    loading.value = false
  }
}
watch(projectId, () => {
  if (page.value !== 1) page.value = 1
  else refresh()
})
watch([page, debounced], refresh)
onMounted(refresh)
</script>

<template>
  <UDashboardPanel id="enterprise-project-requirements" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar>
          <template #actions>
            <UButton
              aria-label="刷新"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              :loading="loading"
              @click="refresh"
            />
          </template>
        </ProjectNavbar>
        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-4 sm:px-6">
          <section class="space-y-5">
            <div class="flex gap-2">
              <UInput v-model="search" placeholder="搜索编号或标题" @keyup.enter="flush" /><UButton :loading="loading" @click="flush">
                查询
              </UButton>
            </div><UAlert
              v-if="error"
              color="error"
              title="无法读取需求"
              :description="error"
            /><UTable :data="items" :loading="loading" :columns="[{ accessorKey: 'reqCode', header: '编号' }, { accessorKey: 'title', header: '标题' }, { accessorKey: 'type', header: '类型' }, { accessorKey: 'priority', header: '优先级' }, { accessorKey: 'status', header: '状态' }]">
              <template #reqCode-cell="{ row }">
                <NuxtLink class="font-medium text-primary hover:underline" :to="moduleUrl(`/projects/${projectId}/requirements/${row.original.id}`)">{{ row.original.reqCode || row.original.req_code || row.original.id }}</NuxtLink>
              </template><template #type-cell="{ row }">
                {{ typeLabel[row.original.type || ''] || row.original.type || '-' }}
              </template>
              <template #priority-cell="{ row }">
                <UBadge :color="priorityColor[row.original.priority || ''] || 'neutral'" variant="subtle">
                  {{ priorityConfig[row.original.priority as Priority]?.label || row.original.priority || '-' }}
                </UBadge>
              </template>
              <template #status-cell="{ row }">
                <UBadge :color="statusColor[row.original.status || ''] || 'neutral'" variant="subtle">
                  {{ statusLabel[row.original.status || ''] || row.original.status || '-' }}
                </UBadge>
              </template>
              <template #empty>
                <CommonEmptyState icon="i-lucide-list-checks" title="暂无项目需求" description="当前条件下没有可访问需求。" />
              </template>
            </UTable>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="text-sm text-muted">共 {{ total }} 条</span>
              <UPagination v-model:page="page" :items-per-page="pageSize" :total="total" />
            </div>
          </section>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
