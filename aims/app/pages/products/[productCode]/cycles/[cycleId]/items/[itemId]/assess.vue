<script setup lang="ts">
import { supportedRICECycleModel } from '~/utils/productRICEModel'
import { supportedWeightedCycleModel } from '~/utils/productWeightedModel'
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'
import type { ProductPlanningDetail } from '~/types/productPlanning'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '评估规划事项', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const cycleId = computed(() => String(route.params.cycleId || ''))
const itemId = computed(() => String(route.params.itemId || ''))
const { data, status, error, refresh } = await useAsyncData(() => `assessment-create:${code.value}:${cycleId.value}:${itemId.value}`, async () => {
  const base = `/api/v1/products/${encodeURIComponent(code.value)}`
  const permission = await $fetch<{ code: number, data: { product_code: string, status: string, assess: boolean } }>(`${base}/planning-cycles/permissions`, { timeout: 15000 })
  if (permission.code !== 0 || permission.data?.product_code !== code.value || permission.data.status !== 'active' || !permission.data.assess) throw new Error('当前产品不可评估或您没有评估权限')
  const cycle = await $fetch<{ code: number, data: ProductPlanningCycle & { workspace_revision: number } }>(`${base}/planning-cycles/${cycleId.value}`, { timeout: 15000 })
  const item = await $fetch<{ code: number, data: ProductPlanningDetail }>(`${base}/planning-items/${itemId.value}`, { timeout: 15000 })
  const history = await $fetch<{ code: number, data: { cycle_biz_id: string, item_biz_id: string, cycle_revision: number, workspace_revision: number, item_revision: number } }>(`${base}/planning-cycles/${cycleId.value}/items/${itemId.value}/assessments`, { query: { page: 1, pageSize: 1 }, timeout: 15000 })
  if (cycle.code !== 0 || cycle.data?.biz_id !== cycleId.value || cycle.data.product_code !== code.value || cycle.data.status !== 'open' || (!supportedWeightedCycleModel(cycle.data.model_version, cycle.data.model_snapshot) && !supportedRICECycleModel(cycle.data.model_version, cycle.data.model_snapshot))) throw new Error('当前周期未开放或模型不适用')
  if (item.code !== 0 || item.data?.biz_id !== itemId.value || item.data.product_code !== code.value || !['proposed', 'in_delivery'].includes(item.data.lifecycle)) throw new Error('当前事项不可评估')
  if (history.code !== 0 || history.data?.cycle_biz_id !== cycleId.value || history.data.item_biz_id !== itemId.value || history.data.cycle_revision !== cycle.data.revision || history.data.item_revision !== item.data.revision || history.data.workspace_revision !== cycle.data.workspace_revision || item.data.workspace_revision !== cycle.data.workspace_revision) throw new Error('读取期间产品或事项已变化，请重新读取')
  for (const revision of [cycle.data.revision, cycle.data.workspace_revision, item.data.revision, item.data.scope_revision, item.data.evidence_revision]) if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('评估版本信息不完整')
  return { cycle: cycle.data, item: item.data }
}, { server: false })
const alert = useApiErrorAlert(error, { fallbackTitle: '评估数据加载失败' })
const toast = useToast()
async function back() {
  await navigateTo(`/products/${encodeURIComponent(code.value)}/cycles/${cycleId.value}/items/${itemId.value}/assessments`)
}
async function saved() {
  toast.add({ title: '评估快照已保存', color: 'success' })
  await back()
}
</script>

<template>
  <div class="mx-auto min-w-0 max-w-3xl space-y-4 p-4 sm:p-6">
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在读取周期、事项范围和权限…
    </p>
    <ProductsPlanningAssessmentForm
      v-else-if="status === 'success' && data"
      :key="`${code}:${cycleId}:${itemId}:${data.cycle.workspace_revision}`"
      :product-code="code"
      :cycle="data.cycle"
      :item="data.item"
      :workspace-revision="data.cycle.workspace_revision"
      @saved="saved"
      @cancel="back"
    />
    <template v-else>
      <UButton color="neutral" variant="outline" @click="refresh()">
        重新读取
      </UButton>
      <UButton color="neutral" variant="ghost" @click="back">
        返回评估历史
      </UButton>
    </template>
  </div>
</template>
