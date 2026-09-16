<script setup lang="ts">
import type { ProductRequestRecord } from '~/types/productRequest'

const props = defineProps<{ productCode: string, requestId: string, disabled?: boolean }>()
const emit = defineEmits<{ select: [request: ProductRequestRecord] }>()
const page = ref(1)
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/requests`, {
  server: false,
  query: computed(() => ({ mergedInto: props.requestId, page: page.value, pageSize: 10 })),
  transform: (response: { code: number, data: { items: ProductRequestRecord[], total: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(row => row.product_code !== props.productCode || row.decision_status !== 'merged')) throw new Error('合并来源响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '合并来源加载失败' })
</script>

<template>
  <section class="space-y-2 rounded-lg border border-default p-3" aria-label="合并来源需求">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="font-medium">
        合并来源需求
      </h3>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="disabled"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新合并来源
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在加载合并来源…
    </p>
    <template v-else-if="status === 'success'">
      <p class="text-xs text-muted">
        共 {{ data?.total || 0 }} 条直接合并来源。打开记录可查看原始证据和更早的来源；来源条数不直接增加优先级分数。
      </p>
      <p v-if="!data?.items.length" class="text-sm text-muted">
        当前页暂无直接合并来源。
      </p>
      <ul v-else class="space-y-2">
        <li v-for="request in data.items" :key="request.biz_id">
          <UButton
            color="neutral"
            variant="link"
            :disabled="disabled"
            class="max-w-full whitespace-normal text-left"
            @click="emit('select', request)"
          >
            {{ request.title }}
          </UButton>
          <p class="text-xs text-muted whitespace-pre-wrap break-words">
            合并原因：{{ request.decision_reason || '未记录' }}
          </p>
        </li>
      </ul>
      <UPagination
        v-if="(data?.total || 0) > 10"
        v-model:page="page"
        :disabled="disabled"
        :total="data?.total || 0"
        :items-per-page="10"
        :sibling-count="0"
        show-edges
      />
    </template>
  </section>
</template>
