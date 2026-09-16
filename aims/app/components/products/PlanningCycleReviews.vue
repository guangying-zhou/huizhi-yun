<script setup lang="ts">
const props = defineProps<{ productCode: string, cycleId: string }>()
interface Review { id: number, actor_uid: string, reviewed_at: string, conclusion: string, before: { revision: number, next_review_at: string | null }, after: { revision: number, next_review_at: string | null } }
const page = ref(1)
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/planning-cycles/${props.cycleId}/reviews`, { server: false, query: { page, pageSize: 10 }, transform: (r: { code: number, data: { cycle_biz_id: string, total: number, items: Review[] } }) => {
  if (r.code !== 0 || r.data?.cycle_biz_id !== props.cycleId || !Array.isArray(r.data.items)) throw new Error('复评历史响应不完整')
  return r.data
} })
const alert = useApiErrorAlert(error, { fallbackTitle: '复评历史加载失败' })
</script>

<template>
  <section class="space-y-4" aria-label="周期复评历史">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold">
        复评历史
      </h2>
      <UButton
        color="neutral"
        variant="ghost"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新复评历史
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在读取复评历史…
    </p>
    <template v-else-if="status === 'success' && data">
      <p v-if="!data.items.length" class="text-sm text-muted">
        暂无复评记录。
      </p>
      <article v-for="row in data.items" :key="row.id" class="space-y-2 rounded-lg border border-muted p-3 text-sm">
        <p class="break-all text-muted">
          {{ row.actor_uid }} · {{ row.reviewed_at }} · 周期版本 {{ row.before.revision }} → {{ row.after.revision }}
        </p>
        <p class="whitespace-pre-wrap break-words">
          {{ row.conclusion }}
        </p>
        <p class="break-words">
          原复评时间：{{ row.before.next_review_at || '未安排' }}
        </p>
        <p class="break-words">
          下次复评：{{ row.after.next_review_at || '未安排' }}
        </p>
      </article>
      <UPagination v-model:page="page" :total="data.total" :items-per-page="10" />
    </template>
  </section>
</template>
