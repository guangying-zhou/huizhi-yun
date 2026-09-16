<script setup lang="ts">
interface AccessRecord { id: string, viewerUid: string, viewedAt: string, ossPath: string }
interface AccessResponse { data: { items: AccessRecord[], total: number } }

const props = defineProps<{ path: string, title: string }>()
const { hasPermission } = usePermissions()
const canView = computed(() => hasPermission('admin', 'admin') && hasPermission('company', 'admin'))
const canExport = computed(() => canView.value && hasPermission('company', 'export'))
const { resolveCurrentAppPath } = useAppUrls()
const accountStore = useAccountStore()
const toast = useToast()
const open = ref(false)
const from = ref('')
const to = ref('')
const filters = ref({ from: '', to: '' })
const page = ref(1)
const pageSize = 20
const items = ref<AccessRecord[]>([])
const total = ref(0)
const loading = ref(false)
const exporting = ref(false)
const errorMessage = ref('')
let requestId = 0
const columns = [
  { accessorKey: 'viewerUid', header: '查看人' },
  { accessorKey: 'viewedAt', header: '查看时间（UTC）' }
]
const query = computed(() => ({ path: props.path, from: filters.value.from || undefined, to: filters.value.to || undefined }))

async function load() {
  if (!open.value || !canView.value) return
  const id = ++requestId
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<AccessResponse>(resolveCurrentAppPath('/api/company-assets/access-records'), {
      params: { ...query.value, page: page.value, pageSize }
    })
    if (id !== requestId) return
    items.value = response.data.items
    total.value = response.data.total
    void accountStore.fetchUsersBatch([...new Set(items.value.map(item => item.viewerUid))]).catch(() => {})
  } catch (error: unknown) {
    if (id !== requestId) return
    items.value = []
    total.value = 0
    errorMessage.value = (error as { data?: { message?: string } }).data?.message || '查看记录加载失败，请重试。'
  } finally {
    if (id === requestId) loading.value = false
  }
}

async function search() {
  if (from.value && to.value && from.value > to.value) {
    toast.add({ title: '开始日期不能晚于结束日期', color: 'warning' })
    return
  }
  filters.value = { from: from.value, to: to.value }
  page.value = 1
  await load()
}
watch(open, async (value) => {
  if (!value) {
    requestId++
    return
  }
  page.value = 1
  await load()
})
watch(() => props.path, () => {
  requestId++
  open.value = false
  items.value = []
  total.value = 0
  from.value = ''
  to.value = ''
  filters.value = { from: '', to: '' }
})

async function exportRecords() {
  if (!canExport.value || exporting.value) return
  exporting.value = true
  try {
    const blob = await $fetch<Blob>(resolveCurrentAppPath('/api/company-assets/access-records/export'), {
      params: query.value, responseType: 'blob'
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${props.title.replace(/[\\/:*?"<>|]/g, '_')}-查看记录.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error: unknown) {
    const data = (error as { data?: Blob | { message?: string } }).data
    let message = '导出失败，请重试。'
    if (data instanceof Blob) {
      try {
        message = JSON.parse(await data.text()).message || message
      } catch { /* Keep a readable fallback. */ }
    } else if (data?.message) message = data.message
    toast.add({ title: message, color: 'error' })
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <template v-if="canView">
    <UButton
      size="sm"
      icon="i-lucide-eye"
      variant="ghost"
      color="neutral"
      @click="open = true"
    >
      查看记录
    </UButton>
    <UModal
      v-model:open="open"
      title="文档查看记录"
      :description="title"
      :ui="{ content: 'sm:max-w-3xl', body: 'space-y-4' }"
    >
      <template #body>
        <p class="text-sm text-muted">
          记录功能上线后的成功预览。时间及日期筛选均为 UTC，不包含历史补录。
        </p>
        <div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <UFormField label="开始日期">
            <UInput v-model="from" type="date" class="w-full" />
          </UFormField>
          <UFormField label="结束日期">
            <UInput v-model="to" type="date" class="w-full" />
          </UFormField>
          <UButton icon="i-lucide-search" :loading="loading" @click="search">
            查询
          </UButton>
        </div>
        <UAlert v-if="errorMessage" color="error" :description="errorMessage" />
        <UTable
          :data="items"
          :columns="columns"
          :loading="loading"
          class="max-h-80 overflow-auto"
        >
          <template #viewerUid-cell="{ row }">
            <div>{{ accountStore.getUserByUid(row.original.viewerUid)?.realName || row.original.viewerUid }}</div>
            <div v-if="accountStore.getUserByUid(row.original.viewerUid)?.realName" class="text-xs text-muted">
              {{ row.original.viewerUid }}
            </div>
          </template>
          <template #viewedAt-cell="{ row }">
            {{ row.original.viewedAt.replace('T', ' ').replace('Z', '') }}
          </template>
          <template #empty>
            <CommonEmptyState icon="i-lucide-eye" title="暂无查看记录" />
          </template>
        </UTable>
        <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>共 {{ total }} 条</span>
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="total"
            :disabled="loading"
            @update:page="load"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="open = false">
            关闭
          </UButton>
          <UButton
            v-if="canExport"
            icon="i-lucide-download"
            :loading="exporting"
            :disabled="loading"
            @click="exportRecords"
          >
            导出 CSV
          </UButton>
        </div>
      </template>
    </UModal>
  </template>
</template>
