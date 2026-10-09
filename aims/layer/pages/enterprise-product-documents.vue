<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import PreviewDocument from '../../app/components/products/PreviewDocument.vue'
import { useAimsModule } from '../useAimsModule'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '产品资料', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const { moduleUrl } = useAimsModule()
const code = computed(() => String(route.params.productCode || ''))
const base = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/roadmaps/documents`))
const section = ref<'documents' | 'requests'>('documents')
const purpose = ref('all')
const searchInput = ref('')
const search = ref('')
const page = ref(1)
const pageSize = 20
watch([code, section, purpose, search], () => {
  page.value = 1
})

interface DocumentRow {
  biz_id: string
  document_uuid: string
  purpose: string
  metadata: { uuid: string, title: string, doc_type: string, updated_at: string }
}
interface RequestRow { biz_id: string, purpose: string, status: string, linked: boolean }
interface Page<T> { product_code: string, workspace_revision: number, canEdit?: boolean, items: T[], total: number, page: number, pageSize: number }
const endpoint = computed(() => section.value === 'requests' ? `${base.value}/requests` : search.value ? `${base.value}/search` : base.value)
const query = computed(() => ({ page: page.value, pageSize, ...(section.value === 'requests' ? {} : { ...(purpose.value === 'all' ? {} : { purpose: purpose.value }), ...(search.value ? { search: search.value } : {}) }) }))
const { data, status, error, refresh } = await useFetch(endpoint, {
  server: false,
  query,
  transform: (response: { code: number, data: Page<DocumentRow | RequestRow> }) => {
    if (response.code !== 0 || response.data?.product_code !== code.value || !Array.isArray(response.data.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0) throw new Error('产品资料响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '产品资料加载失败' })
const documentRows = computed(() => section.value === 'documents' && status.value === 'success' ? data.value?.items as DocumentRow[] || [] : [])
const requestRows = computed(() => section.value === 'requests' && status.value === 'success' ? data.value?.items as RequestRow[] || [] : [])
const documentColumns: TableColumn<DocumentRow>[] = [
  { accessorKey: 'metadata.title', header: '资料名称' }, { accessorKey: 'purpose', header: '用途' },
  { id: 'updated', header: '更新时间' }, { accessorKey: 'actions', header: '操作' }
]
const requestColumns: TableColumn<RequestRow>[] = [
  { accessorKey: 'biz_id', header: '申请编号' }, { accessorKey: 'purpose', header: '用途' },
  { accessorKey: 'status', header: '状态' }, { accessorKey: 'linked', header: '关联结果' }
]
const purposeOptions = [
  { label: '全部用途', value: 'all' }, { label: '产品概览', value: 'product-overview' },
  { label: '需求', value: 'requirements' }, { label: '设计', value: 'design' },
  { label: '发布说明', value: 'release-notes' }, { label: '使用指南', value: 'user-guide' },
  { label: '其他', value: 'other' }
]
const purposeLabel = (value: string) => purposeOptions.find(item => item.value === value)?.label || value
function submitSearch() {
  search.value = searchInput.value.trim()
}
const linkOpen = ref(false)
const linkDocumentUuid = ref('')
const linkPurpose = ref('requirements')
const linkBusy = ref(false)
const linkError = ref<unknown>(null)
const linkAlert = useApiErrorAlert(linkError, { fallbackTitle: '资料关联失败' })
type PickerDocument = { uuid: string, title: string, updatedAt?: string }
const pickerSource = ref<'personal' | 'shared'>('personal')
const pickerInput = ref('')
const pickerSearch = ref('')
const pickerPage = ref(1)
const pickerLoading = ref(false)
const pickerError = ref<unknown>(null)
const pickerAlert = useApiErrorAlert(pickerError, { fallbackTitle: '文档搜索失败' })
const pickerItems = ref<PickerDocument[]>([])
const pickerTotal = ref(0)
const selectedDocument = ref<PickerDocument>()
const manualEntry = ref(false)
let pickerGeneration = 0
const pickerPageSize = 20
const visiblePickerItems = computed(() => pickerSource.value === 'shared'
  ? pickerItems.value.slice((pickerPage.value - 1) * pickerPageSize, pickerPage.value * pickerPageSize)
  : pickerItems.value)

async function loadPicker() {
  const generation = ++pickerGeneration
  pickerItems.value = []
  pickerTotal.value = 0
  pickerError.value = null
  if (!linkOpen.value) return
  pickerLoading.value = true
  try {
    if (pickerSource.value === 'personal') {
      const response = await $fetch<{ data?: { items?: Array<{ uuid: string, title: string, updated_at?: string }>, total?: number } }>('/codocs/api/documents', {
        query: { type: 'private', ...(pickerSearch.value ? { search: pickerSearch.value } : {}), page: pickerPage.value, pageSize: pickerPageSize }, retry: 0
      })
      const items = response.data?.items
      if (!Array.isArray(items) || !Number.isSafeInteger(response.data?.total) || Number(response.data?.total) < 0 || items.some(item => !item?.uuid || typeof item.title !== 'string')) throw new Error('个人文档搜索响应不完整')
      if (generation === pickerGeneration) {
        pickerItems.value = items.map(item => ({ uuid: item.uuid, title: item.title, updatedAt: item.updated_at }))
        pickerTotal.value = Number(response.data?.total)
      }
    } else {
      const response = await $fetch<{ code: number, data?: { items?: Array<{ uuid: string, title: string, updatedAt?: string }>, total?: number } }>('/codocs/api/collab-docs', {
        query: { category: 'shared', scope: 'all', keyword: pickerSearch.value }, retry: 0
      })
      const items = response.data?.items
      if (response.code !== 0 || !Array.isArray(items) || !Number.isSafeInteger(response.data?.total) || Number(response.data?.total) < 0 || items.some(item => !item?.uuid || typeof item.title !== 'string')) throw new Error('共享文档搜索响应不完整')
      if (generation === pickerGeneration) {
        pickerItems.value = items.map(item => ({ uuid: item.uuid, title: item.title, updatedAt: item.updatedAt }))
        pickerTotal.value = items.length
      }
    }
  } catch (cause) {
    if (generation === pickerGeneration) pickerError.value = cause
  } finally {
    if (generation === pickerGeneration) pickerLoading.value = false
  }
}
watch([linkOpen, pickerSource, pickerSearch, code, () => pickerSource.value === 'personal' ? pickerPage.value : 1], loadPicker)
watch(linkOpen, (open) => {
  if (open) return
  selectedDocument.value = undefined
  linkDocumentUuid.value = ''
  pickerInput.value = ''
  pickerSearch.value = ''
  pickerPage.value = 1
  pickerSource.value = 'personal'
  manualEntry.value = false
})
function submitPickerSearch() {
  const next = pickerInput.value.trim()
  pickerPage.value = 1
  if (next === pickerSearch.value) void loadPicker()
  else pickerSearch.value = next
}
function chooseDocument(document: PickerDocument) {
  selectedDocument.value = document
  linkDocumentUuid.value = document.uuid
  manualEntry.value = false
}
let retry: { payload: string, key: string } | undefined
async function linkDocument() {
  if (linkBusy.value || !data.value?.canEdit || !Number.isSafeInteger(data.value.workspace_revision)) return
  const product = code.value
  const body = { documentUuid: linkDocumentUuid.value.trim(), purpose: linkPurpose.value, expectedRevision: data.value.workspace_revision }
  const payload = JSON.stringify({ product, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  linkBusy.value = true
  linkError.value = null
  try {
    const response = await $fetch<{ code: number, data: { value?: { product_code?: string, document_uuid?: string } } }>(base.value, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key }, retry: 0 })
    if (response.code !== 0 || response.data?.value?.product_code !== product || response.data.value.document_uuid !== body.documentUuid) throw new Error('资料关联响应无效')
    retry = undefined
    linkOpen.value = false
    linkDocumentUuid.value = ''
    selectedDocument.value = undefined
    await refresh()
  } catch (cause) {
    linkError.value = cause
    const status = Number((cause as { statusCode?: number }).statusCode)
    if ([400, 401, 403, 404, 409].includes(status)) retry = undefined
  } finally { linkBusy.value = false }
}
watch(code, () => {
  linkOpen.value = false
  retry = undefined
  selectedDocument.value = undefined
  linkDocumentUuid.value = ''
})
</script>

<template>
  <div class="mx-auto min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">
          产品资料
        </h1>
        <p class="mt-1 text-sm text-muted">
          查看已关联且当前有权阅读的正式资料。关联不会改变 Codocs 的正文权限。
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton v-if="data?.canEdit && section === 'documents'" icon="i-lucide-link" @click="linkOpen = true">
          关联已有文档
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="status === 'pending'"
          @click="refresh()"
        >
          刷新
        </UButton>
      </div>
    </div>
    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="内容">
        <USelect v-model="section" :items="[{ label: '正式资料', value: 'documents' }, { label: '创建申请', value: 'requests' }]" />
      </UFormField>
      <template v-if="section === 'documents'">
        <UFormField label="用途">
          <USelect v-model="purpose" :items="purposeOptions" />
        </UFormField>
        <UFormField label="资料名称">
          <UInput v-model="searchInput" placeholder="按名称筛选" @keyup.enter="submitSearch" />
        </UFormField>
        <UButton color="primary" variant="outline" @click="submitSearch">
          查询
        </UButton>
      </template>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <UModal
      v-model:open="linkOpen"
      title="关联已有文档"
      description="查找你当前可见的 Codocs 文档，关联时仍会重新检查文档权限。"
      :dismissible="!linkBusy"
    >
      <template #body>
        <div class="space-y-4">
          <div class="flex flex-wrap gap-2">
            <UButton
              :variant="pickerSource === 'personal' ? 'soft' : 'outline'"
              color="neutral"
              :disabled="linkBusy"
              @click="pickerSource = 'personal'; pickerPage = 1"
            >
              我的文档
            </UButton>
            <UButton
              :variant="pickerSource === 'shared' ? 'soft' : 'outline'"
              color="neutral"
              :disabled="linkBusy"
              @click="pickerSource = 'shared'; pickerPage = 1"
            >
              共享文档
            </UButton>
          </div>
          <div class="flex gap-2">
            <UInput
              v-model="pickerInput"
              aria-label="搜索文档标题"
              placeholder="按文档标题搜索"
              :disabled="linkBusy"
              class="min-w-0 flex-1"
              @keyup.enter="submitPickerSearch"
            />
            <UButton
              color="neutral"
              variant="outline"
              :disabled="linkBusy"
              @click="submitPickerSearch"
            >
              查找
            </UButton>
          </div>
          <UAlert v-if="pickerAlert" v-bind="pickerAlert" />
          <p v-if="pickerLoading" role="status" class="text-sm text-muted">
            正在查找文档…
          </p>
          <div v-else-if="visiblePickerItems.length" class="max-h-56 space-y-1 overflow-y-auto" aria-label="可选文档">
            <UButton
              v-for="document in visiblePickerItems"
              :key="document.uuid"
              :variant="linkDocumentUuid === document.uuid ? 'soft' : 'ghost'"
              color="neutral"
              class="w-full justify-start text-left"
              :disabled="linkBusy"
              @click="chooseDocument(document)"
            >
              {{ document.title }}
            </UButton>
          </div>
          <p v-else-if="!pickerError" class="text-sm text-muted">
            没有找到可选文档。
          </p>
          <UPagination
            v-if="pickerTotal > pickerPageSize"
            v-model:page="pickerPage"
            :total="pickerTotal"
            :items-per-page="pickerPageSize"
          />
          <p v-if="selectedDocument && linkDocumentUuid === selectedDocument.uuid" class="text-sm">
            已选择：{{ selectedDocument.title }}
          </p>
          <UButton
            color="neutral"
            variant="link"
            :disabled="linkBusy"
            @click="manualEntry = !manualEntry"
          >
            {{ manualEntry ? '收起手动输入' : '已有文档 UUID？手动输入' }}
          </UButton>
          <UFormField v-if="manualEntry" label="文档 UUID" required>
            <UInput
              v-model="linkDocumentUuid"
              class="w-full"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              @update:model-value="selectedDocument = undefined"
            />
          </UFormField>
          <UFormField label="用途" required>
            <USelect v-model="linkPurpose" :items="purposeOptions.filter(item => item.value !== 'all')" class="w-full" />
          </UFormField>
          <UAlert v-if="linkAlert" v-bind="linkAlert" />
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              :disabled="linkBusy"
              @click="linkOpen = false"
            >
              取消
            </UButton><UButton :loading="linkBusy" :disabled="!linkDocumentUuid.trim()" @click="linkDocument">
              确认关联
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
    <template v-if="section === 'documents'">
      <div class="space-y-3 sm:hidden">
        <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
          正在加载产品资料…
        </p>
        <article v-for="row in documentRows" :key="row.biz_id" class="space-y-2 rounded-lg border border-default p-3">
          <h2 class="break-words font-medium">
            {{ row.metadata.title }}
          </h2>
          <p class="text-sm text-muted">
            {{ purposeLabel(row.purpose) }} · 更新于 {{ formatDateTime(row.metadata.updated_at) }}
          </p>
          <PreviewDocument :product-code="code" :biz-id="row.biz_id" :document-uuid="row.document_uuid" />
        </article>
        <CommonEmptyState
          v-if="status === 'success' && !documentRows.length"
          icon="i-lucide-files"
          title="暂无可见资料"
          description="可调整用途或名称后重试。"
        />
      </div>
      <div class="hidden sm:block">
        <UTable :data="documentRows" :columns="documentColumns" :loading="status === 'pending'">
          <template #purpose-cell="{ row }">
            {{ purposeLabel(row.original.purpose) }}
          </template>
          <template #updated-cell="{ row }">
            {{ formatDateTime(row.original.metadata.updated_at) }}
          </template>
          <template #actions-cell="{ row }">
            <PreviewDocument :product-code="code" :biz-id="row.original.biz_id" :document-uuid="row.original.document_uuid" />
          </template>
          <template #empty>
            <CommonEmptyState icon="i-lucide-files" title="暂无可见资料" description="可调整用途或名称后重试。" />
          </template>
        </UTable>
      </div>
    </template>
    <template v-else>
      <div class="space-y-3 sm:hidden">
        <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
          正在加载创建申请…
        </p>
        <article v-for="row in requestRows" :key="row.biz_id" class="space-y-1 rounded-lg border border-default p-3">
          <h2 class="break-all font-medium">
            {{ row.biz_id }}
          </h2>
          <p class="text-sm text-muted">
            {{ purposeLabel(row.purpose) }} · {{ row.status }}
          </p>
          <p class="text-sm text-muted">
            {{ row.linked ? '已关联' : '未关联' }}
          </p>
        </article>
        <CommonEmptyState v-if="status === 'success' && !requestRows.length" icon="i-lucide-file-clock" title="暂无创建申请" />
      </div>
      <div class="hidden sm:block">
        <UTable :data="requestRows" :columns="requestColumns" :loading="status === 'pending'">
          <template #purpose-cell="{ row }">
            {{ purposeLabel(row.original.purpose) }}
          </template>
          <template #linked-cell="{ row }">
            {{ row.original.linked ? '已关联' : '未关联' }}
          </template>
          <template #empty>
            <CommonEmptyState icon="i-lucide-file-clock" title="暂无创建申请" />
          </template>
        </UTable>
      </div>
    </template>
    <div v-if="status === 'success'" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ data?.total || 0 }} 条</span>
      <UPagination
        v-model:page="page"
        :total="data?.total || 0"
        :items-per-page="pageSize"
        :sibling-count="1"
      />
    </div>
  </div>
</template>
