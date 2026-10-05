<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const props = defineProps<{ productCode: string, disabled?: boolean }>()
const emit = defineEmits<{ resume: [requestId: string] }>()
type Row = { requestBizId: string, purpose: string, status: string, linked: boolean }
type Page = { items: Row[], total: number, page: number, pageSize: number }
const open = ref(false), loading = ref(false), page = ref(1), result = ref<Page>(), error = ref<unknown>()
const alert = useApiErrorAlert(error, { fallbackTitle: '创建记录读取失败' })
const labels: Record<string, string> = { pending: '待处理', processing: '处理中', retry_wait: '等待重试', partial_unknown: '等待确认', succeeded: '已创建', failed_permanent: '创建失败', dead_letter: '需管理员处理', cancelled: '已取消' }
const purposes: Record<string, string> = { 'product-overview': '产品概述', 'requirements': '需求说明', 'design': '设计文档', 'release-notes': '发布说明', 'user-guide': '使用指南', 'other': '其他' }
const columns: TableColumn<Row>[] = [{ accessorKey: 'requestBizId', header: '请求编号' }, { accessorKey: 'purpose', header: '用途' }, { accessorKey: 'status', header: '状态' }, { id: 'actions', header: '操作' }]
let generation = 0
watch(() => props.productCode, () => {
  generation++
  open.value = false
  result.value = undefined
  page.value = 1
})
watch([open, page], load)
async function load() {
  const current = ++generation
  result.value = undefined
  error.value = undefined
  loading.value = false
  if (!open.value) return
  loading.value = true
  const product = props.productCode, requestedPage = page.value
  try {
    const response = await $fetch<{ code: number, data: Page }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents/requests`, { query: { page: requestedPage, pageSize: 10 }, retry: 0, timeout: 30000 })
    const data = response.data
    if (response.code !== 0 || !data || data.page !== requestedPage || data.pageSize !== 10 || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.items) || data.items.length !== Math.min(10, Math.max(0, data.total - (requestedPage - 1) * 10))) throw new Error('创建记录响应不完整')
    if (current === generation) result.value = data
  } catch (cause) {
    if (current === generation) error.value = cause
  } finally {
    if (current === generation) loading.value = false
  }
}
function resume(row: Row) {
  if (props.disabled || row.linked) return
  open.value = false
  emit('resume', row.requestBizId)
}
</script>

<template>
  <UButton
    color="neutral"
    variant="outline"
    icon="i-lucide-history"
    :disabled="disabled"
    @click="open = true"
  >
    创建记录
  </UButton>
  <UModal
    v-model:open="open"
    title="文档创建记录"
    description="继续处理已有请求，避免重复创建文档。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="min-w-0 space-y-4">
        <UAlert v-if="alert" v-bind="alert" />
        <UButton
          color="neutral"
          variant="outline"
          :loading="loading"
          @click="load"
        >
          刷新记录
        </UButton>
        <p class="text-xs text-muted sm:hidden">可左右滑动表格查看操作。</p>
        <UTable :data="result?.items || []" :columns="columns" :loading="loading">
          <template #requestBizId-cell="{ row }">
            <span class="block min-w-28 max-w-36 whitespace-normal break-all text-xs">{{ row.original.requestBizId }}</span>
          </template>
          <template #purpose-cell="{ row }">
            {{ purposes[row.original.purpose] || row.original.purpose }}
          </template>
          <template #status-cell="{ row }">
            {{ row.original.linked ? '已完成关联' : labels[row.original.status] || row.original.status }}
          </template>
          <template #actions-cell="{ row }">
            <UButton
              v-if="!row.original.linked"
              size="sm"
              :disabled="disabled"
              @click="resume(row.original)"
            >
              继续处理
            </UButton>
          </template>
          <template #empty>
            <CommonEmptyState icon="i-lucide-history" title="暂无创建记录" description="从模板创建文档后，可在这里查看进度。" />
          </template>
        </UTable>
        <div v-if="result" class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm text-muted">共 {{ result.total }} 条</span>
          <UPagination
            v-model:page="page"
            :items-per-page="10"
            :total="result.total"
            :sibling-count="0"
            :disabled="loading"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
