<script setup lang="ts">
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

interface ColumnDef {
  id: string
  key: string
  label: string
  sortable?: boolean
}

const props = withDefaults(defineProps<{
  title?: string
  fetcher?: () => Promise<DocumentRow[]>
  columns?: ColumnDef[]
  loading?: boolean
  rows?: DocumentRow[]
}>(), {
  title: '文档列表',
  loading: false,
  rows: () => []
})

const search = ref('')

// Default columns if not provided
const defaultColumns = [
  {
    id: 'title',
    key: 'title',
    label: '名称',
    sortable: true
  },
  {
    id: 'owner',
    key: 'owner',
    label: '所有者',
    sortable: true
  },
  {
    id: 'updated_at',
    key: 'updated_at',
    label: '最后修改',
    sortable: true
  },
  {
    id: 'actions',
    key: 'actions',
    label: '操作'
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
        :rows="filteredRows"
        :columns="columns"
        :loading="loading"
        class="w-full"
        @select="(event: unknown, row: unknown) => { const tr = row as TableRow; navigateTo(getRowLink(tr.original)) }"
      >
        <template #title-data="{ row: tableRow }">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="w-4 h-4 text-gray-500" />
            <span class="font-medium text-gray-900 dark:text-gray-100">{{ (tableRow as unknown as DocumentRow).title }}</span>
          </div>
        </template>

        <template #owner-data="{ row: tableRow }">
          <div class="flex items-center gap-2">
            <UAvatar :alt="(tableRow as unknown as DocumentRow).owner_name" size="xs" />
            <span>{{ (tableRow as unknown as DocumentRow).owner_name }}</span>
          </div>
        </template>

        <template #updated_at-data="{ row: tableRow }">
          {{ new Date((tableRow as unknown as DocumentRow).updated_at).toLocaleDateString() }}
        </template>

        <template #actions-data="{ row: tableRow }">
          <UDropdownMenu
            :items="[
              [{
                label: '打开',
                icon: 'i-lucide-arrow-top-right-on-square-20-solid',
                click: () => navigateTo(getRowLink((tableRow as unknown as DocumentRow)))
              }],
              [{
                label: '删除',
                icon: 'i-lucide-trash-20-solid',
                click: () => console.log('Delete', (tableRow as unknown as DocumentRow).id)
              }]
            ]"
          >
            <UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis" />
          </UDropdownMenu>
        </template>
      </UTable>
    </ClientOnly>
  </UDashboardPanel>
</template>
