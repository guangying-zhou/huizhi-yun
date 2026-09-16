<script setup lang="ts">
const props = defineProps<{ productCode: string, itemId: string }>()
interface Comment { readonly: boolean, readonly_reason: string, id: number, author_uid: string, body: string, revision: number, deleted: boolean, created_at: string }
interface CommentPage { readonly: boolean, readonly_reason: string, items: Comment[], total: number, workspace_revision: number, item_biz_id: string }
const base = computed(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/planning-items`)
const page = ref(1)
const historyID = ref<number | null>(null)
const saving = ref(false)
const body = ref('')
const editing = ref<Comment | null>(null)
const failure = ref<unknown>(null)
const { confirm } = useConfirm()
const { data: permissions, error: permissionError, refresh: refreshPermissions } = await useFetch(() => `${base.value}/permissions`, { server: false, transform: (r: { code: number, data: { product_code: string, actor_uid: string, comment: boolean, status: string } }) => {
  if (r.code !== 0 || r.data?.product_code !== props.productCode) throw new Error('讨论权限响应不完整')
  return r.data
} })
const { data, status, error, refresh } = await useFetch(() => `${base.value}/${props.itemId}/comments`, { server: false, query: { page, pageSize: 20 }, transform: (r: { code: number, data: CommentPage }) => {
  if (r.code !== 0 || r.data?.item_biz_id !== props.itemId || !Array.isArray(r.data.items) || !Number.isSafeInteger(r.data.workspace_revision)) throw new Error('讨论响应不完整')
  return r.data
} })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '讨论权限加载失败，请刷新重试' })
const loadAlert = useApiErrorAlert(error, { fallbackTitle: '讨论加载失败' })
const writeAlert = useApiErrorAlert(failure, { fallbackTitle: '评论提交失败，草稿已保留' })
const canComment = computed(() => permissions.value?.comment && permissions.value.status === 'active' && status.value === 'success' && !!data.value && data.value.readonly === false)
let retry: { payload: string, key: string } | undefined
function edit(row: Comment) {
  editing.value = { ...row }
  body.value = row.body
  failure.value = null
}
function cancel() {
  editing.value = null
  body.value = ''
  retry = undefined
}
async function reload() {
  if (saving.value) return
  await Promise.all([refresh(), refreshPermissions()])
}
async function submit(remove?: Comment) {
  if (!canComment.value || saving.value || !data.value) return
  const row = remove || editing.value
  if (row && (row.readonly !== false || row.author_uid !== permissions.value?.actor_uid)) return
  const method = remove ? 'DELETE' : row ? 'PATCH' : 'POST'
  const target = `${base.value}/${props.itemId}/comments${row ? `/${row.id}` : ''}`
  const input = { expectedRevision: data.value.workspace_revision, ...(row ? { expectedCommentRevision: row.revision } : {}), ...(remove ? {} : { body: body.value }) }
  const payload = JSON.stringify({ target, method, input })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  saving.value = true
  failure.value = null
  try {
    if (remove && !await confirm({ title: '删除本人评论', message: '删除后讨论列表将显示删除标记，修改历史仍会保留。', confirmLabel: '删除评论', tone: 'warning' })) return
    const response = await $fetch<{ code: number, data: { value: { comment_id: number, item_biz_id: string } } }>(target, { method, body: input, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0 || response.data?.value?.item_biz_id !== props.itemId || !Number.isSafeInteger(response.data.value.comment_id)) throw new Error('提交结果不完整，请保留原请求重试')
    if (!remove || editing.value?.id === remove.id) cancel()
    else retry = undefined
    await Promise.all([refresh(), refreshPermissions()])
  } catch (error) {
    failure.value = error
  } finally {
    saving.value = false
  }
}
onBeforeRouteLeave(() => !saving.value)
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-semibold">
          评估讨论与异议
        </h2>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="saving"
          :loading="status === 'pending'"
          @click="reload"
        >
          刷新讨论
        </UButton>
      </div>
    </template>
    <div class="space-y-4">
      <p class="text-sm text-muted">
        记录依据、估算建议与不同意见；正式评分和顺序仍由评估与决策操作确认。
      </p>
      <UAlert v-if="data?.readonly" color="warning" :title="data.readonly_reason || '当前讨论只读'" />
      <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
      <UAlert v-if="loadAlert" v-bind="loadAlert" />
      <UAlert v-if="writeAlert" v-bind="writeAlert" />
      <p v-if="status === 'pending'" role="status">
        正在加载讨论…
      </p>
      <template v-else-if="status === 'success' && data">
        <p v-if="!data.items.length" class="text-sm text-muted">
          暂无评论。
        </p>
        <article v-for="row in data.items" :key="row.id" class="space-y-2 border-b border-muted pb-3">
          <p class="text-xs text-muted break-all">
            {{ row.author_uid }} · {{ row.created_at }} · 第 {{ row.revision }} 版
          </p>
          <p class="whitespace-pre-wrap break-words text-sm">
            {{ row.deleted ? '此评论已删除' : row.body }}
          </p>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="historyID = historyID === row.id ? null : row.id"
          >
            {{ historyID === row.id ? '收起历史' : '查看修改历史' }}
          </UButton>
          <ProductsPlanningCommentHistory
            v-if="historyID === row.id"
            :key="row.id"
            :product-code="productCode"
            :item-id="itemId"
            :comment-id="row.id"
          />
          <div v-if="canComment && !row.deleted && row.readonly === false && row.author_uid === permissions?.actor_uid" class="flex gap-2">
            <UButton
              size="xs"
              variant="ghost"
              :disabled="saving"
              @click="edit(row)"
            >
              编辑
            </UButton>
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              :disabled="saving"
              @click="submit(row)"
            >
              删除
            </UButton>
          </div>
        </article>
        <UPagination
          v-model:page="page"
          :total="data.total"
          :items-per-page="20"
          :disabled="saving"
        />
      </template>
      <form v-if="canComment" class="space-y-3" @submit.prevent="submit()">
        <UFormField :label="editing ? '编辑本人评论' : '添加评论或异议'" required>
          <UTextarea
            v-model="body"
            class="w-full"
            :rows="4"
            :maxlength="10000"
            :disabled="saving"
          />
        </UFormField>
        <div class="flex gap-2">
          <UButton type="submit" :loading="saving" :disabled="!body.trim() || saving">
            {{ editing ? '保存修改' : '发表评论' }}
          </UButton>
          <UButton
            v-if="editing"
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="cancel"
          >
            取消编辑
          </UButton>
        </div>
      </form>
    </div>
  </UCard>
</template>
