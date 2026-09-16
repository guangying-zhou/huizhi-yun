<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface DocumentRow {
  id: number | string
  title: string
  owner_name: string
  updated_at: string
  [key: string]: unknown
}

interface TableRow {
  original: DocumentRow
  [key: string]: unknown
}

const props = withDefaults(defineProps<{
  title?: string
  fetcher?: () => Promise<DocumentRow[]>
  columns?: TableColumn<DocumentRow>[]
  loading?: boolean
  rows?: DocumentRow[]
}>(), {
  title: '文档列表',
  loading: false,
  rows: () => []
})

const search = ref('')

// Default columns if not provided
const defaultColumns: TableColumn<DocumentRow>[] = [
  {
    accessorKey: 'title',
    header: '名称'
  },
  {
    accessorKey: 'owner_name',
    header: '所有者'
  },
  {
    accessorKey: 'updated_at',
    header: '最后修改'
  }
]

const columns = computed(() => props.columns || defaultColumns)

const filteredRows = computed(() => {
  if (!search.value) return props.rows
  return props.rows.filter((row: DocumentRow) => {
    return Object.values(row).some((value) => {
      return String(value).toLowerCase().includes(search.value.toLowerCase())
    })
  })
})

const getRowLink = (row: DocumentRow) => `/documents/${row.id}`
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar :title="title">
      <template #right>
        <UInput v-model="search" icon="i-lucide-magnifying-glass-20-solid" placeholder="搜索..." />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar>
      <template #left>
        <!-- Filter slots or buttons can go here -->
      </template>
      <template #right>
        <!-- View toggle or other actions -->
      </template>
    </UDashboardToolbar>

    <ClientOnly>
      <UTable
        :data="filteredRows"
        :columns="columns"
        :loading="loading"
        class="w-full"
        :ui="selectableTableUi"
        @select="(event: unknown, row: unknown) => { const tr = row as TableRow; navigateTo(getRowLink(tr.original)) }"
      >
        <template #empty>
          <CommonEmptyState icon="i-lucide-files" title="暂无文档" description="创建或添加文档后会显示在这里。" />
        </template>

        <template #title-cell="{ row }">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="w-4 h-4 text-gray-500" />
            <span class="font-medium text-gray-900 dark:text-gray-100">{{ row.original.title }}</span>
          </div>
        </template>

        <template #owner_name-cell="{ row }">
          <div class="flex items-center gap-2">
            <UAvatar :alt="row.original.owner_name" size="xs" />
            <span>{{ row.original.owner_name }}</span>
          </div>
        </template>

        <template #updated_at-cell="{ row }">
          {{ formatDate(row.original.updated_at) }}
        </template>
      </UTable>
    </ClientOnly>
  </UDashboardPanel>
</template>
