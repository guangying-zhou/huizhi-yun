<script setup lang="ts">
import { h, resolveComponent } from 'vue'

definePageMeta({
  layout: 'default'
})

interface FavoriteDocument {
  uuid: string
  title: string
  folder_name?: string
  updated_at: string
}

interface DocumentsListResponse {
  data?: {
    items: FavoriteDocument[]
  }
}

interface SortableColumn {
  getIsSorted: () => false | 'asc' | 'desc'
  toggleSorting: (desc?: boolean) => void
}

interface ColumnHeaderContext {
  column: SortableColumn
}

usePageTitle('个人收藏')

const UButton = resolveComponent('UButton')
const toast = useToast()
const apiFetch = useRequestFetch()
const { user } = useAuth()
const uid = computed(() => user.value || 'user1')

// Fetch starred documents
const fetchFavorites = async () => {
  const response = await apiFetch<DocumentsListResponse>('/api/documents', {
    query: {
      owner: uid.value,
      starred: true
    }
  })
  return response?.data?.items || []
}

const { data: documents, pending, refresh } = await useAsyncData(
  'my-favorites',
  fetchFavorites,
  {
    getCachedData: () => undefined, // Always fetch fresh data on navigation
    server: false
  }
)

// Sorting
const sorting = ref<[{ id: string, desc: boolean }]>([{ id: 'updated_at', desc: true }])

// Columns
const columns = [

  {
    accessorKey: 'title',
    header: ({ column }: ColumnHeaderContext) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: '名称',
        icon: isSorted === 'asc'
          ? 'i-lucide-arrow-up'
          : isSorted === 'desc'
            ? 'i-lucide-arrow-down'
            : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
  },
  {
    accessorKey: 'folder_name',
    header: '文件夹',
    class: 'w-32'
  },
  {
    accessorKey: 'updated_at',
    header: ({ column }: ColumnHeaderContext) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: '最后修改',
        icon: isSorted === 'asc'
          ? 'i-lucide-arrow-up'
          : isSorted === 'desc'
            ? 'i-lucide-arrow-down'
            : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    }
  },
  { id: 'actions', header: '操作' }
]

// Toggle Star (Remove from favorites)
const toggleStar = async (doc: FavoriteDocument) => {
  // If we are in favorites, clicking star (which is solid) means unstar
  const newStatus = false // !doc.star_flag where doc.star_flag is 1

  // Optimistic update - remove from list immediately?
  // Or just change icon and let refresh handle it?
  // Better to just call API and refresh.

  try {
    await $fetch(`/api/documents/${doc.uuid}`, {
      method: 'PATCH',
      body: { star_flag: newStatus }
    })
    toast.add({ title: '已取消收藏', color: 'success' })
    await refresh()
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  }
}

const handleRowSelect = (_e: Event, row: { original?: FavoriteDocument }) => {
  if (row.original?.uuid) {
    navigateTo(`/documents/${row.original.uuid}`)
  }
}

const downloadDocument = (uuid: string) => {
  const link = document.createElement('a')
  link.href = `/api/documents/${uuid}/download`
  link.download = ''
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardToolbar>
      <template #left>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-star" class="w-4 h-4 text-yellow-500" />
          <span class="text-sm font-medium">我的收藏文档</span>
          <UBadge color="neutral" variant="subtle" size="sm">
            {{ documents?.length || 0 }} 个文档
          </UBadge>
        </div>
      </template>
    </UDashboardToolbar>

    <div class="flex-1 overflow-auto p-4">
      <ClientOnly>
        <div>
          <UTable
            :key="`favorites-${documents?.length || 0}`"
            v-model:sorting="sorting"
            :data="documents || []"
            :columns="columns"
            :loading="pending"
            class="w-full"
            @select="handleRowSelect"
          >
            <template #folder_name-cell="{ row }">
              <span class="text-sm">
                {{ row.original.folder_name || '/' }}
              </span>
            </template>

            <template #title-cell="{ row }">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-file-text" class="w-4 h-4 text-gray-500" />
                <span
                  class="font-medium text-gray-900 dark:text-gray-100 cursor-pointer hover:underline"
                  @click.stop="row?.original?.uuid && navigateTo(`/documents/${row.original.uuid}`)"
                >
                  {{ row.original.title }}
                </span>
              </div>
            </template>

            <template #updated_at-cell="{ row }">
              {{ new Date(row.original.updated_at).toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              }).replace(/\//g, '-') }}
            </template>

            <template #actions-cell="{ row }">
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-edit"
                @click.stop="navigateTo(`/documents/${row.original.uuid}`)"
              />
              <UDropdownMenu
                :items="[
                  [{
                    label: '下载',
                    icon: 'i-lucide-download',
                    onSelect: () => downloadDocument(row.original.uuid)
                  }],
                  [{
                    label: '取消收藏',
                    icon: 'i-lucide-star-off',
                    onSelect: () => toggleStar(row.original)
                  }]
                ]"
              >
                <UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis" />
              </UDropdownMenu>
            </template>
          </UTable>
        </div>
      </ClientOnly>
    </div>
  </UDashboardPanel>
</template>
