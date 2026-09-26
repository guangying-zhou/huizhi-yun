<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
import { projectModuleEnabled } from '../../app/utils/projectModuleConfig'
import { releaseStatusBadge } from '../../app/utils/projectDeliverablePresentation'

type Release = { id: number, product_code?: string, product_name?: string | null, version_code?: string, name?: string | null, status?: string, planned_release_date?: string | null, progress_percent?: number, feature_count?: number }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const objectContext = useProvidedEnterpriseProjectObjectContext()
if (!objectContext) throw new Error('企业项目版本缺少 Host 对象上下文')
type Project = { category?: string, moduleConfig?: unknown, module_config?: unknown }
const project = objectContext.project as Ref<Project | null>
const moduleEnabled = computed(() => projectModuleEnabled(
  project.value?.moduleConfig ?? project.value?.module_config,
  project.value?.category as Parameters<typeof projectModuleEnabled>[1],
  'releases'
))
const projectId = computed(() => String(route.params.id || ''))
const items = ref<Release[]>([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const loading = ref(false)
const error = ref('')
let requestSequence = 0
async function refresh() {
  const request = ++requestSequence
  error.value = ''
  items.value = []
  if (!project.value || !moduleEnabled.value) {
    loading.value = false
    total.value = 0
    return
  }
  loading.value = true
  try {
    const result = await $fetch<{ code: number, data?: { items?: Release[], total?: number, page?: number, pageSize?: number } }>(moduleUrl(`/api/v1/projects/${projectId.value}/releases`), { query: { page: page.value, pageSize } })
    if (request !== requestSequence) return
    if (result.code !== 0 || !Array.isArray(result.data?.items) || !Number.isSafeInteger(result.data.total) || result.data.total < 0 || result.data.page !== page.value || result.data.pageSize !== pageSize) throw new Error('项目版本暂不可用')
    items.value = result.data.items
    total.value = result.data.total
  } catch (cause) {
    if (request !== requestSequence) return
    items.value = []
    total.value = 0
    error.value = cause instanceof Error ? cause.message : '项目版本暂不可用'
  } finally {
    if (request === requestSequence) loading.value = false
  }
}
watch(projectId, () => {
  page.value = 1
})
watch([projectId, project, moduleEnabled, page], refresh, { immediate: true })
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <UButton
          :to="moduleUrl(`/projects/${projectId}`)"
          variant="link"
          color="neutral"
          icon="i-lucide-arrow-left"
        >
          返回项目
        </UButton>
        <h1 class="mt-1 text-2xl font-semibold text-highlighted">
          项目版本
        </h1>
        <p class="mt-1 text-sm text-muted">
          查看项目关联的产品版本及进度。
        </p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="soft"
        :loading="loading"
        @click="refresh"
      >
        刷新
      </UButton>
    </div>
    <UAlert
      v-if="error"
      color="error"
      title="无法读取项目版本"
      :description="error"
    />
    <USkeleton v-else-if="!project || loading" class="h-40 w-full" />
    <UAlert
      v-else-if="!moduleEnabled"
      color="neutral"
      title="版本模块未启用"
      description="当前项目未启用产品版本模块。"
    />
    <CommonEmptyState
      v-else-if="items.length === 0"
      icon="i-lucide-git-branch"
      title="暂无项目版本"
      description="当前项目没有可查看的版本。"
    />
    <div v-else class="grid gap-3">
      <UCard v-for="item in items" :key="item.id">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="font-medium text-highlighted">
              {{ item.name || item.version_code || item.id }}
            </p>
            <p class="mt-1 text-sm text-muted">
              {{ item.product_name || item.product_code || '产品' }} · {{ item.version_code || '-' }} · {{ item.progress_percent ?? 0 }}%
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UBadge :color="releaseStatusBadge(item.status).color" variant="soft">
              {{ releaseStatusBadge(item.status).label }}
            </UBadge>
            <UButton :to="moduleUrl(`/projects/${projectId}/releases/${item.id}`)" variant="soft" size="sm">
              查看摘要
            </UButton>
          </div>
        </div>
      </UCard>
    </div>
    <div v-if="project && moduleEnabled && !loading && !error" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ total }} 条</span>
      <UPagination
        v-model:page="page"
        :items-per-page="pageSize"
        :total="total"
        :sibling-count="1"
      />
    </div>
  </section>
</template>
