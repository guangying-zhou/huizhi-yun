<script setup lang="ts">
const props = defineProps<{ productCode: string, itemId: string, refreshToken?: number }>()
type Objective = { objective_id: number, biz_id: string, product_code: string, title: string, status: string, objective_revision: number, contribution_note: string }
type Page = { items: Objective[], total: number, page: number, pageSize: number, item_biz_id: string, item_revision: number, workspace_revision: number }
const opened = ref(false), page = ref(1)
const states: Record<string, string> = { draft: '草稿', active: '进行中', closed: '已关闭', archived: '已归档' }
const positive = (value: number) => Number.isSafeInteger(value) && value > 0
const { data, status, error, refresh } = await useAsyncData(() => `item-objectives:${props.productCode}:${props.itemId}`, async () => {
  const response = await $fetch<{ code: number, data: Page }, string>(`/api/v1/products/${encodeURIComponent(props.productCode)}/objectives/for-item/${encodeURIComponent(props.itemId)}`, { query: { page: page.value, pageSize: 10 }, timeout: 15000 })
  const value = response.data
  if (response.code !== 0 || !value || value.item_biz_id !== props.itemId || value.page !== page.value || value.pageSize !== 10 || !positive(value.item_revision) || !positive(value.workspace_revision) || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.items) || value.items.length > 10 || value.items.length > value.total || new Set(value.items.map(item => item.objective_id)).size !== value.items.length || value.items.some(item => !positive(item.objective_id) || !item.biz_id || item.product_code !== props.productCode || typeof item.title !== 'string' || !item.title.trim() || !Object.hasOwn(states, item.status) || !positive(item.objective_revision) || typeof item.contribution_note !== 'string')) throw new Error('关联目标响应不完整')
  return value
}, { server: false, immediate: false })
const alert = useApiErrorAlert(error, { fallbackTitle: '关联目标读取失败' })
async function load() {
  opened.value = true
  await refresh()
}
watch(page, () => {
  void refresh()
})
watch(() => props.refreshToken, () => {
  if (opened.value) void refresh()
})
</script>

<template>
  <section class="space-y-2">
    <UButton
      color="neutral"
      variant="outline"
      :loading="status === 'pending'"
      @click="load"
    >
      {{ opened ? '刷新关联目标' : '查看关联产品目标' }}
    </UButton>
    <template v-if="opened">
      <UAlert v-if="alert" v-bind="alert" />
      <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
        正在读取事项关联目标…
      </p>
      <template v-else-if="status === 'success' && data">
        <CommonEmptyState
          v-if="!data.items.length"
          icon="i-lucide-target"
          title="本页暂无关联目标"
          description="仅展示已建立的事项与目标关联，可调整页码或前往产品目标建立关联。"
        />
        <ul v-else class="space-y-2">
          <li v-for="objective in data.items" :key="objective.objective_id" class="rounded border border-default p-2">
            <UButton :to="`/products/${encodeURIComponent(productCode)}/objectives/${objective.objective_id}`" variant="link" class="whitespace-normal break-words">
              {{ objective.title }}
            </UButton>
            <p class="text-sm text-muted">
              {{ states[objective.status] }}
            </p>
            <p class="whitespace-pre-wrap break-words text-sm">
              贡献说明：{{ objective.contribution_note || '未填写' }}
            </p>
          </li>
        </ul>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm">共 {{ data.total }} 个关联目标</span>
          <UPagination v-model:page="page" :items-per-page="10" :total="data.total" />
        </div>
        <UButton :to="`/products/${encodeURIComponent(productCode)}/objectives`" variant="link">
          查看产品目标
        </UButton>
      </template>
    </template>
  </section>
</template>
