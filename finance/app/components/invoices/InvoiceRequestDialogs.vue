<script setup lang="ts">
import { financeApiPath } from '~/composables/useFinanceApi'
import { invoiceMediumOptions } from '~/config/pageConfigs'

interface UploadedInvoiceFile {
  url: string
  fileName: string
  mimeType: string
  size: number
}

interface IssueForm {
  invoiceNo: string
  invoiceDate: string
  invoiceMedium: string
  invoiceAmount: string
}

interface AssignmentForm {
  responsibleUid: string
  dueAt: string
}

const props = defineProps<{
  validateFile: (medium: string, file: File) => void
  uploadFile: (medium: string, file: File) => Promise<UploadedInvoiceFile>
}>()

const emit = defineEmits<{
  updated: []
}>()

const toast = useToast()
const issueOpen = ref(false)
const issuePending = ref(false)
const issueError = ref('')
const issueRequest = ref<Record<string, unknown> | null>(null)
const issueFile = ref<File | null>(null)
const issueForm = ref<IssueForm>({
  invoiceNo: '',
  invoiceDate: '',
  invoiceMedium: 'electronic',
  invoiceAmount: ''
})
const assignmentOpen = ref(false)
const assignmentPending = ref(false)
const assignmentError = ref('')
const assignmentRequest = ref<Record<string, unknown> | null>(null)
const assignmentForm = ref<AssignmentForm>({ responsibleUid: '', dueAt: '' })

function errorText(error: unknown, fallback: string) {
  const candidate = error as { data?: { message?: string, statusMessage?: string }, message?: string }
  return String(candidate?.data?.message || candidate?.data?.statusMessage || candidate?.message || fallback)
}

function assignmentDateTime(value: unknown) {
  return String(value || '').trim().replace(' ', 'T').slice(0, 16)
}

function openAssignment(row: Record<string, unknown>) {
  assignmentRequest.value = row
  assignmentForm.value = {
    responsibleUid: String(row.issuance_responsible_uid || row.issuanceResponsibleUid || '').trim(),
    dueAt: assignmentDateTime(row.issuance_due_at || row.issuanceDueAt)
  }
  assignmentError.value = ''
  assignmentOpen.value = true
}

async function submitAssignment() {
  const code = String(assignmentRequest.value?.code || '').trim()
  if (!code) return
  const responsibleUid = assignmentForm.value.responsibleUid.trim()
  const dueAt = assignmentForm.value.dueAt.trim()
  if (!responsibleUid || !dueAt) {
    assignmentError.value = '请同时填写开票责任人 UID 和截止时间。'
    return
  }
  assignmentPending.value = true
  assignmentError.value = ''
  try {
    await $fetch(financeApiPath(`/invoice-requests/${encodeURIComponent(code)}/assign-issuance`), {
      method: 'POST',
      body: { issuanceResponsibleUid: responsibleUid, issuanceDueAt: dueAt }
    })
    toast.add({ title: '开票责任已更新', description: `${code} 的责任人和截止时间已保存。`, color: 'success' })
    assignmentOpen.value = false
    emit('updated')
  } catch (error) {
    assignmentError.value = errorText(error, '开票责任设置失败')
  } finally {
    assignmentPending.value = false
  }
}

async function clearAssignment() {
  const code = String(assignmentRequest.value?.code || '').trim()
  if (!code) return
  assignmentPending.value = true
  assignmentError.value = ''
  try {
    await $fetch(financeApiPath(`/invoice-requests/${encodeURIComponent(code)}/assign-issuance`), {
      method: 'POST',
      body: { issuanceResponsibleUid: null, issuanceDueAt: null }
    })
    toast.add({ title: '开票责任已清除', description: `${code} 暂停进入待开票通知。`, color: 'warning' })
    assignmentOpen.value = false
    emit('updated')
  } catch (error) {
    assignmentError.value = errorText(error, '清除开票责任失败')
  } finally {
    assignmentPending.value = false
  }
}

function openIssue(row: Record<string, unknown>) {
  issueRequest.value = row
  issueForm.value = {
    invoiceNo: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    invoiceMedium: String(row.invoice_medium || row.invoiceMedium || 'electronic'),
    invoiceAmount: String(row.requested_amount || row.requestedAmount || '')
  }
  issueFile.value = null
  issueError.value = ''
  issueOpen.value = true
}

function onFileChange(event: Event) {
  issueFile.value = (event.target as HTMLInputElement).files?.[0] || null
}

async function submitIssue() {
  const code = String(issueRequest.value?.code || '').trim()
  if (!code) return
  issuePending.value = true
  issueError.value = ''
  try {
    const medium = String(issueForm.value.invoiceMedium || 'electronic')
    const file = issueFile.value
    if (!issueForm.value.invoiceNo.trim()) throw new Error('请输入发票号码')
    if (!file) throw new Error('请上传发票文件')
    props.validateFile(medium, file)
    const uploaded = await props.uploadFile(medium, file)
    await $fetch(financeApiPath(`/invoice-requests/${encodeURIComponent(code)}/issue`), {
      method: 'POST',
      body: {
        invoiceNo: issueForm.value.invoiceNo.trim(),
        invoiceDate: issueForm.value.invoiceDate,
        invoiceMedium: medium,
        invoiceAmount: issueForm.value.invoiceAmount,
        invoiceFileUrl: uploaded.url,
        invoiceFileName: uploaded.fileName,
        invoiceFileMimeType: uploaded.mimeType,
        invoiceFileSize: uploaded.size
      }
    })
    toast.add({ title: '开票成功', description: `${code} 已生成正式发票。`, color: 'success' })
    issueOpen.value = false
    emit('updated')
  } catch (error) {
    issueError.value = errorText(error, '开票确认失败')
  } finally {
    issuePending.value = false
  }
}

defineExpose({ openAssignment, openIssue })
</script>

<template>
  <div class="contents">
    <UModal
      v-model:open="issueOpen"
      title="开具发票"
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="font-semibold">
                  开具发票
                </div>
                <div class="text-xs text-muted mt-0.5">
                  {{ issueRequest?.code }} · {{ issueRequest?.customer_name || issueRequest?.customerName || '-' }}
                </div>
              </div>
              <UButton
                icon="i-lucide-x"
                variant="ghost"
                color="neutral"
                size="xs"
                title="关闭"
                aria-label="关闭开具发票"
                @click="issueOpen = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <UFormField
                label="发票号码"
                required
              >
                <UInput
                  v-model="issueForm.invoiceNo"
                  placeholder="请输入发票号码"
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
                  :items="invoiceMediumOptions"
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
                <div
                  v-if="issueFile"
                  class="mt-1 text-xs text-muted"
                >
                  {{ issueFile.name }}
                </div>
              </UFormField>
            </div>
            <UAlert
              v-if="issueError"
              color="error"
              variant="soft"
              icon="i-lucide-circle-alert"
              :title="issueError"
            />
          </div>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="issueOpen = false"
              />
              <UButton
                label="确认开票"
                icon="i-lucide-check"
                color="success"
                :loading="issuePending"
                @click="submitIssue"
              />
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <UModal
      v-model:open="assignmentOpen"
      title="设置开票责任"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="font-semibold">
                  设置开票责任
                </div>
                <div class="mt-0.5 text-xs text-muted">
                  {{ assignmentRequest?.code }} · 仅当前已审批且尚未开票的申请可调整
                </div>
              </div>
              <UButton
                icon="i-lucide-x"
                variant="ghost"
                color="neutral"
                size="xs"
                title="关闭"
                aria-label="关闭设置开票责任"
                @click="assignmentOpen = false"
              />
            </div>
          </template>
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField
              label="开票责任人 UID"
              required
            >
              <UInput
                v-model="assignmentForm.responsibleUid"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="开票截止时间"
              required
            >
              <UInput
                v-model="assignmentForm.dueAt"
                type="datetime-local"
                class="w-full"
              />
            </UFormField>
          </div>
          <UAlert
            v-if="assignmentError"
            class="mt-4"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            :title="assignmentError"
          />
          <template #footer>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <UButton
                v-if="assignmentForm.responsibleUid || assignmentForm.dueAt"
                color="error"
                variant="ghost"
                :loading="assignmentPending"
                @click="clearAssignment"
              >
                清除责任
              </UButton>
              <div class="ml-auto flex gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  @click="assignmentOpen = false"
                >
                  取消
                </UButton>
                <UButton
                  color="primary"
                  :loading="assignmentPending"
                  @click="submitAssignment"
                >
                  保存责任
                </UButton>
              </div>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
