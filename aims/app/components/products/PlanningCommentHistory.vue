<script setup lang="ts">
const props = defineProps<{ productCode: string, itemId: string, commentId: number }>()
interface Entry { id: number, action: string, actor_uid: string, revision: number, created_at: string, changes: { before?: { body?: string }, body?: string, result: { comment_id: number } } }
const page = ref(1)
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/planning-items/${props.itemId}/comments/${props.commentId}/history`, {
  server: false, query: { page, pageSize: 10 },
  transform: (r: { code: number, data: { items: Entry[], total: number } }) => {
    if (r.code !== 0 || !Array.isArray(r.data?.items) || r.data.items.some(row => row.changes?.result?.comment_id !== props.commentId)) throw new Error('评论历史响应不完整')
    return r.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '评论历史加载失败' })
const actions: Record<string, string> = { 'comment-create': '发表评论', 'comment-edit': '编辑评论', 'comment-delete': '删除评论' }
</script>

<template>
  <section class="space-y-3 rounded-lg border border-muted p-3" aria-label="评论修改历史">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-sm font-medium">
        评论 #{{ commentId }} 的修改历史
      </h3>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新历史
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载历史…
    </p>
    <template v-else-if="status === 'success' && data">
      <p v-if="!data.items.length" class="text-sm text-muted">
        暂无可用的历史记录。
      </p>
      <article v-for="row in data.items" :key="row.id" class="space-y-2 border-b border-muted pb-3 text-sm">
        <p class="break-all text-muted">
          {{ actions[row.action] || row.action }} · {{ row.actor_uid }} · {{ row.created_at }} · 第 {{ row.revision }} 版
        </p>
        <div v-if="typeof row.changes.before?.body === 'string'">
          <p class="font-medium">
            {{ row.action === 'comment-delete' ? '删除前正文' : '修改前正文' }}
          </p>
          <p class="whitespace-pre-wrap break-words">
            {{ row.changes.before.body }}
          </p>
        </div>
        <div v-if="row.action !== 'comment-delete'">
          <p class="font-medium">
            {{ row.action === 'comment-create' ? '正文' : '修改后正文' }}
          </p>
          <p class="whitespace-pre-wrap break-words">
            {{ row.changes.body }}
          </p>
        </div>
      </article>
      <UPagination v-model:page="page" :total="data.total" :items-per-page="10" />
    </template>
  </section>
</template>
