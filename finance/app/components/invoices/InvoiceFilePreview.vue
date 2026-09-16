<script setup lang="ts">
import { financeApiPath } from '~/composables/useFinanceApi'
import {
  invoiceFileMimeType,
  invoiceFileName,
  invoiceFileUrl,
  invoicePreviewKind
} from '~/utils/invoiceFiles'

interface InvoiceFileViewResponse {
  code?: number
  data?: { url?: string, expiresIn?: number, legacy?: boolean }
  message?: string
}

const toast = useToast()
const { resolveCurrentAppPath } = useAppUrls()
const open = ref(false)
const previewUrl = ref('')
const title = ref('发票预览')
const mimeType = ref('')
const loadingUrl = ref('')
const kind = computed(() => invoicePreviewKind(previewUrl.value, title.value, mimeType.value))

function errorText(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { message?: string, statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return String(candidate?.data?.message || candidate?.data?.statusMessage || candidate?.statusMessage || candidate?.message || fallback)
}

function previewRequestUrl(row: Record<string, unknown>) {
  const params = new URLSearchParams()
  params.set('url', invoiceFileUrl(row))
  const code = String(row.code || row.invoice_code || row.invoiceCode || '').trim()
  const name = invoiceFileName(row)
  const type = invoiceFileMimeType(row)
  if (code) params.set('code', code)
  if (name) params.set('name', name)
  if (type) params.set('mimeType', type)
  params.set('format', 'json')
  return resolveCurrentAppPath(`${financeApiPath('/invoices/files/view')}?${params.toString()}`)
}

async function show(row: Record<string, unknown>) {
  const sourceUrl = invoiceFileUrl(row)
  if (!sourceUrl) {
    toast.add({ title: '该发票尚未上传文件', color: 'warning' })
    return
  }
  loadingUrl.value = sourceUrl
  try {
    const response = await $fetch<InvoiceFileViewResponse>(previewRequestUrl(row))
    const resolvedUrl = String(response.data?.url || '').trim()
    if (!resolvedUrl) throw new Error(response.message || '发票文件预览地址无效')
    previewUrl.value = resolvedUrl
    title.value = invoiceFileName(row) || '发票预览'
    mimeType.value = invoiceFileMimeType(row)
    open.value = true
  } catch (error) {
    toast.add({ title: errorText(error, '发票文件预览失败'), color: 'error' })
  } finally {
    if (loadingUrl.value === sourceUrl) loadingUrl.value = ''
  }
}

function isLoading(row: Record<string, unknown>) {
  return loadingUrl.value === invoiceFileUrl(row)
}

function openExternal() {
  if (previewUrl.value) window.open(previewUrl.value, '_blank', 'noopener,noreferrer')
}

defineExpose({ show, isLoading })
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :ui="{ content: 'sm:max-w-6xl' }"
  >
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <span class="font-semibold truncate">{{ title }}</span>
            <div class="flex items-center gap-1 shrink-0">
              <UButton
                icon="i-lucide-external-link"
                variant="ghost"
                color="neutral"
                size="xs"
                title="新窗口打开"
                aria-label="在新窗口打开发票文件"
                @click="openExternal"
              />
              <UButton
                icon="i-lucide-x"
                variant="ghost"
                color="neutral"
                size="xs"
                title="关闭"
                aria-label="关闭发票预览"
                @click="open = false"
              />
            </div>
          </div>
        </template>

        <img
          v-if="kind === 'image'"
          :src="previewUrl"
          :alt="title"
          class="max-h-[75vh] w-full rounded border border-default bg-white object-contain"
        >
        <iframe
          v-else-if="kind === 'pdf'"
          :src="previewUrl"
          class="h-[75vh] w-full rounded border border-default bg-white"
          :title="title"
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
</template>
