<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'
import type { ProductPlanningDetail } from '~/types/productPlanning'
import type { ProductAssessment } from '~/types/productAssessment'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '选入周期', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const cycleId = computed(() => String(route.params.cycleId || ''))
const itemId = computed(() => String(route.params.itemId || ''))
const { data, status, error, refresh } = await useAsyncData(() => `selection:${code.value}:${cycleId.value}:${itemId.value}`, async () => {
  const base = `/api/v1/products/${encodeURIComponent(code.value)}`
  const permission = await $fetch<{ code: number, data: { product_code: string, status: string, prioritize: boolean } }>(`${base}/planning-cycles/permissions`, { timeout: 15000 })
  if (permission.code !== 0 || permission.data?.product_code !== code.value || permission.data.status !== 'active' || !permission.data.prioritize) throw new Error('当前产品不可选入或您没有决策权限')
  const cycle = await $fetch<{ code: number, data: ProductPlanningCycle & { workspace_revision: number } }>(`${base}/planning-cycles/${cycleId.value}`, { timeout: 15000 })
  const item = await $fetch<{ code: number, data: ProductPlanningDetail }>(`${base}/planning-items/${itemId.value}`, { timeout: 15000 })
  const history = await $fetch<{ code: number, data: { cycle_biz_id: string, item_biz_id: string, cycle_revision: number, workspace_revision: number, item_revision: number, items: ProductAssessment[] } }>(`${base}/planning-cycles/${cycleId.value}/items/${itemId.value}/assessments`, { query: { page: 1, pageSize: 1 }, timeout: 15000 })
  if (cycle.code !== 0 || cycle.data?.biz_id !== cycleId.value || cycle.data.product_code !== code.value || cycle.data.status !== 'open') throw new Error('当前周期未开放')
  if (item.code !== 0 || item.data?.biz_id !== itemId.value || item.data.product_code !== code.value || item.data.lifecycle !== 'proposed' || !['reliability', 'usability', 'growth'].includes(item.data.investment_category)) throw new Error('当前事项不可读取')
  if (history.code !== 0 || history.data?.cycle_biz_id !== cycleId.value || history.data.item_biz_id !== itemId.value || history.data.cycle_revision !== cycle.data.revision || history.data.item_revision !== item.data.revision || history.data.workspace_revision !== cycle.data.workspace_revision || item.data.workspace_revision !== cycle.data.workspace_revision) throw new Error('读取期间产品或事项已变化，请重新读取')
  for (const revision of [cycle.data.revision, cycle.data.queue_revision, cycle.data.workspace_revision, item.data.revision, item.data.scope_revision, item.data.evidence_revision]) if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('选入版本信息不完整')
  const assessment = history.data.items?.[0]
  if (!assessment || !assessment.is_current || assessment.stale || !Number.isSafeInteger(assessment.id) || assessment.id < 1 || assessment.priority_score === null || assessment.effort_person_days === null) throw new Error('当前评估缺失、过期或不完整，请先评估')
  return { cycle: cycle.data, item: item.data, assessment }
}, { server: false })
const alert = useApiErrorAlert(error, { fallbackTitle: '选入数据加载失败' })
const toast = useToast()
async function back() {
  await navigateTo(`/products/${encodeURIComponent(code.value)}/cycles/${cycleId.value}/items`)
}
async function saved() {
  toast.add({ title: '事项已选入周期', color: 'success' })
  await back()
}
</script>

<template>
  <div class="mx-auto min-w-0 max-w-3xl space-y-4 p-4 sm:p-6">
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在读取周期、事项范围和权限…
    </p>
    <ProductsPlanningSelectionForm
      v-else-if="status === 'success' && data"
      :key="`${code}:${cycleId}:${itemId}:${data.cycle.workspace_revision}`"
      :product-code="code"
      :cycle="data.cycle"
      :item="data.item"
      :assessment="data.assessment"
      :workspace-revision="data.cycle.workspace_revision"
      @saved="saved"
      @cancel="back"
    />
    <template v-else>
      <UButton color="neutral" variant="outline" @click="refresh()">
        重新读取
      </UButton>
      <UButton color="neutral" variant="ghost" @click="back">
        返回周期候选
      </UButton>
    </template>
  </div>
</template>
