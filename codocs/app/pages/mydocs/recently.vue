<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

interface DocRecord {
  uuid: string
  title: string
  owner_uid: string
  updated_at: string
}

const { user } = useAuth()
const userId = computed(() => user.value || 'user1')
const apiFetch = useRequestFetch()

usePageTitle('最近使用')

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
  // Fetch docs where current user is the last_editor
  const response = await apiFetch<{ data?: { items: DocRecord[] } }>('/api/documents', {
    query: {
      last_editor: userId.value
    }
  })
  return response?.data?.items || []
}

const { data: documents, pending } = await useAsyncData('my-recent-docs', fetchRecentlyEdited)

// Actions
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
    <div class="flex-1 overflow-auto p-4">
      <ClientOnly>
        <div>
          <UTable
            v-model:sorting="sorting"
            :data="documents || []"
            :columns="columns"
            :loading="pending"
            class="w-full"
            @select="(_event: unknown, row: unknown) => { const doc = (row as DocRecord); navigateTo(`/documents/${doc.uuid}`) }"
          >
            <template #title-cell="{ row: docRow }">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-file-text" class="w-4 h-4 text-gray-500" />
                <span class="font-medium text-gray-900 dark:text-gray-100">{{ (docRow as unknown as DocRecord).title }}</span>
              </div>
            </template>

            <template #owner_uid-cell="{ row: docRow }">
              <div class="flex items-center gap-2">
                <UAvatar :alt="(docRow as unknown as DocRecord).owner_uid" size="2xs" />
                <span class="text-sm text-gray-500">{{ (docRow as unknown as DocRecord).owner_uid }}</span>
              </div>
            </template>

            <template #updated_at-cell="{ row: docRow }">
              {{ new Date((docRow as unknown as DocRecord).updated_at).toLocaleString('zh-CN', {
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
                  @click.stop="navigateTo(`/documents/${(docRow as unknown as DocRecord).uuid}`)"
                />

                <UDropdownMenu
                  :items="[
                    [{
                      label: '下载',
                      icon: 'i-lucide-download',
                      onSelect: () => downloadDocument((docRow as unknown as DocRecord).uuid)
                    }]
                  ]"
                >
                  <UButton color="neutral" variant="ghost" icon="i-lucide-ellipsis" />
                </UDropdownMenu>
              </div>
            </template>
          </UTable>
        </div>
      </ClientOnly>
    </div>
  </UDashboardPanel>
</template>
