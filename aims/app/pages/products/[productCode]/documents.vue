<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '产品文档', layoutHeaderProjectSwitcher: false })
const templateCreator = ref<{ resume: (request: string) => void }>()
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const purpose = ref('all'), removed = ref('false'), page = ref(1)
const purposes = [{ label: '全部用途', value: 'all' }, { label: '产品概述', value: 'product-overview' }, { label: '需求说明', value: 'requirements' }, { label: '设计文档', value: 'design' }, { label: '发布说明', value: 'release-notes' }, { label: '使用指南', value: 'user-guide' }, { label: '其他', value: 'other' }]
const states = [{ label: '有效关联', value: 'false' }, { label: '已解除关联', value: 'true' }]
type Row = { biz_id: string, product_code: string, document_uuid: string, purpose: string, revision: number, removed: boolean, metadata: { uuid: string, title: string, doc_type: string, updated_at: string } }
type Page = { canEdit: boolean, product_code: string, workspace_revision: number, items: Row[], total: number, restrictedCount: number, page: number, pageSize: number }
const { data, status, error, refresh } = await useAsyncData(() => `product-documents:${code.value}`, async () => {
  const product = code.value, requestedPage = page.value, requestedPurpose = purpose.value, requestedRemoved = removed.value
  const response = await $fetch<{ code: number, data: Page }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents`, { query: { page: requestedPage, pageSize: 20, removed: requestedRemoved, ...(requestedPurpose === 'all' ? {} : { purpose: requestedPurpose }) }, retry: 0, timeout: 30000 })
  const value = response.data
  if (response.code !== 0 || !value || typeof value.canEdit !== 'boolean' || value.product_code !== product || !Number.isSafeInteger(value.workspace_revision) || value.workspace_revision < 1 || value.page !== requestedPage || value.pageSize !== 20 || ![value.total, value.restrictedCount].every(n => Number.isSafeInteger(n) && n >= 0) || !Array.isArray(value.items) || value.items.length !== Math.min(20, Math.max(0, value.total - (requestedPage - 1) * 20)) || value.items.some(row => !row || row.product_code !== product || row.removed !== (requestedRemoved === 'true') || !row.metadata || row.metadata.uuid !== row.document_uuid || !row.metadata.title || !purposes.some(item => item.value === row.purpose && item.value !== 'all') || (requestedPurpose !== 'all' && row.purpose !== requestedPurpose))) throw new Error('产品文档列表响应不完整')
  return value
}, { server: false, watch: [purpose, removed, page] })
const saving = ref(false)
const busy = computed(() => status.value === 'pending' || saving.value)
const alert = useApiErrorAlert(error, { fallbackTitle: '产品文档读取失败' })
const columns: TableColumn<Row>[] = [{ id: 'title', header: '文档名称' }, { id: 'purpose', header: '用途' }, { id: 'updated', header: '文档更新时间' }, { id: 'actions', header: '操作' }]
const { confirm } = useConfirm()
const mutationError = ref<unknown>(null)
const mutationAlert = useApiErrorAlert(mutationError, { fallbackTitle: '文档关联操作失败' })
const pending = new Map<string, { key: string, body: { bizId: string, expectedRevision: number, expectedDocumentRevision: number } }>()
async function transitionDocument(row: Row) {
  if (busy.value || !data.value?.canEdit) return
  const action = row.removed ? 'restore' : 'remove'
  const label = row.removed ? '恢复关联' : '解除关联'
  const product = code.value
  const revision = data.value.workspace_revision
  if (!await confirm({ title: label, message: row.removed ? `恢复“${row.metadata.title}”与此产品的关联。将重新检查文档访问权限，不会扩大共享范围。` : `解除“${row.metadata.title}”与此产品的关联。Codocs 文档及其访问权限将保留。`, tone: 'warning', confirmLabel: label })) return
  if (code.value !== product || busy.value) return
  const identity = `${product}:${row.biz_id}:${action}`
  const attempt = pending.get(identity) || { key: crypto.randomUUID(), body: { bizId: row.biz_id, expectedRevision: revision, expectedDocumentRevision: row.revision } }
  pending.set(identity, attempt)
  saving.value = true
  mutationError.value = null
  try {
    const response = await $fetch<{ code: number, data: { value: { biz_id: string, product_code: string, removed: boolean } } }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents/${action}`, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: attempt.body, retry: 0, timeout: 20000 })
    const result = response.data?.value
    if (response.code !== 0 || result?.biz_id !== row.biz_id || result.product_code !== product || result.removed !== (action === 'remove')) throw new Error('文档关联响应无效，请重试')
    pending.delete(identity)
    if (code.value === product) {
      if (page.value !== 1) page.value = 1
      else await refresh()
    }
  } catch (error) {
    mutationError.value = error
    const statusCode = Number((error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status)
    if ([400, 401, 403, 404, 409].includes(statusCode)) pending.delete(identity)
  } finally { saving.value = false }
}
watch([purpose, removed, code], () => {
  page.value = 1
})
</script>

<template>
  <div class="mx-auto min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
    <p class="text-sm text-muted">
      查看产品关联文档。文档内容及访问权限由 Codocs 管理。
    </p>
    <ProductsLinkDocument
      v-if="data?.canEdit"
      :product-code="code"
      :workspace-revision="data.workspace_revision"
      :disabled="busy || status !== 'success'"
      @busy="saving = $event"
      @saved="refresh()"
    />
    <ProductsLinkDocument
      v-if="data?.canEdit"
      ref="templateCreator"
      from-template
      :product-code="code"
      :workspace-revision="data.workspace_revision"
      :disabled="busy || status !== 'success'"
      @busy="saving = $event"
      @saved="refresh()"
    />
    <ProductsDocumentRequests
      v-if="data?.canEdit"
      :product-code="code"
      :disabled="busy || status !== 'success'"
      @resume="templateCreator?.resume($event)"
    />
    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="文档用途">
        <USelect
          v-model="purpose"
          :items="purposes"
          :disabled="busy"
          class="w-44"
        />
      </UFormField>
      <UFormField label="关联状态">
        <USelect
          v-model="removed"
          :items="states"
          :disabled="busy"
          class="w-44"
        />
      </UFormField>
      <UButton
        :loading="busy"
        color="neutral"
        variant="outline"
        @click="refresh()"
      >
        刷新文档
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="mutationAlert" v-bind="mutationAlert" />
    <UAlert
      v-if="status === 'success' && data?.restrictedCount"
      color="warning"
      icon="i-lucide-lock-keyhole"
      :title="`${data.restrictedCount} 个关联文档当前不可见`"
      description="文档未授权或已停用，可见列表不包含这些文档。"
    />
    <p class="text-xs text-muted sm:hidden">
      表格可左右滑动查看完整信息。
    </p>
    <div class="overflow-x-auto">
      <UTable
        :data="status === 'success' ? data?.items || [] : []"
        :columns="columns"
        :loading="busy"
        class="min-w-[580px]"
      >
        <template #title-cell="{ row }">
          <span class="block max-w-sm whitespace-normal break-words font-medium">{{ row.original.metadata.title }}</span>
        </template>
        <template #purpose-cell="{ row }">
          {{ purposes.find(item => item.value === row.original.purpose)?.label }}
        </template>
        <template #updated-cell="{ row }">
          {{ row.original.metadata.updated_at }}
        </template>
        <template #actions-cell="{ row }">
          <ProductsPreviewDocument
            v-if="!row.original.removed"
            :product-code="code"
            :biz-id="row.original.biz_id"
            :document-uuid="row.original.document_uuid"
            :disabled="busy"
          />
          <ProductsEditDocumentPurpose
            v-if="data?.canEdit && !row.original.removed"
            :product-code="code"
            :biz-id="row.original.biz_id"
            :title="row.original.metadata.title"
            :purpose="row.original.purpose"
            :revision="row.original.revision"
            :workspace-revision="data.workspace_revision"
            :disabled="busy"
            @busy="saving = $event"
            @saved="refresh()"
          />
          <UButton
            v-if="data?.canEdit"
            color="warning"
            variant="ghost"
            :disabled="busy"
            @click="transitionDocument(row.original)"
          >
            {{ row.original.removed ? '恢复关联' : '解除关联' }}
          </UButton>
          <span v-else class="text-muted">—</span>
        </template>
        <template #empty>
          <CommonEmptyState icon="i-lucide-files" :title="error ? '文档暂不可用' : '暂无可见文档'" :description="error ? '请刷新重试。' : '可调整用途或关联状态筛选。'" />
        </template>
      </UTable>
    </div>
    <div v-if="status === 'success' && data" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ data.total }} 个可见文档</span>
      <UPagination
        v-model:page="page"
        :items-per-page="20"
        :total="data.total"
        :disabled="busy"
      />
    </div>
  </div>
</template>
