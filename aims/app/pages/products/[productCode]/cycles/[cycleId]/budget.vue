<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '调整周期预算', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.cycleId || ''))
const { data, status, error, refresh } = await useAsyncData(() => `cycle-budget:${code.value}:${id.value}`, async () => {
  const permission = await $fetch<{ code: number, data: { product_code: string, status: string, prioritize: boolean } }>(`/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/permissions`, { timeout: 15000 })
  if (permission.code !== 0 || permission.data?.product_code !== code.value || !permission.data.prioritize || permission.data.status !== 'active') throw new Error('当前产品不可调整预算或您没有周期决策权限')
  const result = await $fetch<{ code: number, data: ProductPlanningCycle & { workspace_revision: number } }>(`/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/${id.value}`, { timeout: 15000 })
  if (result.code !== 0 || result.data?.biz_id !== id.value || result.data.product_code !== code.value || result.data.status !== 'open' || !Number.isSafeInteger(result.data.revision) || result.data.revision < 1 || !Number.isSafeInteger(result.data.workspace_revision) || result.data.workspace_revision < 1) throw new Error('周期已变化或不再处于开放状态，请返回列表核对')
  return result.data
}, { server: false })
const alert = useApiErrorAlert(error, { fallbackTitle: '预算数据加载失败' })
const toast = useToast()
async function back() {
  await navigateTo(`/products/${encodeURIComponent(code.value)}/cycles`)
}
async function saved() {
  toast.add({ title: '周期预算已调整', color: 'success' })
  await back()
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在读取当前周期及权限…
    </p>
    <ProductsPlanningBudgetForm
      v-else-if="status === 'success' && data"
      :key="`${data.biz_id}:${data.revision}`"
      :product-code="code"
      :workspace-revision="data.workspace_revision"
      :cycle="data"
      @saved="saved"
      @cancel="back"
    />
    <template v-else>
      <UButton color="neutral" variant="outline" @click="refresh()">
        重新读取
      </UButton>
      <UButton color="neutral" variant="ghost" @click="back">
        返回周期列表
      </UButton>
    </template>
  </div>
</template>
