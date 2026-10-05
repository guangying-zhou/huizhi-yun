<script setup lang="ts">
import type { ProductObservation } from '~/types/productObservation'
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '更正结果观测', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.cycleId || ''))
const { data, status, error, refresh } = await useAsyncData(() => `cycle-correct:${code.value}:${id.value}:${route.params.observationId}`, async () => {
  const permission = await $fetch<{ code: number, data: { product_code: string, status: string, observe: boolean } }>(`/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/permissions`, { timeout: 15000 })
  if (permission.code !== 0 || permission.data?.product_code !== code.value || !permission.data.observe || permission.data.status !== 'active') throw new Error('当前产品不可登记观测或您没有观测权限')
  const result = await $fetch<{ code: number, data: ProductPlanningCycle & { workspace_revision: number } }>(`/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/${id.value}`, { timeout: 15000 })
  if (result.code !== 0 || result.data?.biz_id !== id.value || result.data.product_code !== code.value || !['open', 'closed'].includes(result.data.status) || !result.data.metric_definition || !Number.isSafeInteger(result.data.revision) || result.data.revision < 1 || !Number.isSafeInteger(result.data.workspace_revision) || result.data.workspace_revision < 1) throw new Error('周期已变化或不具备正式观测条件，请返回列表核对')
  const observationId = String(route.params.observationId || '')
  if (!/^[1-9]\d*$/.test(observationId) || !Number.isSafeInteger(Number(observationId))) throw new Error('更正记录标识无效')
  const original = await $fetch<{ code: number, data: ProductObservation & { cycle_biz_id: string, workspace_revision: number, cycle_revision: number } }>(`/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/${id.value}/observations/${observationId}`, { timeout: 15000 })
  const record = original.data
  if (original.code !== 0 || record?.id !== Number(observationId) || record.cycle_biz_id !== id.value || record.corrected_by_id !== null || record.workspace_revision !== result.data.workspace_revision || record.cycle_revision !== result.data.revision || !record.metric_snapshot?.name || !record.evidence?.summary || !record.conclusion) throw new Error('记录已更正或读取期间发生变化，请返回结果回看核对')
  return { ...result.data, metric_definition: { ...record.metric_snapshot, direction: record.metric_snapshot.direction }, baseline_value: record.metric_snapshot.baseline_value, target_value: record.metric_snapshot.target_value, correction: record }
}, { server: false })
const alert = useApiErrorAlert(error, { fallbackTitle: '观测数据加载失败' })
const toast = useToast()
async function back() {
  await navigateTo(`/products/${encodeURIComponent(code.value)}/cycles/${id.value}/observations`)
}
async function saved() {
  toast.add({ title: '观测更正已登记', color: 'success' })
  await back()
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在读取当前周期及权限…
    </p>
    <ProductsPlanningObservationForm
      v-else-if="status === 'success' && data"
      :key="`${data.biz_id}:${data.revision}`"
      :product-code="code"
      :workspace-revision="data.workspace_revision"
      :cycle="data"
      :correction="data.correction"
      @saved="saved"
      @cancel="back"
    />
    <template v-else>
      <UButton color="neutral" variant="outline" @click="refresh()">
        重新读取
      </UButton>
      <UButton color="neutral" variant="ghost" @click="back">
        返回结果回看
      </UButton>
    </template>
  </div>
</template>
