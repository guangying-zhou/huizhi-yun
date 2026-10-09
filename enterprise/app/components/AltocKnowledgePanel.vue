<script setup lang="ts">
import { createConsoleMutationIntent } from '@hzy/foundation/shared/utils/consoleMutationIntent'

const props = defineProps<{ customerId?: string, ticketId?: string, rowVersion?: number, canEdit?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
type Row = Record<string, unknown>
const page = ref(1)
const kind = ref<'assets' | 'documents'>('assets')
const state = ref<Row | null>(null)
const pending = ref(false)
const message = ref('')
const documentUuid = ref('')
const scope = useState<string>('enterprise-cache-scope', () => '')
const linkIntent = createConsoleMutationIntent('altoc-knowledge-link')
const resumeIntent = createConsoleMutationIntent('altoc-knowledge-resume')
const api = computed(() => props.ticketId ? `/altoc/api/v1/service-tickets/${props.ticketId}/knowledge` : `/altoc/api/v1/customers/${props.customerId}/${kind.value === 'assets' ? 'assets-summary' : 'documents-summary'}`)
const columns = computed(() => props.ticketId ? [] : kind.value === 'assets' ? [{ accessorKey: 'deliveryAssetCode', header: '交付资产' }, { accessorKey: 'environmentCode', header: '环境' }] : [{ accessorKey: 'title', header: '文档名称' }, { accessorKey: 'doc_type', header: '类型' }])
const items = computed(() => (state.value?.items || []) as Row[])
let epoch = 0
async function load() {
  const n = ++epoch
  state.value = null
  message.value = ''
  if (!props.ticketId && !props.customerId) return
  pending.value = true
  try {
    const response = await $fetch<{ data: Row }>(api.value, { query: props.ticketId ? {} : { page: page.value, pageSize: 20 } })
    if (n === epoch) state.value = response.data
  } catch {
    if (n === epoch) message.value = '知识或摘要读取失败，请稍后重试'
  } finally {
    if (n === epoch) pending.value = false
  }
}
async function link(resume = false) {
  if (pending.value || !props.canEdit) return
  if (!resume && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(documentUuid.value)) {
    message.value = '请输入已有且有权查看的文档 UUID'
    return
  }
  const path = `${api.value}${resume ? '/resume' : ''}`
  const body = resume ? {} : { documentUuid: documentUuid.value, expectedVersion: props.rowVersion }
  pending.value = true
  try {
    await (resume ? resumeIntent : linkIntent).submit({ path, method: 'POST', body }, async (request, key) => {
      await $fetch(request.path, { method: 'POST', body: request.body, headers: { 'Idempotency-Key': key } })
    })
    linkIntent.reset()
    resumeIntent.reset()
    documentUuid.value = ''
    emit('changed')
    await load()
  } catch {
    await load()
    message.value = '关联未完成；保留原意图，可用“恢复原关联”确认结果，不会创建或发布正文'
  } finally {
    pending.value = false
  }
}
watch([api, page, scope], () => {
  void load()
}, { immediate: true })
watch(kind, () => {
  page.value = 1
})
watch(scope, () => {
  linkIntent.reset()
  resumeIntent.reset()
  documentUuid.value = ''
})
</script>

<template>
  <section class="min-w-0 space-y-3">
    <h2 class="font-semibold">
      {{ ticketId ? '知识关联' : '客户资产与文档' }}
    </h2>
    <p class="text-sm text-muted">
      仅关联已有且有权限的对象，不创建或发布正文，也不扩大分享范围。
    </p>
    <div
      v-if="!ticketId"
      class="flex flex-wrap gap-2"
    >
      <UButton
        color="neutral"
        :variant="kind === 'assets' ? 'solid' : 'outline'"
        @click="kind = 'assets'"
      >
        资产摘要
      </UButton>
      <UButton
        color="neutral"
        :variant="kind === 'documents' ? 'solid' : 'outline'"
        @click="kind = 'documents'"
      >
        文档摘要
      </UButton>
    </div>
    <UAlert
      v-if="message"
      color="error"
      :title="message"
    />
    <UAlert
      v-else-if="state?.access === 'denied'"
      color="neutral"
      title="无权限"
    />
    <template v-else-if="state && ticketId">
      <p
        v-if="state.status === 'idle'"
        class="text-muted"
      >
        尚未关联知识文档
      </p>
      <template v-else>
        <UBadge
          color="neutral"
          variant="subtle"
        >
          {{ state.status === 'linked' ? '已关联' : '待确认' }}
        </UBadge>
        <p class="break-words">
          {{ (state.document as Row)?.title }}
        </p>
      </template>
    </template>
    <template v-else-if="state?.access === 'allowed'">
      <UTable
        :data="items"
        :columns="columns"
        :loading="pending"
      >
        <template #empty>
          <CommonEmptyState title="暂无可见对象" />
        </template>
      </UTable>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm text-muted">共 {{ state.total }} 条</span><UPagination
          v-model:page="page"
          :total="Number(state.total)"
          :items-per-page="20"
        />
      </div>
    </template>
    <div
      v-if="ticketId && canEdit"
      class="flex flex-wrap items-end gap-2"
    >
      <UFormField
        label="已有文档 UUID"
        required
      >
        <UInput
          v-model="documentUuid"
          class="w-full"
          :disabled="pending"
        />
      </UFormField>
      <UButton
        :loading="pending"
        :disabled="state?.status !== 'idle'"
        @click="link()"
      >
        关联知识
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :loading="pending"
        :disabled="state?.status !== 'pending'"
        @click="link(true)"
      >
        恢复原关联
      </UButton>
    </div>
  </section>
</template>
