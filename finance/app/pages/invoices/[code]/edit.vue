<script setup lang="ts">
type RuntimeEnvelope<T> = {
  code?: number
  data?: T
  message?: string
}

type InvoiceFileViewResponse = RuntimeEnvelope<{
  url?: string
  expiresIn?: number
  legacy?: boolean
}>

type InvoiceRow = Record<string, unknown>

interface InvoiceEditForm {
  invoiceNo: string
  invoiceType: string
  invoiceMedium: string
  invoiceItem: string
  invoiceAmount: string
  taxRate: string
  taxAmount: string
  amountTaxExclusive: string
  invoiceDate: string
  customerCode: string
  customerName: string
  contractCode: string
  projectCode: string
  receivablePlanCode: string
  taxpayerName: string
  taxpayerNo: string
  receiverName: string
  remark: string
  invoiceFileUrl: string
  invoiceFileName: string
  invoiceFileMimeType: string
  invoiceFileSize: string
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { resolveCurrentAppPath } = useAppUrls()
const { loadAuthorization, getAuthorization } = useAuthorization()
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
const props = defineProps<{
  code?: string
}>()

const code = computed(() => String(props.code || route.params.code || '').trim())
const invoice = ref<InvoiceRow | null>(null)
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const currentUserId = ref('')
const replacementFile = ref<File | null>(null)
const previewOpen = ref(false)
const previewUrl = ref('')
const previewTitle = ref('发票预览')
const previewMimeType = ref('')
const previewLoading = ref(false)
const redReverseModalOpen = ref(false)
const redReverseReason = ref('')
const redReverseInvoiceNo = ref('')
const redReversePending = ref(false)
const deleteModalOpen = ref(false)
const deleteReason = ref('')
const deletePending = ref(false)

const invoiceMediumOptions = [
  { label: '电子发票', value: 'electronic' },
  { label: '纸质发票', value: 'paper' }
]

const form = reactive<InvoiceEditForm>({
  invoiceNo: '',
  invoiceType: '',
  invoiceMedium: 'electronic',
  invoiceItem: '',
  invoiceAmount: '',
  taxRate: '',
  taxAmount: '',
  amountTaxExclusive: '',
  invoiceDate: '',
  customerCode: '',
  customerName: '',
  contractCode: '',
  projectCode: '',
  receivablePlanCode: '',
  taxpayerName: '',
  taxpayerNo: '',
  receiverName: '',
  remark: '',
  invoiceFileUrl: '',
  invoiceFileName: '',
  invoiceFileMimeType: '',
  invoiceFileSize: ''
})

const title = computed(() => {
  const number = form.invoiceNo || code.value
  return number ? `编辑发票 ${number}` : '编辑发票'
})
const canEditInvoice = computed(() => permissionsLoaded.value && hasPermission('invoices', 'edit'))
const canAdminInvoices = computed(() => permissionsLoaded.value && hasPermission('invoices', 'admin'))
const invoiceStatus = computed(() => String(invoice.value?.status || '').trim())
const invoiceStatusLabel = computed(() => formatStatus(invoiceStatus.value))
const currentFileRow = computed<InvoiceRow>(() => ({
  invoice_file_url: form.invoiceFileUrl,
  invoice_file_name: form.invoiceFileName,
  invoice_file_mime_type: form.invoiceFileMimeType,
  invoice_no: form.invoiceNo,
  code: code.value
}))

const previewKind = computed(() => {
  const mimeType = previewMimeType.value.toLowerCase()
  const extension = previewFileExtension(previewUrl.value, previewTitle.value)
  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image'
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (mimeType === 'application/ofd' || extension === 'ofd') return 'ofd'
  return 'other'
})

usePageTitle(title)

onMounted(async () => {
  await Promise.all([loadPermissions(), loadCurrentUser()])
  await loadInvoice()
})

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function formValue(row: InvoiceRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null) return String(value)
  }
  return ''
}

function dateValue(value: unknown) {
  const text = stringValue(value)
  return text ? text.slice(0, 10) : ''
}

function formatStatus(value: unknown) {
  const key = stringValue(value)
  const labels: Record<string, string> = {
    draft: '草稿',
    issued: '已开票',
    red_reversed: '已红冲',
    canceled: '已取消'
  }
  return labels[key] || key || '-'
}

function populateForm(row: InvoiceRow) {
  form.invoiceNo = formValue(row, 'invoice_no', 'invoiceNo')
  form.invoiceType = formValue(row, 'invoice_type', 'invoiceType')
  form.invoiceMedium = formValue(row, 'invoice_medium', 'invoiceMedium') || 'electronic'
  form.invoiceItem = formValue(row, 'invoice_item', 'invoiceItem')
  form.invoiceAmount = formValue(row, 'invoice_amount', 'invoiceAmount')
  form.taxRate = formValue(row, 'tax_rate', 'taxRate')
  form.taxAmount = formValue(row, 'tax_amount', 'taxAmount')
  form.amountTaxExclusive = formValue(row, 'amount_tax_exclusive', 'amountTaxExclusive')
  form.invoiceDate = dateValue(row.invoice_date || row.invoiceDate)
  form.customerCode = formValue(row, 'customer_code', 'customerCode')
  form.customerName = formValue(row, 'customer_name', 'customerName')
  form.contractCode = formValue(row, 'contract_code', 'contractCode')
  form.projectCode = formValue(row, 'project_code', 'projectCode')
  form.receivablePlanCode = formValue(row, 'receivable_plan_code', 'receivablePlanCode')
  form.taxpayerName = formValue(row, 'taxpayer_name', 'taxpayerName')
  form.taxpayerNo = formValue(row, 'taxpayer_no', 'taxpayerNo')
  form.receiverName = formValue(row, 'receiver_name', 'receiverName')
  form.remark = formValue(row, 'remark')
  form.invoiceFileUrl = formValue(row, 'invoice_file_url', 'invoiceFileUrl')
  form.invoiceFileName = formValue(row, 'invoice_file_name', 'invoiceFileName')
  form.invoiceFileMimeType = formValue(row, 'invoice_file_mime_type', 'invoiceFileMimeType')
  form.invoiceFileSize = formValue(row, 'invoice_file_size', 'invoiceFileSize')
}

async function loadCurrentUser() {
  const auth = await loadAuthorization()
  currentUserId.value = auth?.uid || getAuthorization()?.uid || ''
}

async function loadInvoice() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await $fetch<RuntimeEnvelope<InvoiceRow>>(financeApiPath(`/invoices/${encodeURIComponent(code.value)}`))
    if (!response.data) throw new Error(response.message || '发票不存在')
    invoice.value = response.data
    populateForm(response.data)
  } catch (error) {
    loadError.value = errorText(error, '发票加载失败')
  } finally {
    loading.value = false
  }
}

function errorText(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { message?: string, statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return String(candidate?.data?.message || candidate?.data?.statusMessage || candidate?.statusMessage || candidate?.message || fallback)
}

function invoiceFileUrl(row: InvoiceRow) {
  return stringValue(row.invoice_file_url || row.invoiceFileUrl)
}

function invoiceFileName(row: InvoiceRow) {
  return stringValue(row.invoice_file_name || row.invoiceFileName || row.invoice_no || row.invoiceNo || row.code || '发票文件')
}

function invoiceFileMimeType(row: InvoiceRow) {
  return stringValue(row.invoice_file_mime_type || row.invoiceFileMimeType)
}

function invoiceFilePreviewUrl(row: InvoiceRow) {
  const params = new URLSearchParams()
  params.set('url', invoiceFileUrl(row))
  const name = invoiceFileName(row)
  const mimeType = invoiceFileMimeType(row)
  if (name) params.set('name', name)
  if (mimeType) params.set('mimeType', mimeType)
  params.set('format', 'json')
  return resolveCurrentAppPath(`${financeApiPath('/invoices/files/view')}?${params.toString()}`)
}

function previewFileExtension(url: string, name = '') {
  const source = (name || url).split(/[?#]/)[0] || ''
  const index = source.lastIndexOf('.')
  return index >= 0 ? source.slice(index + 1).toLowerCase() : ''
}

async function openInvoiceFile() {
  const row = currentFileRow.value
  const url = invoiceFileUrl(row)
  if (!url) {
    toast.add({ title: '该发票尚未上传文件', color: 'warning' })
    return
  }

  previewLoading.value = true
  try {
    const response = await $fetch<InvoiceFileViewResponse>(invoiceFilePreviewUrl(row))
    const signedUrl = stringValue(response.data?.url)
    if (!signedUrl) throw new Error(response.message || '发票文件预览地址无效')
    previewUrl.value = signedUrl
    previewTitle.value = invoiceFileName(row)
    previewMimeType.value = invoiceFileMimeType(row)
    previewOpen.value = true
  } catch (error) {
    toast.add({ title: errorText(error, '发票文件预览失败'), color: 'error' })
  } finally {
    previewLoading.value = false
  }
}

function openPreviewExternal() {
  if (!previewUrl.value) return
  window.open(previewUrl.value, '_blank', 'noopener,noreferrer')
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  replacementFile.value = input.files?.[0] || null
}

function validateInvoiceFile(medium: string, file: File) {
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : ''
  if (medium === 'paper') {
    if (extension !== 'pdf' && file.type !== 'application/pdf') {
      throw new Error('纸质发票扫描件只支持 PDF 文件')
    }
    return
  }
  if (!['pdf', 'ofd'].includes(extension)) {
    throw new Error('电子发票只支持 PDF 或 OFD 文件')
  }
}

async function uploadInvoiceFile(medium: string, file: File) {
  const formData = new FormData()
  formData.append('invoiceMedium', medium)
  formData.append('file', file)
  const response = await $fetch<RuntimeEnvelope<{
    url: string
    fileName: string
    mimeType: string
    size: number
  }>>(financeApiPath('/invoices/files'), {
    method: 'POST',
    body: formData
  })
  if (!response.data?.url) throw new Error('发票文件上传失败')
  return response.data
}

function payloadValue(value: string) {
  const text = value.trim()
  return text || undefined
}

async function submitEdit() {
  if (!canEditInvoice.value) {
    toast.add({ title: '无编辑权限', color: 'warning' })
    return
  }
  saving.value = true
  try {
    let filePayload: Record<string, unknown> = {}
    if (replacementFile.value) {
      validateInvoiceFile(form.invoiceMedium, replacementFile.value)
      const uploaded = await uploadInvoiceFile(form.invoiceMedium, replacementFile.value)
      filePayload = {
        invoiceFileUrl: uploaded.url,
        invoiceFileName: uploaded.fileName,
        invoiceFileMimeType: uploaded.mimeType,
        invoiceFileSize: uploaded.size
      }
    }

    await $fetch(financeApiPath(`/invoices/${encodeURIComponent(code.value)}`), {
      method: 'PATCH',
      body: {
        invoiceNo: payloadValue(form.invoiceNo),
        invoiceType: payloadValue(form.invoiceType),
        invoiceMedium: form.invoiceMedium || 'electronic',
        invoiceItem: payloadValue(form.invoiceItem),
        invoiceAmount: payloadValue(form.invoiceAmount),
        taxRate: payloadValue(form.taxRate),
        taxAmount: payloadValue(form.taxAmount),
        amountTaxExclusive: payloadValue(form.amountTaxExclusive),
        invoiceDate: payloadValue(form.invoiceDate),
        customerCode: payloadValue(form.customerCode),
        customerName: payloadValue(form.customerName),
        contractCode: payloadValue(form.contractCode),
        projectCode: payloadValue(form.projectCode),
        receivablePlanCode: payloadValue(form.receivablePlanCode),
        taxpayerName: payloadValue(form.taxpayerName),
        taxpayerNo: payloadValue(form.taxpayerNo),
        receiverName: payloadValue(form.receiverName),
        remark: payloadValue(form.remark),
        updatedBy: currentUserId.value || 'finance-ui',
        ...filePayload
      }
    })
    toast.add({ title: '已保存', description: `${code.value} 已更新。`, color: 'success' })
    replacementFile.value = null
    await loadInvoice()
  } catch (error) {
    toast.add({ title: errorText(error, '保存失败'), color: 'error' })
  } finally {
    saving.value = false
  }
}

function invoiceActionDisabled() {
  return loading.value || !invoice.value || !canEditInvoice.value || invoiceStatus.value === 'red_reversed' || invoiceStatus.value === 'canceled'
}

async function submitRedReverse() {
  if (!redReverseReason.value.trim()) {
    toast.add({ title: '请填写冲红原因', color: 'warning' })
    return
  }
  redReversePending.value = true
  try {
    await $fetch(financeApiPath(`/invoices/${encodeURIComponent(code.value)}/red-reverse`), {
      method: 'POST',
      body: {
        reason: redReverseReason.value.trim(),
        redInvoiceNo: redReverseInvoiceNo.value.trim(),
        redReversedBy: currentUserId.value || 'finance-ui'
      }
    })
    toast.add({ title: '已冲红', description: `${code.value} 已标记为已红冲。`, color: 'success' })
    redReverseModalOpen.value = false
    await loadInvoice()
  } catch (error) {
    toast.add({ title: errorText(error, '冲红失败'), color: 'error' })
  } finally {
    redReversePending.value = false
  }
}

async function submitDelete() {
  deletePending.value = true
  try {
    await $fetch(financeApiPath(`/invoices/${encodeURIComponent(code.value)}/delete-with-file`), {
      method: 'POST',
      body: {
        reason: deleteReason.value.trim(),
        deletedBy: currentUserId.value || 'finance-ui'
      }
    })
    toast.add({ title: '已删除', description: `${code.value} 已删除。`, color: 'success' })
    deleteModalOpen.value = false
    await router.push({ path: '/invoices' })
  } catch (error) {
    toast.add({ title: errorText(error, '删除失败'), color: 'error' })
  } finally {
    deletePending.value = false
  }
}
</script>

<template>
  <div class="contents">
    <Teleport to="#finance-layout-header-actions">
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          @click="router.push({ path: '/invoices' })"
        >
          返回列表
        </UButton>
        <UButton
          icon="i-lucide-undo-2"
          color="warning"
          variant="soft"
          :disabled="invoiceActionDisabled()"
          @click="redReverseModalOpen = true"
        >
          冲红
        </UButton>
        <UButton
          v-if="canAdminInvoices"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          :disabled="loading || !invoice"
          @click="deleteModalOpen = true"
        >
          删除
        </UButton>
      </div>
    </Teleport>

    <UDashboardPanel
      id="finance-invoice-edit"
      grow
      class="min-w-0 overflow-x-hidden"
    >
      <template #header>
        <UDashboardToolbar>
          <template #left>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h1 class="truncate text-base font-semibold text-highlighted">
                  {{ title }}
                </h1>
                <UBadge
                  v-if="invoiceStatusLabel"
                  color="neutral"
                  variant="subtle"
                >
                  {{ invoiceStatusLabel }}
                </UBadge>
              </div>
              <p class="truncate text-sm text-muted">
                {{ code }}
              </p>
            </div>
          </template>
        </UDashboardToolbar>
      </template>

      <div class="space-y-4 p-4">
        <UAlert
          v-if="loadError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="loadError"
        />

        <UCard v-else>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="font-semibold text-highlighted">
                  发票编辑
                </p>
                <p class="text-sm text-muted">
                  {{ form.customerName || '未填写客户' }} · {{ form.contractCode || '未关联合同' }}
                </p>
              </div>
              <UButton
                icon="i-lucide-save"
                :loading="saving"
                :disabled="loading || !canEditInvoice"
                @click="submitEdit"
              >
                保存
              </UButton>
            </div>
          </template>

          <div
            v-if="loading"
            class="py-16 text-center text-sm text-muted"
          >
            加载中...
          </div>

          <div
            v-else
            class="space-y-6"
          >
            <section class="space-y-3">
              <p class="text-sm font-medium text-highlighted">
                开票信息
              </p>
              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <UFormField label="发票号码">
                  <UInput
                    v-model="form.invoiceNo"
                    placeholder="请输入发票号码"
                  />
                </UFormField>
                <UFormField
                  label="介质形式"
                  required
                >
                  <USelect
                    v-model="form.invoiceMedium"
                    :items="invoiceMediumOptions"
                    value-key="value"
                    label-key="label"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="发票类型">
                  <UInput
                    v-model="form.invoiceType"
                    placeholder="专用发票/普通发票"
                  />
                </UFormField>
                <UFormField label="开票日期">
                  <UInput
                    v-model="form.invoiceDate"
                    type="date"
                  />
                </UFormField>
                <UFormField
                  label="开票金额"
                  required
                >
                  <UInput
                    v-model="form.invoiceAmount"
                    type="number"
                    step="0.01"
                    min="0"
                  />
                </UFormField>
                <UFormField label="税额">
                  <UInput
                    v-model="form.taxAmount"
                    type="number"
                    step="0.01"
                    min="0"
                  />
                </UFormField>
                <UFormField label="不含税金额">
                  <UInput
                    v-model="form.amountTaxExclusive"
                    type="number"
                    step="0.01"
                    min="0"
                  />
                </UFormField>
                <UFormField label="税率">
                  <UInput
                    v-model="form.taxRate"
                    type="number"
                    step="0.0001"
                    min="0"
                  />
                </UFormField>
              </div>
              <UFormField label="开票内容">
                <UTextarea
                  v-model="form.invoiceItem"
                  :rows="3"
                />
              </UFormField>
            </section>

            <section class="space-y-3">
              <p class="text-sm font-medium text-highlighted">
                关联信息
              </p>
              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <UFormField label="客户编码">
                  <UInput v-model="form.customerCode" />
                </UFormField>
                <UFormField label="客户名称">
                  <UInput v-model="form.customerName" />
                </UFormField>
                <UFormField label="合同编码">
                  <UInput v-model="form.contractCode" />
                </UFormField>
                <UFormField label="项目编码">
                  <UInput v-model="form.projectCode" />
                </UFormField>
                <UFormField label="回款计划编码">
                  <UInput v-model="form.receivablePlanCode" />
                </UFormField>
              </div>
            </section>

            <section class="space-y-3">
              <p class="text-sm font-medium text-highlighted">
                抬头与收票
              </p>
              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <UFormField label="发票抬头">
                  <UInput v-model="form.taxpayerName" />
                </UFormField>
                <UFormField label="纳税人识别号">
                  <UInput v-model="form.taxpayerNo" />
                </UFormField>
                <UFormField label="收票人">
                  <UInput v-model="form.receiverName" />
                </UFormField>
              </div>
            </section>

            <section class="space-y-3">
              <p class="text-sm font-medium text-highlighted">
                发票文件
              </p>
              <div class="rounded-lg border border-default p-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-sm text-muted">
                      当前文件
                    </p>
                    <UButton
                      v-if="form.invoiceFileUrl"
                      class="mt-1 max-w-full"
                      icon="i-lucide-file-text"
                      color="neutral"
                      variant="soft"
                      :loading="previewLoading"
                      @click="openInvoiceFile"
                    >
                      <span class="truncate">{{ form.invoiceFileName || '查看发票文件' }}</span>
                    </UButton>
                    <p
                      v-else
                      class="mt-1 text-sm text-muted"
                    >
                      未上传
                    </p>
                  </div>
                  <label class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-default px-3 py-2 text-sm hover:bg-muted">
                    <UIcon name="i-lucide-upload" />
                    <span>选择新文件</span>
                    <input
                      type="file"
                      class="hidden"
                      accept=".pdf,.ofd,application/pdf,application/ofd"
                      @change="onFileChange"
                    >
                  </label>
                </div>
                <p
                  v-if="replacementFile"
                  class="mt-3 truncate text-sm text-muted"
                >
                  待上传：{{ replacementFile.name }}
                </p>
              </div>
            </section>

            <UFormField label="备注">
              <UTextarea
                v-model="form.remark"
                :rows="3"
              />
            </UFormField>

            <div class="flex justify-end gap-2 border-t border-default pt-4">
              <UButton
                color="neutral"
                variant="ghost"
                @click="router.push({ path: '/invoices' })"
              >
                取消
              </UButton>
              <UButton
                icon="i-lucide-save"
                :loading="saving"
                :disabled="!canEditInvoice"
                @click="submitEdit"
              >
                保存
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
    </UDashboardPanel>

    <UModal
      v-model:open="previewOpen"
      :title="previewTitle"
      :ui="{ content: 'sm:max-w-6xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="truncate font-semibold">{{ previewTitle }}</span>
              <div class="flex shrink-0 items-center gap-1">
                <UButton
                  icon="i-lucide-external-link"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  title="新窗口打开"
                  @click="openPreviewExternal"
                />
                <UButton
                  icon="i-lucide-x"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  title="关闭"
                  @click="previewOpen = false"
                />
              </div>
            </div>
          </template>

          <img
            v-if="previewKind === 'image'"
            :src="previewUrl"
            :alt="previewTitle"
            class="max-h-[75vh] w-full rounded border border-default bg-white object-contain"
          >
          <iframe
            v-else-if="previewKind === 'pdf'"
            :src="previewUrl"
            class="h-[75vh] w-full rounded border border-default bg-white"
            :title="previewTitle"
          />
          <UAlert
            v-else
            color="neutral"
            variant="subtle"
            icon="i-lucide-file-text"
            title="当前文件格式无法内嵌预览"
            description="请使用右上角按钮打开文件。"
          />
        </UCard>
      </template>
    </UModal>

    <UModal
      v-model:open="redReverseModalOpen"
      title="冲红发票"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">冲红发票</span>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="redReverseModalOpen = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <UAlert
              color="warning"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="冲红后该发票不再计入开票金额统计"
            />
            <UFormField label="红字发票号码">
              <UInput
                v-model="redReverseInvoiceNo"
                placeholder="可选"
              />
            </UFormField>
            <UFormField
              label="冲红原因"
              required
            >
              <UTextarea
                v-model="redReverseReason"
                placeholder="请填写冲红原因"
                :rows="4"
              />
            </UFormField>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="redReverseModalOpen = false"
              >
                取消
              </UButton>
              <UButton
                icon="i-lucide-undo-2"
                color="warning"
                :loading="redReversePending"
                @click="submitRedReverse"
              >
                确认冲红
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteModalOpen"
      title="删除发票"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">删除发票</span>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="deleteModalOpen = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <UAlert
              color="error"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="确认后将删除发票记录"
              description="属于默认对象存储 finance/invoices/ 目录的发票文件会同步删除；历史外部链接只删除台账记录。"
            />
            <UFormField label="删除原因">
              <UTextarea
                v-model="deleteReason"
                placeholder="可选，建议填写业务原因"
                :rows="4"
              />
            </UFormField>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="deleteModalOpen = false"
              >
                取消
              </UButton>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                :loading="deletePending"
                @click="submitDelete"
              >
                确认删除
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
