<script setup lang="ts">
import MyDocumentSpaceHeader from '../../components/MyDocumentSpaceHeader.vue'
import { useDocumentDownload } from '../../composables/useDocumentDownload'
import { useCodocsModule } from '../../../layer/useCodocsModule'

definePageMeta({ hostContentInset: false })

interface DocRecord {
  uuid: string
  title: string
  owner_uid: string
  updated_at: string
}

const { user } = useAuth()
const userId = computed(() => user.value || 'user1')
const apiFetch = useRequestFetch()
const { downloadDocument } = useDocumentDownload()
const { moduleUrl, documentUrl, cacheKey, hosted } = useCodocsModule()

usePageTitle('最近使用')
const { page, pageSize } = useListPage({ pageSize: 20 })
const total = ref(0)

const sorting = ref<[{ id: string, desc: boolean }]>([{ id: 'updated_at', desc: true }])

// Columns
const columns = [
  {
    accessorKey: 'title',
    header: '名称'
  },
  {
    accessorKey: 'owner_uid',
    header: '所有者'
  },
  {
    accessorKey: 'updated_at',
    header: '最后修改'
  },
  {
    id: 'actions',
    header: '操作'
  }
]

// Fetch data
const fetchRecentlyEdited = async () => {
  // Standalone: docs where the current user is the last_editor. The Enterprise
  // Host never accepts an identity filter from the browser; it lists the
  // verified actor's own documents, most recently updated first.
  const response = await apiFetch<{ data?: { items: DocRecord[], total: number } }>(moduleUrl('/api/documents'), {
    query: hosted
      ? { page: page.value, pageSize }
      : { last_editor: userId.value, page: page.value, limit: pageSize }
  })
  total.value = Number(response?.data?.total || 0)
  return response?.data?.items || []
}

const { data: documents, pending } = await useAsyncData(cacheKey('my-recent-docs'), fetchRecentlyEdited, { watch: [page] })
</script>

<template>
  <UDashboardPanel grow>
    <div class="px-4 pt-4 sm:px-6 sm:pt-6">
      <MyDocumentSpaceHeader description="继续处理近期打开的文档。" />
    </div>
    <div class="flex-1 overflow-auto p-4">
      <ClientOnly>
        <div>
          <UTable
            v-model:sorting="sorting"
            :data="documents || []"
            :columns="columns"
            :loading="pending"
            class="w-full"
            :ui="selectableTableUi"
            @select="(_event: unknown, row: unknown) => { const doc = (row as DocRecord); navigateTo(documentUrl(doc.uuid)) }"
          >
            <template #empty>
              <CommonEmptyState icon="i-lucide-history" title="暂无最近文档" description="打开过的文档会显示在这里。" />
            </template>
            <template #title-cell="{ row: docRow }">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-file-text" class="w-4 h-4 text-muted" />
                <span class="font-medium text-default">{{ (docRow.original as DocRecord).title }}</span>
              </div>
            </template>

            <template #owner_uid-cell="{ row: docRow }">
              <div class="flex items-center gap-2">
                <UAvatar :alt="(docRow.original as DocRecord).owner_uid" size="2xs" />
                <span class="text-sm text-muted">{{ (docRow.original as DocRecord).owner_uid }}</span>
              </div>
            </template>

            <template #updated_at-cell="{ row: docRow }">
              {{ new Date((docRow.original as DocRecord).updated_at).toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              }).replace(/\//g, '-') }}
            </template>

            <template #actions-cell="{ row: docRow }">
              <div class="flex items-center gap-1">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-edit"
                  @click.stop="navigateTo(documentUrl((docRow.original as DocRecord).uuid))"
                />

                <UDropdownMenu
                  :items="[
                    [{
                      label: '下载',
                      icon: 'i-lucide-download',
                      onSelect: () => downloadDocument((docRow.original as DocRecord).uuid)
                    }]
                  ]"
                >
                  <UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis" />
                </UDropdownMenu>
              </div>
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
