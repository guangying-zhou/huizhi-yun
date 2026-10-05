<script setup lang="ts">
const props = defineProps<{ refreshToken?: number, productCode: string, itemId: string }>()
type Baseline = { id: number, starts_on: string, ends_on: string, requires_review: boolean, review_reasons: string[], item_snapshot: { biz_id: string, product_code: string } }
type History = { items: Baseline[], total: number, page: number, pageSize: number, item_biz_id: string, latest_id: number }
const opened = ref(false)
const { data, status, error, refresh } = await useAsyncData(() => `roadmap-commitment-summary:${props.productCode}:${props.itemId}`, async () => {
  const response = await $fetch<{ code: number, data: History }, string>(`/api/v1/products/${encodeURIComponent(props.productCode)}/roadmaps/commitments/${encodeURIComponent(props.itemId)}`, { query: { page: 1, pageSize: 1 }, timeout: 15000 })
  const value = response.data
  if (response.code !== 0 || !value || value.item_biz_id !== props.itemId || value.page !== 1 || value.pageSize !== 1 || !Number.isSafeInteger(value.total) || value.total < 0 || !Number.isSafeInteger(value.latest_id) || value.latest_id < 0 || !Array.isArray(value.items) || value.items.length !== Math.min(value.total, 1) || (value.total === 0) !== (value.latest_id === 0)) throw new Error('承诺摘要响应不完整')
  const item = value.items[0]
  if (item && (item.id !== value.latest_id || item.item_snapshot?.biz_id !== props.itemId || item.item_snapshot.product_code !== props.productCode || !/^\d{4}-\d{2}-\d{2}$/.test(item.starts_on) || !/^\d{4}-\d{2}-\d{2}$/.test(item.ends_on) || item.ends_on < item.starts_on || typeof item.requires_review !== 'boolean' || !Array.isArray(item.review_reasons) || item.review_reasons.some(reason => typeof reason !== 'string') || item.requires_review !== (item.review_reasons.length > 0))) throw new Error('最新承诺摘要不完整')
  return value
}, { server: false, immediate: false })
watch(() => props.refreshToken, () => {
  if (opened.value) void refresh()
})
const alert = useApiErrorAlert(error, { fallbackTitle: '承诺状态读取失败' })
async function load() {
  opened.value = true
  await refresh()
}
</script>

<template>
  <div class="space-y-2">
    <UButton
      color="neutral"
      variant="outline"
      :loading="status === 'pending'"
      @click="load"
    >
      {{ opened ? '刷新承诺状态' : '查看承诺状态' }}
    </UButton>
    <template v-if="opened">
      <UAlert v-if="alert" v-bind="alert" />
      <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
        正在读取最新承诺…
      </p>
      <template v-else-if="status === 'success' && data">
        <p v-if="!data.items.length" class="text-sm text-muted">
          暂无承诺记录，当前展示为规划探索。
        </p>
        <template v-else>
          <p class="text-sm font-medium">
            最新承诺窗口：{{ data.items[0]!.starts_on }} 至 {{ data.items[0]!.ends_on }}
          </p>
          <p :class="data.items[0]!.requires_review ? 'text-warning' : 'text-muted'" class="text-sm">
            {{ data.items[0]!.requires_review ? '当前事实已变化，需要复评；原承诺仍保留。' : '当前未检测到需复评的变化。' }}
          </p>
        </template>
      </template>
      <UButton :to="`/products/${encodeURIComponent(productCode)}/planning-items/${encodeURIComponent(itemId)}/commitments`" variant="link">
        查看承诺历史与依据
      </UButton>
    </template>
  </div>
</template>
