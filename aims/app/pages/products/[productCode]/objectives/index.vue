<script setup lang="ts">
import { objectiveStates as states, objectivePositive as positive, validProductObjective, type ProductObjective as Objective } from '~/utils/productObjectiveView'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '产品目标', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}/objectives`)
interface ObjectivePage { items: Objective[], total: number, page: number, pageSize: number, workspace_revision: number }
const state = ref('all')
const { page, pageSize } = useListPage({ pageSize: 20, filters: { status: state }, defaults: { status: 'all' } })
const query = computed(() => ({ page: page.value, pageSize, status: state.value === 'all' ? undefined : state.value }))
const { data, status, error, refresh } = await useFetch(base, {
  server: false, query,
  transform: (response: { code: number, data: ObjectivePage }) => {
    const result = response.data
    if (response.code !== 0 || !result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page.value || result.pageSize !== pageSize || !positive(result.workspace_revision) || result.items.length > pageSize || result.items.length > result.total || new Set(result.items.map(item => item.id)).size !== result.items.length || result.items.some(item => !validProductObjective(item, code.value) || (state.value !== 'all' && item.status !== state.value))) throw new Error('目标列表响应不完整，请刷新')
    return result
  }
})
const { data: permission, status: permissionStatus, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, revision: number, edit: boolean } }>(() => `${base.value}/permissions`, { server: false })
const canCreate = computed(() => status.value === 'success' && permissionStatus.value === 'success' && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.edit === true && permission.value.data.revision === data.value?.workspace_revision)
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '目标权限加载失败' })
async function reload() {
  await Promise.all([refresh(), refreshPermission()])
}
const alert = useApiErrorAlert(error, { fallbackTitle: '产品目标加载失败' })
const filters = [{ label: '全部状态', value: 'all' }, ...Object.entries(states).map(([value, label]) => ({ label, value }))]
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <p class="text-sm text-muted">
      用明确的期间、基线与目标值描述产品结果。目标是否达成由实际指标观测判断。
    </p>
    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="目标状态" class="w-full sm:w-48">
        <USelect v-model="state" :items="filters" class="w-full" />
      </UFormField>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="status === 'pending'"
        @click="reload()"
      >
        刷新
      </UButton>
    </div>
    <UButton v-if="canCreate" :to="`/products/${encodeURIComponent(code)}/objectives/new`" icon="i-lucide-plus">
      创建目标
    </UButton>
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在加载产品目标…
    </p>
    <template v-else-if="status === 'success' && data">
      <p class="text-sm text-muted">
        共 {{ data.total }} 个目标
      </p>
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-target"
        :title="state === 'all' ? '暂无产品目标' : '暂无此状态的目标'"
        :description="state === 'all' ? '产品目标用于记录预期结果、测量口径与实际观测。' : '可切换全部状态查看其他目标。'"
      />
      <div v-else class="space-y-3">
        <UCard v-for="objective in data.items" :key="objective.biz_id" as="article">
          <UButton :to="`/products/${encodeURIComponent(code)}/objectives/${objective.id}`" variant="link" class="mb-2">
            查看目标与观测
          </UButton>
          <div class="flex flex-wrap items-start justify-between gap-2">
            <h2 class="min-w-0 flex-1 break-words font-semibold">
              {{ objective.title }}
            </h2>
            <UBadge color="neutral" variant="subtle">
              {{ states[objective.status] }}
            </UBadge>
          </div>
          <p class="mt-1 text-sm text-muted">
            {{ objective.starts_on }} 至 {{ objective.ends_on }}
          </p>
          <p v-if="objective.description" class="mt-3 whitespace-pre-wrap break-words text-sm">
            {{ objective.description }}
          </p>
          <dl class="mt-4 grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div class="min-w-0">
              <dt class="text-muted">
                衡量指标
              </dt><dd class="break-words">
                {{ objective.metric.name }}（{{ objective.metric.unit }}）
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted">
                基线
              </dt><dd class="break-all tabular-nums">
                {{ objective.metric.baseline_value }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-muted">
                {{ objective.metric.direction === 'increase' ? '提高至' : '降低至' }}
              </dt><dd class="break-all tabular-nums">
                {{ objective.metric.target_value }}
              </dd>
            </div>
          </dl>
          <p class="mt-3 whitespace-pre-wrap break-words text-sm text-muted">
            测量口径：{{ objective.metric.measurement_definition }}
          </p>
        </UCard>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-muted">每页 {{ pageSize }} 个</span>
        <UPagination
          v-model:page="page"
          :items-per-page="pageSize"
          :total="data.total"
          :sibling-count="1"
        />
      </div>
    </template>
  </div>
</template>
