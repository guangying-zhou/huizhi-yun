<script setup lang="ts">
import { objectivePositive as positive } from '~/utils/productObjectiveView'

const props = defineProps<{ productCode: string, itemId: string, commitmentId: string }>()
const page = ref(1), pageSize = 20
interface Snapshot { product_code: string, biz_id: string, revision: number, dependency_biz_id: string, dependency_revision: number, title: string, scope_summary: string, lifecycle: string, reason: string, roadmap_starts_on: string | null, roadmap_ends_on: string | null, deadline: string | null }
interface Row { dependency_biz_id: string, dependency_revision: number, predecessor_product_code: string, predecessor_biz_id: string, predecessor_revision: number, snapshot: Snapshot }
interface History { items: Row[], total: number, page: number, pageSize: number, product_code: string, item_biz_id: string, commitment_biz_id: string, workspace_revision: number }
const states: Record<string, string> = { proposed: '待规划', in_delivery: '交付中', delivered: '已交付', cancelled: '已取消', merged: '已合并' }
const date = (value: unknown) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
watch(() => [props.productCode, props.itemId, props.commitmentId], () => {
  page.value = 1
})
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/roadmaps/cross-snapshots/${encodeURIComponent(props.commitmentId)}`, {
  server: false, query: computed(() => ({ page: page.value, pageSize })),
  transform: (response: { code: number, data: History }) => {
    const value = response.data
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    if (response.code !== 0 || !value || value.product_code !== props.productCode || value.item_biz_id !== props.itemId || value.commitment_biz_id !== props.commitmentId || value.page !== page.value || value.pageSize !== pageSize || !positive(value.workspace_revision) || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.items) || value.items.length > pageSize || value.items.length > value.total || new Set(value.items.map(row => row?.dependency_biz_id)).size !== value.items.length || value.items.some((row) => {
      const snap = row?.snapshot
      return !row || !uuid.test(row.dependency_biz_id) || !uuid.test(row.predecessor_biz_id) || typeof row.predecessor_product_code !== 'string' || !row.predecessor_product_code.trim() || row.predecessor_product_code === props.productCode || !positive(row.dependency_revision) || !positive(row.predecessor_revision) || !snap || snap.product_code !== row.predecessor_product_code || snap.biz_id !== row.predecessor_biz_id || snap.revision !== row.predecessor_revision || snap.dependency_biz_id !== row.dependency_biz_id || snap.dependency_revision !== row.dependency_revision || typeof snap.title !== 'string' || typeof snap.scope_summary !== 'string' || typeof snap.reason !== 'string' || !Object.hasOwn(states, snap.lifecycle) || !date(snap.deadline) || !date(snap.roadmap_starts_on) || !date(snap.roadmap_ends_on) || (snap.roadmap_starts_on === null) !== (snap.roadmap_ends_on === null) || (snap.roadmap_starts_on !== null && snap.roadmap_ends_on !== null && snap.roadmap_ends_on < snap.roadmap_starts_on)
    })) throw new Error('前置历史响应不完整')
    return value
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '前置历史加载失败' })
</script>

<template>
  <section class="mt-4 space-y-3 border-t border-muted pt-4" aria-label="承诺时的跨产品前置">
    <h3 class="font-semibold">
      承诺时的跨产品前置
    </h3>
    <p class="text-sm text-muted">
      以下为确认此基线时保存的范围与状态，仅显示当前有权查看的记录。当前事项的后续修改不会改写这些历史记录。
    </p>
    <UButton
      color="neutral"
      variant="outline"
      :loading="status === 'pending'"
      @click="refresh()"
    >
      刷新前置历史
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载前置历史…
    </p>
    <template v-else-if="status === 'success' && data">
      <p class="text-sm text-muted">
        共 {{ data.total }} 条可见记录
      </p>
      <p v-if="!data.items.length">
        当前页没有可见的前置历史记录。
      </p>
      <ul v-else class="space-y-3">
        <li v-for="row in data.items" :key="row.dependency_biz_id" class="space-y-2 rounded border border-muted p-3">
          <h4 class="break-words font-medium">
            {{ row.snapshot.title }}
          </h4>
          <p class="break-words text-sm">
            产品：{{ row.predecessor_product_code }} · 当时状态：{{ states[row.snapshot.lifecycle] }} · 事项修订：{{ row.predecessor_revision }}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm">
            当时范围：{{ row.snapshot.scope_summary }}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm">
            依赖原因：{{ row.snapshot.reason }}
          </p>
          <p class="text-sm">
            当时时间窗口：{{ row.snapshot.roadmap_starts_on ? `${row.snapshot.roadmap_starts_on} 至 ${row.snapshot.roadmap_ends_on}` : '未安排' }} · 期限：{{ row.snapshot.deadline || '未确定' }}
          </p>
          <UButton color="neutral" variant="ghost" :to="`/products/${encodeURIComponent(row.predecessor_product_code)}/planning-items/${encodeURIComponent(row.predecessor_biz_id)}`">
            查看当前前置事项
          </UButton>
        </li>
      </ul>
      <UPagination
        v-if="data.total > pageSize"
        v-model:page="page"
        :items-per-page="pageSize"
        :total="data.total"
      />
    </template>
  </section>
</template>
