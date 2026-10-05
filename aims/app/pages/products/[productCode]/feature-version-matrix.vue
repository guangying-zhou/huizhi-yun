<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { validFeatureReleaseEvidence, type FeatureReleaseEvidence } from '~/utils/productFeatureReleaseEvidence'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '功能版本矩阵', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const versionPerspectiveQuery = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const code = computed(() => String(route.params.productCode || ''))
type Version = { id: number, product_code: string, version_code: string, name: string | null, status: string, revision: number }
type Cell = { latest_release: FeatureReleaseEvidence | null, version_id: number, scope_id: number | null, planned: number, delivered: number, deferred: number, deferred_from_scope_id: number | null, deferred_from_version_id: number | null }
type Row = { feature_biz_id: string, title: string, cells: Cell[] }
type Matrix = { product_code: string, workspace_revision: number, version_ids: number[], items: Row[], total: number, page: number, pageSize: number }
const choice = ref<Version | null>(null), versions = ref<Version[]>([]), page = ref(1)
const columns = computed<TableColumn<Row>[]>(() => [{ id: 'feature', header: '功能' }, ...versions.value.map(version => ({ id: `v${version.id}`, header: version.version_code }))])
const { data, status, error, refresh } = await useAsyncData(() => `feature-version-matrix:${code.value}`, async () => {
  if (!versions.value.length) return null
  const ids = versions.value.map(version => version.id)
  const response = await $fetch<{ code: number, data: Matrix }, string>(`/api/v1/products/${encodeURIComponent(code.value)}/roadmaps/feature-version-matrix`, { query: { versionIds: ids.join(','), page: page.value, pageSize: 20 }, timeout: 15000 })
  const value = response.data
  const positive = (n: number | null) => n !== null && Number.isSafeInteger(n) && n > 0
  if (response.code !== 0 || !value || value.product_code !== code.value || !positive(value.workspace_revision) || !Array.isArray(value.version_ids) || value.version_ids.join(',') !== ids.join(',') || value.page !== page.value || value.pageSize !== 20 || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.items) || value.items.length !== Math.min(20, Math.max(0, value.total - (page.value - 1) * 20)) || new Set(value.items.map(row => row.feature_biz_id)).size !== value.items.length || value.items.some(row => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.feature_biz_id) || typeof row.title !== 'string' || !row.title.trim() || !Array.isArray(row.cells) || row.cells.length !== ids.length || row.cells.some((cell, index) => cell.version_id !== ids[index] || !validFeatureReleaseEvidence(cell.latest_release, cell.version_id) || ![cell.planned, cell.delivered, cell.deferred].every(n => n === 0 || n === 1) || cell.planned + cell.delivered + cell.deferred !== (cell.scope_id === null ? 0 : 1) || (cell.scope_id !== null && !positive(cell.scope_id)) || (cell.deferred_from_scope_id === null ? cell.deferred_from_version_id !== null : !positive(cell.deferred_from_scope_id) || !positive(cell.deferred_from_version_id) || cell.scope_id === null)))) throw new Error('功能版本矩阵响应不完整')
  return value
}, { server: false, watch: [versions, page] })
const alert = useApiErrorAlert(error, { fallbackTitle: '矩阵读取失败' })
const busy = computed(() => status.value === 'pending')
function add() {
  if (busy.value || !choice.value || versions.value.length >= 10 || versions.value.some(version => version.id === choice.value!.id)) return
  page.value = 1
  versions.value = [...versions.value, choice.value]
  choice.value = null
}
function remove(id: number) {
  if (busy.value) return
  page.value = 1
  versions.value = versions.value.filter(version => version.id !== id)
}
watch(code, () => {
  versions.value = []
  choice.value = null
  page.value = 1
})
</script>

<template>
  <div class="mx-auto min-w-0 max-w-7xl space-y-4 p-4 sm:p-6">
    <ProductsVersionTools :product-code="code" />
    <p class="text-sm text-muted">
      选择最多 10 个版本，列顺序按添加顺序保留。这里展示当前范围状态；已交付不等于已发布或已部署。
    </p>
    <ProductsVersionPicker
      v-model="choice"
      :product-code="code"
      include-published
      :disabled="busy"
      search-label="搜索要加入矩阵的版本"
    />
    <UButton :disabled="busy || !choice || versions.length >= 10 || versions.some(v => v.id === choice?.id)" @click="add">
      加入矩阵
    </UButton>
    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="version in versions"
        :key="version.id"
        color="neutral"
        variant="outline"
        :disabled="busy"
        :aria-label="`移除版本 ${version.version_code}`"
        @click="remove(version.id)"
      >
        {{ version.version_code }} ×
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      v-if="versions.length"
      :loading="busy"
      color="neutral"
      variant="outline"
      @click="refresh()"
    >
      刷新矩阵
    </UButton>
    <CommonEmptyState
      v-if="!versions.length"
      icon="i-lucide-table-properties"
      title="尚未选择版本"
      description="从上方选择版本并加入矩阵。"
    />
    <template v-else>
      <p class="text-sm text-muted sm:hidden">
        左右滑动比较各版本，功能列与版本列保留完整宽度。
      </p>
      <UTable :data="status === 'success' ? data?.items ?? [] : []" :columns="columns" :loading="busy">
        <template #feature-cell="{ row }">
          <UButton :to="`/products/${encodeURIComponent(code)}/features/${row.original.feature_biz_id}`" variant="link" class="min-w-32 whitespace-normal">
            {{ row.original.title }}
          </UButton>
        </template>
        <template v-for="(version, index) in versions" :key="version.id" #[`v${version.id}-cell`]="{ row }">
          <div class="min-w-56 space-y-2">
            <p>{{ !row.original.cells[index]?.scope_id ? '未关联' : row.original.cells[index]?.planned ? '计划中' : row.original.cells[index]?.delivered ? '已交付' : '已顺延' }}</p>
            <UButton
              v-if="row.original.cells[index]?.scope_id"
              :to="{ path: `/products/${encodeURIComponent(code)}/versions/${version.id}/features`, query: versionPerspectiveQuery }"
              variant="link"
              size="sm"
            >
              查看版本范围
            </UButton>
            <UButton
              v-if="row.original.cells[index]?.deferred_from_version_id"
              :to="{ path: `/products/${encodeURIComponent(code)}/versions/${row.original.cells[index]?.deferred_from_version_id}/features`, query: versionPerspectiveQuery }"
              variant="link"
              size="sm"
            >
              顺延来源范围 {{ row.original.cells[index]?.deferred_from_scope_id }}
            </UButton>
            <ProductsFeatureReleaseEvidence :product-code="code" :evidence="row.original.cells[index]!.latest_release" />
          </div>
        </template>
        <template #empty>
          <CommonEmptyState icon="i-lucide-boxes" :title="error ? '矩阵暂不可用' : '本页暂无功能'" :description="error ? '点击刷新矩阵重试当前页，或移除版本重新选择。' : '可调整页码查看其他功能。'" />
        </template>
      </UTable>
      <div v-if="data && !error" class="flex flex-wrap items-center gap-2">
        <span>共 {{ data.total }} 个功能</span><UPagination
          v-model:page="page"
          :items-per-page="20"
          :total="data.total"
          :disabled="busy"
        />
      </div>
    </template>
  </div>
</template>
