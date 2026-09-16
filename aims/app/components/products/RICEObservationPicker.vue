<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

type Observation = { biz_id: string, product_code: string, item_biz_id: string, model_version: string, reach: number, reach_unit: string, reach_starts_on: string, reach_ends_on: string, reach_definition: string, source_definition: string, source_reference: string, methodology: string, recorded_by: string, recorded_at: string, scope_revision: number, evidence_revision: number }
type Row = { observation: Observation, stale: boolean, workspace_revision: number, item_revision: number }
type Page = { items: Row[], total: number, page: number, pageSize: number, product_code: string, item_biz_id: string, workspace_revision: number, item_revision: number }
const props = defineProps<{ productCode: string, itemId: string, modelVersion: string, workspaceRevision: number, itemRevision: number, scopeRevision: number, evidenceRevision: number, disabled: boolean }>()
const emit = defineEmits<{ selected: [id: string] }>()
const page = ref(1), selected = ref<Observation | null>(null)
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/reach-observations/items/${props.itemId}`, {
  server: false, query: { page, pageSize: 20 },
  transform: (response: { code: number, data: Page }) => {
    const value = response.data
    if (response.code !== 0 || !value || value.product_code !== props.productCode || value.item_biz_id !== props.itemId || value.workspace_revision !== props.workspaceRevision || value.item_revision !== props.itemRevision || value.page !== page.value || value.pageSize !== 20 || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.items) || value.items.length > 20 || value.items.some(row => !row.observation || row.observation.product_code !== props.productCode || row.observation.item_biz_id !== props.itemId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.observation.biz_id) || !Number.isSafeInteger(row.observation.reach) || row.observation.reach < 0 || row.observation.reach > 1000000000 || row.workspace_revision !== value.workspace_revision || row.item_revision !== value.item_revision || typeof row.stale !== 'boolean' || !['unique_users', 'unique_customer_organizations'].includes(row.observation.reach_unit) || ['model_version', 'reach_starts_on', 'reach_ends_on', 'reach_definition', 'source_definition', 'source_reference', 'methodology', 'recorded_by', 'recorded_at'].some(key => typeof row.observation[key as keyof Observation] !== 'string' || !String(row.observation[key as keyof Observation]).trim()))) throw new Error('观测读取期间事项已变化或数据不完整，请返回重新读取评估')
    return value
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: 'Reach 观测加载失败' })
const usable = (row: Row) => !row.stale && row.observation.model_version === props.modelVersion && row.observation.scope_revision === props.scopeRevision && row.observation.evidence_revision === props.evidenceRevision
const columns: TableColumn<Row>[] = [{ id: 'reach', header: 'Reach / 模型' }, { id: 'select', header: '选用' }]
function choose(row: Row | null) {
  if (props.disabled || (row && (status.value !== 'success' || !usable(row)))) return
  selected.value = row?.observation ?? null
  emit('selected', selected.value?.biz_id ?? '')
}
watch(error, (value) => {
  if (value) {
    selected.value = null
    emit('selected', '')
  }
})
</script>

<template>
  <section class="min-w-0 space-y-3">
    <p class="text-sm text-muted">
      仅可选用当前模型且范围、证据修订一致的观测。未选择时 Reach 保持未知。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      :disabled="disabled"
      :loading="status === 'pending'"
      @click="refresh()"
    >
      刷新观测
    </UButton>
    <UTable :data="data?.items ?? []" :columns="columns" :loading="status === 'pending'">
      <template #reach-cell="{ row }">
        <p>{{ row.original.observation.reach }} {{ row.original.observation.reach_unit === 'unique_users' ? '去重用户' : '去重客户企业' }}</p>
        <p class="break-all text-sm text-muted">
          {{ row.original.observation.model_version }} · {{ row.original.observation.recorded_at }}
        </p>
      </template>
      <template #select-cell="{ row }">
        <UButton
          type="button"
          size="sm"
          :disabled="disabled || status !== 'success' || !usable(row.original)"
          @click="choose(row.original)"
        >
          {{ selected?.biz_id === row.original.observation.biz_id ? '已选择' : usable(row.original) ? '选择' : '不适用' }}
        </UButton>
      </template>
      <template #empty>
        <CommonEmptyState icon="i-lucide-chart-no-axes-combined" title="本页没有观测" description="可从事项 Reach 历史记录观测后重新读取评估。" />
      </template>
    </UTable>
    <div v-if="data" class="flex flex-wrap items-center gap-3">
      <span class="text-sm text-muted">共 {{ data.total }} 条</span>
      <UPagination
        v-model:page="page"
        :items-per-page="20"
        :total="data.total"
        :disabled="disabled || status === 'pending'"
      />
    </div>
    <div v-if="selected" class="space-y-2 break-words rounded-lg border border-default p-3 text-sm">
      <p>已选 Reach：{{ selected.reach }} · {{ selected.reach_starts_on }} 至 {{ selected.reach_ends_on }}</p>
      <p>去重定义：{{ selected.reach_definition }}</p>
      <p>来源定义：{{ selected.source_definition }}</p>
      <p>来源引用：{{ selected.source_reference }}</p>
      <p>取数方法：{{ selected.methodology }}</p>
      <p>记录人：{{ selected.recorded_by }} · {{ selected.recorded_at }}</p>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        :disabled="disabled"
        @click="choose(null)"
      >
        清除选择，保留未知
      </UButton>
    </div>
  </section>
</template>
