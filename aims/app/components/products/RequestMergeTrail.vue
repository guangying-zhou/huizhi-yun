<script setup lang="ts">
const props = defineProps<{ productCode: string, requestId: string }>()
interface Link { biz_id: string, title: string, decision_status: string }
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.requestId}`, {
  server: false,
  transform: (response: { code: number, data: { biz_id: string, merge_trail?: Link[], merge_trail_truncated?: boolean } }) => {
    if (response.code !== 0 || response.data?.biz_id !== props.requestId || (response.data.merge_trail !== undefined && !Array.isArray(response.data.merge_trail))) throw new Error('合并关系响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '合并关系加载失败' })
</script>

<template>
  <section class="space-y-2 rounded-lg border border-default p-3" aria-label="需求合并路径">
    <h3 class="font-medium">
      需求合并路径
    </h3>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      v-if="status === 'error'"
      color="neutral"
      variant="outline"
      @click="refresh()"
    >
      重试加载合并关系
    </UButton>
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在加载合并关系…
    </p>
    <template v-else-if="status === 'success'">
      <ol class="list-decimal space-y-1 pl-5">
        <li v-for="link in data?.merge_trail || []" :key="link.biz_id" class="break-words text-sm">
          {{ link.title }}
        </li>
      </ol>
      <p v-if="data?.merge_trail_truncated" class="text-sm text-warning">
        合并路径较长，仅展示前 64 层，尚未定位最终需求。
      </p>
      <p v-else-if="data?.merge_trail?.length" class="text-sm text-muted">
        最终合并到：{{ data.merge_trail[data.merge_trail.length - 1]?.title }}。本记录及原始证据只读保留。
      </p>
      <p v-else class="text-sm text-muted">
        当前未返回合并目标，请刷新需求核对最新状态。
      </p>
    </template>
  </section>
</template>
