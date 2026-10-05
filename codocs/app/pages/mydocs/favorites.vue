<script setup lang="ts">
import MyDocumentSpaceHeader from '../../components/MyDocumentSpaceHeader.vue'
import { h, resolveComponent } from 'vue'
import { useDocumentDownload } from '../../composables/useDocumentDownload'
import { useCodocsModule } from '../../../layer/useCodocsModule'

definePageMeta({ hostContentInset: false })

interface FavoriteDocument {
  uuid: string
  title: string
  folder_name?: string
  updated_at: string
}

interface DocumentsListResponse {
  data?: {
    items: FavoriteDocument[]
    total: number
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
const { page, pageSize } = useListPage({ pageSize: 20 })
const total = ref(0)

const UButton = resolveComponent('UButton')
const toast = useToast()
const apiFetch = useRequestFetch()
const { moduleUrl, documentUrl, cacheKey, hosted } = useCodocsModule()
const { user } = useAuth()
const { downloadDocument } = useDocumentDownload()
const uid = computed(() => user.value || 'user1')

// Fetch starred documents
const fetchFavorites = async () => {
  // The Enterprise Host derives the owner from the verified session and only
  // accepts bounded page/pageSize; standalone keeps its legacy owner + limit.
  const response = await apiFetch<DocumentsListResponse>(moduleUrl('/api/documents'), {
    query: hosted
      ? { starred: true, page: page.value, pageSize }
      : { owner: uid.value, starred: true, page: page.value, limit: pageSize }
  })
  total.value = Number(response?.data?.total || 0)
  return response?.data?.items || []
}

const { data: documents, pending, refresh } = await useAsyncData(
  cacheKey('my-favorites'),
  fetchFavorites,
  {
    getCachedData: () => undefined, // Always fetch fresh data on navigation
    server: false,
    watch: [page]
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
    await $fetch(moduleUrl(`/api/documents/${doc.uuid}`), {
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
    navigateTo(documentUrl(row.original.uuid))
  }
}
</script>

<template>
  <UDashboardPanel grow>
    <div class="px-4 pt-4 sm:px-6 sm:pt-6">
      <MyDocumentSpaceHeader description="快速访问已收藏的文档。" />
    </div>
    <UDashboardToolbar>
      <template #left>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-star" class="w-4 h-4 text-warning" />
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
            :ui="selectableTableUi"
            @select="handleRowSelect"
          >
            <template #empty>
              <CommonEmptyState icon="i-lucide-star" title="暂无收藏文档" description="收藏的文档会显示在这里。" />
            </template>
            <template #folder_name-cell="{ row }">
              <span class="text-sm">
                {{ row.original.folder_name || '/' }}
              </span>
            </template>

            <template #title-cell="{ row }">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-file-text" class="w-4 h-4 text-muted" />
                <span
                  class="font-medium text-default cursor-pointer hover:underline"
                  @click.stop="row?.original?.uuid && navigateTo(documentUrl(row.original.uuid))"
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
                @click.stop="navigateTo(documentUrl(row.original.uuid))"
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
          <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination v-model:page="page" :items-per-page="pageSize" :total="total" />
          </div>
        </div>
      </ClientOnly>
    </div>
  </UDashboardPanel>
</template>
