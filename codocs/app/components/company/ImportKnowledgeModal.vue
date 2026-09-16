<script setup lang="ts">
import type { Department } from '~/types/account'

interface SourceFolder { id: number, name: string, parent_id: number | null }
interface SourceDocument { uuid: string, title: string, updated_at: string }
interface ImportSourceResponse {
  data: {
    departments?: { tree?: Department[] }
    folders?: SourceFolder[]
    documents?: SourceDocument[]
    total?: number
  }
}
interface ImportResponse {
  data: {
    imported?: Array<{ sourceUuid: string, title: string, newUuid: string, ossPath: string }>
    skipped?: Array<{ sourceUuid: string, title: string, reason: string }>
  }
}

const props = defineProps<{ open: boolean, targetPath: string, subdir: string, categoryTitle: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'imported': [] }>()
const toast = useToast()
const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
const { resolveCurrentAppPath } = useAppUrls()
const departments = ref<Department[]>([])
const folders = ref<SourceFolder[]>([])
const documents = ref<SourceDocument[]>([])
const selectedDeptCode = ref('')
const selectedFolderId = ref('root')
const selectedUuids = ref<string[]>([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const loading = ref(false)
const importing = ref(false)
const errorMessage = ref('')
const skipped = ref<Array<{ sourceUuid: string, title: string, reason: string }>>([])
const operationId = ref('')
let requestId = 0

const departmentOptions = computed(() => {
  const flatten = (nodes: Department[], depth = 0): Array<{ label: string, value: string }> => nodes.flatMap(node => [
    { label: `${'　'.repeat(depth)}${node.name}`, value: node.deptCode },
    ...flatten(node.children || [], depth + 1)
  ])
  return flatten(departments.value)
})
const folderOptions = computed(() => [
  { label: '根目录', value: 'root' },
  ...folders.value.map(folder => ({ label: folder.name, value: String(folder.id) }))
])
const allSelected = computed(() => documents.value.length > 0 && documents.value.every(doc => selectedUuids.value.includes(doc.uuid)))
const columns = [
  { id: 'select', header: '' },
  { accessorKey: 'title', header: '文档名称' },
  { accessorKey: 'updated_at', header: '更新时间' }
]

function resetSelection() {
  selectedUuids.value = []
  operationId.value = ''
  skipped.value = []
}

async function loadSource() {
  const id = ++requestId
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await $fetch<ImportSourceResponse>(resolveCurrentAppPath('/api/company-assets/import-source'), {
      params: {
        deptCode: selectedDeptCode.value || undefined,
        folderId: selectedFolderId.value === 'root' ? undefined : selectedFolderId.value,
        page: page.value, pageSize
      }
    })
    if (id !== requestId) return
    departments.value = res.data.departments?.tree || departments.value
    folders.value = res.data.folders || []
    documents.value = res.data.documents || []
    total.value = res.data.total || 0
  } catch (error: unknown) {
    if (id !== requestId) return
    documents.value = []
    total.value = 0
    errorMessage.value = (error as { data?: { message?: string } }).data?.message || '无法加载部门文档，请重试。'
  } finally {
    if (id === requestId) loading.value = false
  }
}

watch(() => props.open, async (open) => {
  if (!open) {
    requestId++
    return
  }
  selectedDeptCode.value = ''
  selectedFolderId.value = 'root'
  page.value = 1
  resetSelection()
  await loadSource()
})

async function changeDepartment() {
  selectedFolderId.value = 'root'
  page.value = 1
  resetSelection()
  await loadSource()
}
async function changeFolder() {
  page.value = 1
  resetSelection()
  await loadSource()
}
function toggle(uuid: string, checked: boolean) {
  if (checked && selectedUuids.value.length >= 50) {
    toast.add({ title: '每次最多发布 50 个文档', color: 'warning' })
    return
  }
  selectedUuids.value = checked ? [...new Set([...selectedUuids.value, uuid])] : selectedUuids.value.filter(value => value !== uuid)
  operationId.value = ''
}
function togglePage(checked: boolean) {
  const pageUuids = documents.value.map(doc => doc.uuid)
  const next = checked ? [...new Set([...selectedUuids.value, ...pageUuids])] : selectedUuids.value.filter(uuid => !pageUuids.includes(uuid))
  if (next.length > 50) {
    toast.add({ title: '每次最多发布 50 个文档', color: 'warning' })
    return
  }
  selectedUuids.value = next
  operationId.value = ''
}
async function publish() {
  if (!selectedUuids.value.length || importing.value) return
  importing.value = true
  errorMessage.value = ''
  operationId.value ||= crypto.randomUUID()
  try {
    const res = await $fetch<ImportResponse>(resolveCurrentAppPath('/api/company-assets/import-documents'), {
      method: 'POST',
      body: { subdir: props.subdir, targetPath: props.targetPath || undefined, documentUuids: selectedUuids.value, operationId: operationId.value }
    })
    skipped.value = res.data.skipped || []
    const count = res.data.imported?.length || 0
    toast.add({ title: `已发布 ${count} 个文档${skipped.value.length ? `，跳过 ${skipped.value.length} 个` : ''}`, color: count ? 'success' : 'warning' })
    emit('imported')
    if (!skipped.value.length && count > 0) isOpen.value = false
  } catch (error: unknown) {
    errorMessage.value = (error as { data?: { message?: string } }).data?.message || '发布失败，请重试。重试不会重复创建已完成的发布副本。'
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="快速发布到组织资产"
    :dismissible="!importing"
    :close="!importing"
    :description="`目标：${categoryTitle}${targetPath ? ` / ${targetPath}` : ''}`"
    :ui="{ content: 'sm:max-w-4xl', body: 'space-y-4' }"
  >
    <template #body>
      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        description="仅系统管理员可用。保留源部门文档，生成只读发布副本；无需审批，不发送企业微信通知。"
      />
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="来源部门">
          <USelectMenu
            v-model="selectedDeptCode"
            :items="departmentOptions"
            value-key="value"
            placeholder="选择部门"
            aria-label="来源部门"
            class="w-full"
            :disabled="importing"
            @update:model-value="changeDepartment"
          />
        </UFormField>
        <UFormField label="文档目录">
          <USelect
            v-model="selectedFolderId"
            :items="folderOptions"
            class="w-full"
            :disabled="!selectedDeptCode || importing"
            @update:model-value="changeFolder"
          />
        </UFormField>
      </div>
      <UAlert v-if="errorMessage" color="error" :description="errorMessage" />
      <UTable
        :data="documents"
        :columns="columns"
        :loading="loading"
        class="max-h-80 overflow-auto"
      >
        <template #select-header>
          <UCheckbox
            :model-value="allSelected"
            aria-label="选择本页全部文档"
            :disabled="!documents.length || importing"
            @update:model-value="togglePage($event === true)"
          />
        </template>
        <template #select-cell="{ row }">
          <UCheckbox
            :model-value="selectedUuids.includes(row.original.uuid)"
            :aria-label="`选择 ${row.original.title}`"
            :disabled="importing"
            @update:model-value="toggle(row.original.uuid, $event === true)"
          />
        </template>
        <template #title-cell="{ row }">
          <span class="block max-w-40 truncate sm:max-w-80" :title="row.original.title">{{ row.original.title }}</span>
        </template>
        <template #updated_at-cell="{ row }">
          {{ row.original.updated_at ? new Date(row.original.updated_at).toLocaleDateString() : '—' }}
        </template>
        <template #empty>
          <CommonEmptyState icon="i-lucide-files" :title="selectedDeptCode ? '当前目录暂无文档' : '请选择来源部门'" />
        </template>
      </UTable>
      <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span>共 {{ total }} 条，已选 {{ selectedUuids.length }} 个（最多 50 个）</span>
        <UPagination
          v-model:page="page"
          :items-per-page="pageSize"
          :total="total"
          :disabled="importing || loading"
          @update:page="loadSource"
        />
      </div>
      <div v-if="skipped.length" class="max-h-28 overflow-auto text-sm text-muted">
        <p v-for="item in skipped" :key="item.sourceUuid">
          {{ item.title }}：{{ item.reason }}
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          variant="outline"
          color="neutral"
          :disabled="importing"
          @click="isOpen = false"
        >
          取消
        </UButton>
        <UButton
          icon="i-lucide-upload"
          :disabled="!selectedUuids.length || loading"
          :loading="importing"
          @click="publish"
        >
          直接发布
        </UButton>
      </div>
    </template>
  </UModal>
</template>
