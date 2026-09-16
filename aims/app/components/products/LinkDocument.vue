<script setup lang="ts">
const props = defineProps<{ productCode: string, workspaceRevision: number, disabled?: boolean, fromTemplate?: boolean }>()
const emit = defineEmits<{ saved: [], busy: [value: boolean] }>()
type Document = { uuid: string, title: string, doc_type: string, updated_at: string }
type SearchPage = { items: Document[], total: number, page: number, pageSize: number }
const open = ref(false), saving = ref(false), loading = ref(false), page = ref(1)
const selected = ref<Document>(), purpose = ref('requirements'), result = ref<SearchPage>()
const title = ref(''), requestId = ref(''), creationStatus = ref('')
const error = ref<unknown>(null), searchError = ref<unknown>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '文档关联失败' })
const searchAlert = useApiErrorAlert(searchError, { fallbackTitle: '文档搜索失败' })
const { search, debounced, flush, reset } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const choices = [{ label: '产品概述', value: 'product-overview' }, { label: '需求说明', value: 'requirements' }, { label: '设计文档', value: 'design' }, { label: '发布说明', value: 'release-notes' }, { label: '使用指南', value: 'user-guide' }, { label: '其他', value: 'other' }]
const modal = computed({ get: () => open.value, set: (value) => {
  if (!saving.value) open.value = value
} })
let generation = 0
let revision = 0
let retry: { payload: string, key: string } | undefined
watch(saving, value => emit('busy', value), { flush: 'sync' })
watch(() => props.productCode, () => {
  open.value = false
  selected.value = undefined
  requestId.value = ''
  creationStatus.value = ''
  retry = undefined
})
watch([open, page, debounced, () => props.productCode], load)
async function load() {
  const request = ++generation
  result.value = undefined
  searchError.value = null
  loading.value = false
  if (!open.value) return
  const product = props.productCode, requestedPage = page.value
  loading.value = true
  try {
    const response = await $fetch<{ code: number, data: SearchPage }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents/search`, { query: { search: debounced.value.trim(), page: requestedPage, pageSize: 10 }, retry: 0, timeout: 30000 })
    const value = response.data
    if (response.code !== 0 || !value || value.page !== requestedPage || value.pageSize !== 10 || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.items) || value.items.length !== Math.min(10, Math.max(0, value.total - (requestedPage - 1) * 10)) || value.items.some(item => !item?.uuid || !item.title) || new Set(value.items.map(item => item.uuid)).size !== value.items.length) throw new Error('文档搜索响应不完整')
    if (request === generation) result.value = value
  } catch (cause) {
    if (request === generation) searchError.value = cause
  } finally {
    if (request === generation) loading.value = false
  }
}
function start() {
  if (props.disabled || saving.value) return
  if (requestId.value) {
    open.value = true
    return
  }
  revision = props.workspaceRevision
  selected.value = undefined
  purpose.value = 'requirements'
  title.value = ''
  error.value = null
  page.value = 1
  reset()
  open.value = true
}
async function save() {
  if (props.fromTemplate) return saveTemplate()
  if (saving.value || !selected.value || props.disabled) return
  const product = props.productCode
  const body = { documentUuid: selected.value.uuid, purpose: purpose.value, expectedRevision: revision }
  const payload = JSON.stringify({ product, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  saving.value = true
  error.value = null
  try {
    const response = await $fetch<{ code: number, data: { value: { product_code: string, document_uuid: string, purpose: string } } }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents/create`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key }, retry: 0, timeout: 20000 })
    const value = response.data?.value
    if (response.code !== 0 || value?.product_code !== product || value.document_uuid !== body.documentUuid || value.purpose !== body.purpose) throw new Error('文档关联响应无效，请重试')
    retry = undefined
    if (props.productCode === product) {
      open.value = false
      emit('saved')
    }
  } catch (cause) {
    if (props.productCode === product) error.value = cause
  } finally { saving.value = false }
}
async function saveTemplate() {
  if (saving.value || props.disabled || (!requestId.value && (!selected.value || !title.value.trim()))) return
  const product = props.productCode
  saving.value = true
  error.value = null
  try {
    if (requestId.value) {
      await $fetch(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents/request-resume`, { method: 'POST', body: { requestBizId: requestId.value }, retry: 0, timeout: 60000 })
      if (props.productCode !== product) return
    }
    if (!requestId.value) {
      const body = { templateUuid: selected.value!.uuid, title: title.value.trim(), purpose: purpose.value, expectedRevision: revision }
      const payload = JSON.stringify({ product, body })
      if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
      const response = await $fetch<{ code: number, data: { requestBizId: string, workspaceRevision: number } }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents/template-create`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key }, retry: 0, timeout: 60000 })
      if (response.code !== 0 || !response.data?.requestBizId) throw new Error('创建请求响应无效，请重试')
      if (props.productCode !== product) return
      requestId.value = response.data.requestBizId
      retry = undefined
    }
    const status = await $fetch<{ code: number, data: { requestBizId: string, status: string, workspaceRevision: number, relationBizId: string } }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents/request-status`, { query: { requestBizId: requestId.value }, retry: 0, timeout: 30000 })
    if (status.code !== 0 || status.data?.requestBizId !== requestId.value) throw new Error('创建状态响应无效，请重试')
    if (props.productCode !== product) return
    creationStatus.value = status.data.status
    if (status.data.status !== 'succeeded') return
    if (!status.data.relationBizId) {
      const body = { requestBizId: requestId.value, expectedRevision: status.data.workspaceRevision }
      const payload = JSON.stringify({ product, body })
      if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
      const linked = await $fetch<{ code: number, data: { bizId: string } }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents/link-created`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key }, retry: 0, timeout: 30000 })
      if (linked.code !== 0 || !linked.data?.bizId) throw new Error('文档关联响应无效，请重试')
    }
    if (props.productCode === product) {
      requestId.value = ''
      creationStatus.value = ''
      retry = undefined
      open.value = false
      emit('saved')
    }
  } catch (cause) {
    if (props.productCode === product) error.value = cause
  } finally {
    saving.value = false
  }
}
const statusMessage = computed(() => ['failed_permanent', 'dead_letter', 'cancelled'].includes(creationStatus.value)
  ? '创建未能完成，请联系管理员检查此请求。'
  : creationStatus.value === 'succeeded' ? '文档已创建，正在完成产品关联。' : '创建请求已保存，可稍后刷新状态并完成关联。')
function resume(request: string) {
  if (!props.fromTemplate || props.disabled || saving.value) return
  requestId.value = request
  creationStatus.value = ''
  error.value = null
  retry = undefined
  open.value = true
}
defineExpose({ resume })
</script>

<template>
  <UButton icon="i-lucide-link" :disabled="disabled || saving" @click="start">
    {{ fromTemplate ? (requestId ? '查看创建进度' : '从模板创建') : '关联已有文档' }}
  </UButton>
  <UModal
    v-model:open="modal"
    :title="fromTemplate ? '从模板创建文档' : '关联已有文档'"
    description="搜索你有权访问的 Codocs 文档，选择文档及其在产品中的用途。"
    :dismissible="!saving"
  >
    <template #body>
      <div class="min-w-0 space-y-4">
        <UAlert
          v-if="requestId"
          color="info"
          :title="statusMessage"
          :description="'请求编号：' + requestId"
        />
        <template v-if="!requestId">
          <UInput
            v-model="search"
            aria-label="搜索文档标题"
            placeholder="搜索文档标题"
            icon="i-lucide-search"
            :maxlength="200"
            :disabled="saving"
            class="w-full"
            @keyup.enter="flush"
          />
          <UAlert v-if="searchAlert" v-bind="searchAlert" />
          <UButton
            v-if="searchError"
            color="neutral"
            variant="outline"
            :disabled="saving"
            @click="load"
          >
            重试搜索
          </UButton>
          <p v-if="loading" role="status" class="text-sm text-muted">
            正在搜索文档…
          </p>
          <div v-else-if="result?.items.length" class="max-h-64 space-y-2 overflow-y-auto" aria-label="搜索结果">
            <UButton
              v-for="document in result.items"
              :key="document.uuid"
              :aria-pressed="selected?.uuid === document.uuid"
              :variant="selected?.uuid === document.uuid ? 'soft' : 'outline'"
              color="neutral"
              :disabled="saving"
              class="w-full justify-start whitespace-normal text-left"
              @click="selected = document"
            >
              <span class="min-w-0 break-words">{{ document.title }}</span>
            </UButton>
          </div>
          <CommonEmptyState
            v-else-if="result"
            icon="i-lucide-files"
            title="暂无可见文档"
            description="可调整搜索词，或先在 Codocs 创建文档。"
          />
          <div v-if="result" class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm text-muted">共 {{ result.total }} 个文档</span>
            <UPagination
              v-model:page="page"
              :items-per-page="10"
              :total="result.total"
              :sibling-count="0"
              :disabled="saving || loading"
            />
          </div>
          <p v-if="selected" class="break-words text-sm">
            已选择：{{ selected.title }}
          </p>
          <UFormField v-if="fromTemplate" label="新文档标题" required>
            <UInput
              v-model="title"
              :maxlength="200"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <UFormField label="文档用途">
            <USelect
              v-model="purpose"
              :items="choices"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
        </template>
        <UAlert v-if="alert" v-bind="alert" />
        <p v-if="error" class="text-sm text-muted">
          选择已保留，可重试。若关联已存在，请查看有效或已解除关联列表；若修订冲突，请关闭弹窗并刷新后重试。
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="saving"
          @click="modal = false"
        >
          取消
        </UButton>
        <UButton :loading="saving" :disabled="!requestId && (!selected || (fromTemplate && !title.trim()))" @click="save">
          {{ fromTemplate ? (requestId ? '刷新状态并关联' : '创建并关联') : '确认关联' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
