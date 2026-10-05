<script setup lang="ts">
type RuntimeEnvelope<T> = { data?: T, message?: string }
type InvoiceRequest = Record<string, unknown>

const route = useRoute()
const toast = useToast()
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()

const code = computed(() => String(route.params.code || '').trim())
const request = ref<InvoiceRequest | null>(null)
const loading = ref(true)
const loadError = ref('')
const issueOpen = ref(false)
const issuePending = ref(false)
const issueError = ref('')
const issueFile = ref<File | null>(null)
const issueForm = reactive({
  invoiceNo: '',
  invoiceDate: new Date().toISOString().slice(0, 10),
  invoiceMedium: 'electronic',
  invoiceAmount: ''
})

const mediumOptions = [
  { label: '电子发票', value: 'electronic' },
  { label: '纸质发票', value: 'paper' }
]
const canIssue = computed(() => permissionsLoaded.value && hasPermission('invoices', 'issue'))
const canIssueCurrent = computed(() => canIssue.value && text(request.value?.status) === 'approved' && !request.value?.issued_invoice_id)
const title = computed(() => request.value ? `开票申请 ${code.value}` : '开票申请详情')

usePageTitle(title)

onMounted(async () => {
  await Promise.all([loadPermissions(), loadRequest()])
})

function text(value: unknown) {
  return String(value ?? '').trim()
}

function value(...keys: string[]) {
  for (const key of keys) {
    const candidate = request.value?.[key]
    if (candidate !== undefined && candidate !== null && text(candidate)) return text(candidate)
  }
  return '-'
}

function statusLabel(status: unknown) {
  return ({ draft: '草稿', pending_approval: '审批中', approved: '已通过', rejected: '已驳回', issued: '已开票' } as Record<string, string>)[text(status)] || text(status) || '-'
}

function errorText(error: unknown, fallback: string) {
  const candidate = error as { data?: { message?: string }, message?: string }
  return text(candidate?.data?.message || candidate?.message || fallback)
}

async function loadRequest() {
  loading.value = true
  loadError.value = ''
  request.value = null
  try {
    const response = await $fetch<RuntimeEnvelope<InvoiceRequest>>(financeApiPath(`/invoice-requests/${encodeURIComponent(code.value)}`))
    request.value = response.data || null
  } catch (error) {
    loadError.value = errorText(error, '开票申请加载失败')
  } finally {
    loading.value = false
  }
}

function openIssue() {
  issueForm.invoiceNo = ''
  issueForm.invoiceDate = new Date().toISOString().slice(0, 10)
  issueForm.invoiceMedium = value('invoice_medium', 'invoiceMedium') === '-' ? 'electronic' : value('invoice_medium', 'invoiceMedium')
  issueForm.invoiceAmount = value('requested_amount', 'requestedAmount') === '-' ? '' : value('requested_amount', 'requestedAmount')
  issueFile.value = null
  issueError.value = ''
  issueOpen.value = true
}

function onFileChange(event: Event) {
  issueFile.value = (event.target as HTMLInputElement).files?.[0] || null
}

function validateFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  if (issueForm.invoiceMedium === 'paper' && extension !== 'pdf' && file.type !== 'application/pdf') {
    throw new Error('纸质发票扫描件只支持 PDF 文件')
  }
  if (issueForm.invoiceMedium === 'electronic' && !['pdf', 'ofd'].includes(extension)) {
    throw new Error('电子发票只支持 PDF 或 OFD 文件')
  }
}

async function submitIssue() {
  issuePending.value = true
  issueError.value = ''
  try {
    if (!issueForm.invoiceNo.trim()) throw new Error('请输入发票号码')
    if (!issueFile.value) throw new Error('请上传发票文件')
    validateFile(issueFile.value)
    const formData = new FormData()
    formData.append('invoiceMedium', issueForm.invoiceMedium)
    formData.append('file', issueFile.value)
    const upload = await $fetch<RuntimeEnvelope<{ url: string, fileName: string, mimeType: string, size: number }>>(financeApiPath('/invoices/files'), { method: 'POST', body: formData })
    if (!upload.data?.url) throw new Error(upload.message || '发票文件上传失败')
    await $fetch(financeApiPath(`/invoice-requests/${encodeURIComponent(code.value)}/issue`), {
      method: 'POST',
      body: {
        invoiceNo: issueForm.invoiceNo.trim(), invoiceDate: issueForm.invoiceDate,
        invoiceMedium: issueForm.invoiceMedium, invoiceAmount: issueForm.invoiceAmount,
        invoiceFileUrl: upload.data.url, invoiceFileName: upload.data.fileName,
        invoiceFileMimeType: upload.data.mimeType, invoiceFileSize: upload.data.size
      }
    })
    toast.add({ title: '开票成功', description: `${code.value} 已生成正式发票`, color: 'success' })
    issueOpen.value = false
    await loadRequest()
  } catch (error) {
    issueError.value = errorText(error, '开票失败')
  } finally {
    issuePending.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="finance-invoice-request-detail"
    grow
  >
    <template #header>
      <UDashboardToolbar>
        <template #left>
          <div class="flex min-w-0 items-center gap-3">
            <UButton
              to="/finance/invoices/requests"
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="ghost"
              aria-label="返回开票申请列表"
            />
            <div class="min-w-0">
              <h1 class="truncate text-base font-semibold text-highlighted">
                {{ title }}
              </h1>
              <p class="truncate text-sm text-muted">
                处理开票申请并核对当前责任信息
              </p>
            </div>
          </div>
        </template>
        <template #right>
          <UButton
            v-if="canIssueCurrent"
            icon="i-lucide-receipt-text"
            @click="openIssue"
          >
            确认开票
          </UButton>
        </template>
      </UDashboardToolbar>
    </template>

    <div class="space-y-4 p-4">
      <UCard v-if="loading">
        <div class="py-16 text-center text-sm text-muted">
          正在加载开票申请...
        </div>
      </UCard>
      <UAlert
        v-else-if="loadError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="开票申请加载失败"
        :description="loadError"
      />
      <UAlert
        v-else-if="!request"
        color="warning"
        variant="subtle"
        icon="i-lucide-file-question"
        title="未找到开票申请"
        :description="`没有找到编号为 ${code} 的开票申请，或你无权查看。`"
      />
      <template v-else>
        <UAlert
          v-if="canIssue && !canIssueCurrent && text(request.status) !== 'issued'"
          color="warning"
          variant="subtle"
          title="当前不可开票"
          description="仅已审批且尚未开票的申请可以执行开票。"
        />
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="font-semibold text-highlighted">
                  申请概览
                </p><p class="text-sm text-muted">
                  {{ value('customer_name', 'customerName') }}
                </p>
              </div>
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ statusLabel(request.status) }}
              </UBadge>
            </div>
          </template>
          <dl class="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt class="text-xs text-muted">
                申请编号
              </dt><dd class="mt-1 text-sm font-medium text-highlighted">
                {{ code }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                申请金额
              </dt><dd class="mt-1 text-sm font-medium text-highlighted">
                {{ formatMoney(request.requested_amount) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                合同编号
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('contract_code', 'contractCode') }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                回款计划
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('receivable_plan_code', 'receivablePlanCode') }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                开票责任人
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('issuance_responsible_uid', 'issuanceResponsibleUid') }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                开票截止时间
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('issuance_due_at', 'issuanceDueAt') }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                申请人
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('applicant_name', 'applicantName', 'applicant_uid', 'applicantUid') }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                发票介质
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('invoice_medium', 'invoiceMedium') }}
              </dd>
            </div>
          </dl>
        </UCard>
      </template>
    </div>

    <UModal
      v-model:open="issueOpen"
      title="确认开票"
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div>
              <p class="font-semibold text-highlighted">
                确认开票
              </p><p class="text-sm text-muted">
                {{ code }}
              </p>
            </div>
          </template>
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField
              label="发票号码"
              required
            >
              <UInput
                v-model="issueForm.invoiceNo"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="开票日期"
              required
            >
              <UInput
                v-model="issueForm.invoiceDate"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="介质形式"
              required
            >
              <USelect
                v-model="issueForm.invoiceMedium"
                :items="mediumOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="开票金额"
              required
            >
              <UInput
                v-model="issueForm.invoiceAmount"
                type="number"
                min="0"
                step="0.01"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="发票文件"
              required
              class="md:col-span-2"
            >
              <UInput
                type="file"
                :accept="issueForm.invoiceMedium === 'paper' ? '.pdf,application/pdf' : '.pdf,.ofd,application/pdf,application/ofd'"
                class="w-full"
                @change="onFileChange"
              />
            </UFormField>
            <UAlert
              v-if="issueError"
              class="md:col-span-2"
              color="error"
              variant="subtle"
              :title="issueError"
            />
          </div>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="issueOpen = false"
              >
                取消
              </UButton><UButton
                color="success"
                :loading="issuePending"
                @click="submitIssue"
              >
                确认开票
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
