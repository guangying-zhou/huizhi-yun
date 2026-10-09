<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'
import type { ProductPlanningDetail } from '~/types/productPlanning'
import type { ProductConsumptionView } from '~/types/productConsumption'
import { withdrawalConsumption } from '~/utils/productWithdrawalConsumption'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '撤回事项', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const cycleId = computed(() => String(route.params.cycleId || ''))
const itemId = computed(() => String(route.params.itemId || ''))
const { data, status, error, refresh } = await useAsyncData(() => `withdrawal:${code.value}:${cycleId.value}:${itemId.value}`, async () => {
  const base = `/api/v1/products/${encodeURIComponent(code.value)}`
  const permission = await $fetch<{ code: number, data: { product_code: string, status: string, prioritize: boolean } }>(`${base}/planning-cycles/permissions`, { timeout: 15000 })
  if (permission.code !== 0 || permission.data?.product_code !== code.value || permission.data.status !== 'active' || !permission.data.prioritize) throw new Error('当前产品不可撤回或您没有决策权限')
  const cycle = await $fetch<{ code: number, data: ProductPlanningCycle & { workspace_revision: number } }>(`${base}/planning-cycles/${cycleId.value}`, { timeout: 15000 })
  const item = await $fetch<{ code: number, data: ProductPlanningDetail }>(`${base}/planning-items/${itemId.value}`, { timeout: 15000 })
  const consumption = await $fetch<{ code: number, data: ProductConsumptionView }>(`${base}/planning-cycles/${cycleId.value}/items/${itemId.value}/consumption`, { timeout: 15000 })
  if (cycle.code !== 0 || cycle.data?.biz_id !== cycleId.value || cycle.data.product_code !== code.value || cycle.data.status !== 'open') throw new Error('当前周期未开放')
  if (item.code !== 0 || item.data?.biz_id !== itemId.value || item.data.product_code !== code.value || !['proposed', 'in_delivery'].includes(item.data.lifecycle) || !['reliability', 'usability', 'growth'].includes(item.data.investment_category)) throw new Error('当前事项不可读取')
  if (consumption.code !== 0 || item.data.workspace_revision !== cycle.data.workspace_revision) throw new Error('读取期间产品已变化，请重新读取')
  const confirmation = withdrawalConsumption(consumption.data, { cycleId: cycleId.value, itemId: itemId.value, workspaceRevision: cycle.data.workspace_revision, cycleRevision: cycle.data.revision, queueRevision: cycle.data.queue_revision, itemRevision: item.data.revision, scopeRevision: item.data.scope_revision, lifecycle: item.data.lifecycle })
  for (const revision of [cycle.data.revision, cycle.data.queue_revision, cycle.data.workspace_revision, item.data.revision, item.data.scope_revision, item.data.evidence_revision]) if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('撤回版本信息不完整')
  return { cycle: cycle.data, item: item.data, confirmation }
}, { server: false })
const alert = useApiErrorAlert(error, { fallbackTitle: '撤回数据加载失败' })
const toast = useToast()
async function back() {
  await navigateTo(`/products/${encodeURIComponent(code.value)}/cycles/${cycleId.value}/items`)
}
async function saved() {
  toast.add({ title: '事项已从周期撤回并转为暂缓', color: 'success' })
  await back()
}
</script>

<template>
  <div class="mx-auto min-w-0 max-w-3xl space-y-4 p-4 sm:p-6">
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在读取周期、事项范围和权限…
    </p>
    <ProductsPlanningWithdrawalForm
      v-else-if="status === 'success' && data"
      :key="`${code}:${cycleId}:${itemId}:${data.cycle.workspace_revision}`"
      :product-code="code"
      :cycle="data.cycle"
      :item="data.item"
      :workspace-revision="data.cycle.workspace_revision"
      :confirmation="data.confirmation"
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
