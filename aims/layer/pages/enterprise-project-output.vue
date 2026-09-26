<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
import { deliverableStatusBadge, deliverableTypeBadge, qualityStatusBadge } from '../../app/utils/projectDeliverablePresentation'

type Deliverable = { id: number, name: string, deliverableType?: string, status?: string, qualityStatus?: string, acceptanceCriteria?: string | null, documentTitle?: string | null, targetTitle?: string | null }
type Response = { code: number, data?: { items?: Deliverable[], total?: number, page?: number, pageSize?: number } }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const projectId = computed(() => String(route.params.id || ''))
const items = ref<Deliverable[]>([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const loading = ref(false)
const error = ref('')
let requestSequence = 0

async function refresh() {
  const request = ++requestSequence
  loading.value = true
  error.value = ''
  items.value = []
  try {
    const result = await $fetch<Response>(moduleUrl('/api/v1/deliverables'), { query: { project_id: projectId.value, page: page.value, pageSize } })
    if (request !== requestSequence) return
    if (result.code !== 0 || !Array.isArray(result.data?.items) || !Number.isSafeInteger(result.data.total) || result.data.total < 0 || result.data.page !== page.value || result.data.pageSize !== pageSize) throw new Error('项目交付物暂不可用')
    items.value = result.data.items
    total.value = result.data.total
  } catch (cause) {
    if (request !== requestSequence) return
    items.value = []
    total.value = 0
    error.value = cause instanceof Error ? cause.message : '项目交付物暂不可用'
  } finally {
    if (request === requestSequence) loading.value = false
  }
}
watch(projectId, () => {
  if (page.value === 1) refresh()
  else page.value = 1
})
watch(page, refresh)
onMounted(refresh)
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
          项目产出
        </h1>
        <p class="mt-1 text-sm text-muted">
          查看交付物及其提交状态。
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
      title="无法读取交付物"
      :description="error"
    />
    <USkeleton v-if="loading" class="h-40 w-full" />
    <CommonEmptyState
      v-else-if="!error && items.length === 0"
      icon="i-lucide-package-open"
      title="暂无交付物"
      description="当前项目没有可查看的交付物。"
    />
    <div v-else-if="!error" class="grid gap-3">
      <UCard v-for="item in items" :key="item.id">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="font-medium text-highlighted">
              {{ item.name }}
            </p>
            <p class="mt-1 text-sm text-muted">
              {{ item.targetTitle || item.documentTitle || '交付物' }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UBadge :color="deliverableTypeBadge(item.deliverableType).color" variant="soft">
              {{ deliverableTypeBadge(item.deliverableType).label }}
            </UBadge>
            <UBadge :color="deliverableStatusBadge(item.status).color" variant="soft">
              {{ deliverableStatusBadge(item.status).label }}
            </UBadge>
            <UBadge :color="qualityStatusBadge(item.qualityStatus, item.status).color" variant="soft">
              {{ qualityStatusBadge(item.qualityStatus, item.status).label }}
            </UBadge>
            <UButton :to="moduleUrl(`/projects/${projectId}/output/${item.id}`)" variant="soft" size="sm">
              查看详情
            </UButton>
          </div>
        </div>
      </UCard>
    </div>
    <div v-if="!error && !loading" class="flex flex-wrap items-center justify-between gap-3">
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
