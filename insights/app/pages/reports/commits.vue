<script setup lang="ts">
import { h, ref, computed, watch } from 'vue'
import type { TableColumn } from '@nuxt/ui'

const { apiBase } = useApiBase()

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')

interface CommitReportItem {
  id: number
  repoCatalogId: number
  repoName: string
  authorName: string
  personId: number | null
  personRealName: string | null
  commitHash: string
  committedAt: string
  filesAdded: number
  codeFilesAdded: number
  codeFilesDeleted: number
  codeFilesModified: number
  codeFilesDuplicated: number
  binaryFilesAdded: number
  binaryFilesDeleted: number
  binaryFilesModified: number
  binaryFilesDuplicated: number
  linesAdded: number
  linesDeleted: number
  linesModified: number
  filesUnexpected: number
  filesInBannedDirectories: number
  directoriesBanned: number
  abnormalEvents: number
  totalFilesChanged: number
  totalLinesChanged: number
  netLinesAdded: number
  bytesAdded: number
  binaryBytesAdded: number
  unexpectedFilesBytes: number
  duplicateFilesBytes: number
  submissionQuality: number | null
  codeQuality: number | null
}

interface ApiResponse {
  data: CommitReportItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

// Filters
const page = ref(1)
const pageSize = ref(50)
const sortBy = ref('committed_at')
const sortOrder = ref<'asc' | 'desc'>('desc')
const selectedRepoId = ref<number | undefined>(undefined)
const selectedPersonId = ref<number | undefined>(undefined)

// Date Range Picker
const now = new Date()
const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const startDateStr = ref(toDateStr(firstDayOfMonth))
const endDateStr = ref(toDateStr(now))

function onStartDateUpdate(date: string) {
  startDateStr.value = date
}

function onEndDateUpdate(date: string) {
  endDateStr.value = date
}

interface FilterOption {
  id: number
  name: string
}

interface FiltersResponse {
  repos: FilterOption[]
  authors: FilterOption[]
}

const filterParams = computed(() => ({
  startDate: startDateStr.value,
  endDate: endDateStr.value
}))

const { data: filtersData } = await useFetch<FiltersResponse>(`${apiBase}/reports/commits-filters`, {
  key: 'commits-filters',
  query: filterParams
})

const repoOptions = computed(() => [
  { id: 0, name: '全部仓库' },
  ...(filtersData.value?.repos || [])
])

const authorOptions = computed(() => [
  { id: 0, name: '全部作者' },
  ...(filtersData.value?.authors || [])
])

const queryParams = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  startDate: startDateStr.value,
  endDate: endDateStr.value,
  sortBy: sortBy.value,
  sortOrder: sortOrder.value,
  repoId: selectedRepoId.value || undefined,
  personId: selectedPersonId.value || undefined
}))

const { data: response, pending, refresh } = await useFetch<ApiResponse>(`${apiBase}/reports/commits`, {
  key: 'commits-report',
  query: queryParams
})

const commits = computed(() => response.value?.data || [])
const pagination = computed(() => response.value?.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 0 })

// Commit detail modal
const showCommitModal = ref(false)
const selectedCommitId = ref<number | null>(null)

const openCommitModal = (commitId: number) => {
  selectedCommitId.value = commitId
  showCommitModal.value = true
}

// Sorting handler
const handleSort = (column: string) => {
  if (sortBy.value === column) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortBy.value = column
    sortOrder.value = 'desc'
  }
  page.value = 1
}

const getSortIcon = (column: string) => {
  if (sortBy.value !== column) return 'i-lucide-arrow-up-down'
  return sortOrder.value === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'
}

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-'
  return dateStr.replace('T', ' ').substring(0, 16)
}

const columns: TableColumn<CommitReportItem>[] = [
  {
    accessorKey: 'id',
    header: 'ID',
    cell: ({ row }) => h(UButton, {
      label: String(row.original.id),
      size: 'xs',
      color: 'secondary',
      variant: 'ghost',
      onClick: () => openCommitModal(row.original.id)
    })
  },
  {
    accessorKey: 'committedAt',
    header: ({ column }) => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      label: '提交时间',
      class: sortBy.value === 'committed_at' ? 'text-primary' : '',
      icon: getSortIcon('committed_at'),
      onClick: () => handleSort('committed_at')
    }),
    cell: ({ row }) => h('span', { class: 'text-xs' }, formatDate(row.original.committedAt))
  },
  {
    accessorKey: 'repoName',
    header: '仓库',
    cell: ({ row }) => h(UButton, {
      to: `/repos/${row.original.repoCatalogId}`,
      color: 'secondary',
      variant: 'ghost',
      size: 'xs',
      label: row.original.repoName
    })
  },
  {
    accessorKey: 'authorName',
    header: () => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      label: '作者',
      class: 'flex justify-start gap-2'
    }),
    cell: ({ row }) => h('span', { class: 'text-sm' }, row.original.personRealName || row.original.authorName)
  },
  {
    accessorKey: 'filesAdded',
    header: () => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      label: '文件变更',
      class: sortBy.value === 'total_files_changed' ? 'text-primary' : '',
      icon: getSortIcon('total_files_changed'),
      onClick: () => handleSort('total_files_changed')
    }),
    cell: ({ row }) => h('div', { class: 'text-center' }, row.original.totalFilesChanged)
  },
  {
    accessorKey: 'linesAdded',
    header: () => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      label: '增删改行'
    }),
    cell: ({ row }) => {
      const { linesAdded, linesDeleted, linesModified } = row.original
      return h('span', { class: 'text-center' }, `${linesAdded.toLocaleString()} | ${linesDeleted.toLocaleString()} | ${linesModified.toLocaleString()}`)
    }
  },
  {
    accessorKey: 'submissionQuality',
    header: () => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      label: '提交质量'
    }),
    cell: ({ row }) => {
      const val = row.original.submissionQuality
      if (val === null || val === undefined) return h('div', { class: 'text-right text-muted-400' }, '-')
      return h('div', { class: 'text-right text-xs' }, Number(val).toFixed(1) + '%')
    }
  },
  {
    accessorKey: 'abnormalEvents',
    header: () => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      label: '异常事件',
      class: sortBy.value === 'abnormal_events' ? 'text-primary' : '',
      icon: getSortIcon('abnormal_events'),
      onClick: () => handleSort('abnormal_events')
    }),
    cell: ({ row }) => {
      const val = row.original.abnormalEvents
      if (val > 0) {
        return h(UBadge, { color: 'error', variant: 'subtle', size: 'xs' }, () => val)
      }
      return h('span', { class: 'text-muted-400' }, '-')
    }
  }
]

// Reset page when filters change
watch([startDateStr, endDateStr], () => {
  page.value = 1
  selectedRepoId.value = undefined
  selectedPersonId.value = undefined
})

watch([selectedRepoId, selectedPersonId], () => {
  page.value = 1
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel :ui="{ body: 'gap-1 sm:p-3' }">
      <template #header>
        <UDashboardNavbar
          title="提交列表"
          :ui="{ root: 'h-12' }"
        >
          <template #leading>
            <UDashboardSidebarCollapse />
          </template>
          <template #right>
            <UButton
              color="secondary"
              size="sm"
              variant="soft"
              icon="i-lucide-refresh-cw"
              :loading="pending"
              @click="() => refresh()"
            >
              刷新
            </UButton>
          </template>
        </UDashboardNavbar>

        <UDashboardToolbar>
          <template #left>
            <span class="text-sm">时间范围:</span>
            <RepoinsightDateRangePicker
              @update:start-date="onStartDateUpdate"
              @update:end-date="onEndDateUpdate"
            />

            <span class="text-sm ml-4">仓库:</span>
            <USelect
              v-model="selectedRepoId"
              :items="repoOptions"
              value-key="id"
              label-key="name"
              size="sm"
              class="min-w-[150px]"
              placeholder="全部仓库"
            />

            <span class="text-sm ml-4">作者:</span>
            <USelect
              v-model="selectedPersonId"
              :items="authorOptions"
              value-key="id"
              label-key="name"
              size="sm"
              class="min-w-[150px]"
              placeholder="全部作者"
            />
          </template>
          <template #right>
            <UBadge
              v-if="pagination.total"
              variant="soft"
              color="neutral"
            >
              共 {{
                pagination.total.toLocaleString() }}
              条提交
            </UBadge>
          </template>
        </UDashboardToolbar>
      </template>

      <template #body>
        <UCard :ui="{ body: 'p-0' }">
          <UTable
            :columns="columns"
            :data="commits"
            :loading="pending"
            :ui="{ td: 'p-2' }"
            row-key="id"
            sticky
            class="h-[calc(100vh-180px)] w-full"
          />

          <div
            v-if="!pending && commits.length === 0"
            class="py-10 text-center text-sm text-muted-500"
          >
            暂无数据
          </div>

          <div
            v-if="!pending && commits.length > 0"
            class="px-4 py-2 flex justify-between items-center border-t border-gray-100 dark:border-gray-800"
          >
            <span class="text-xs text-muted-500">
              显示 {{ ((page - 1) * pageSize) + 1 }} - {{ Math.min(page * pageSize, pagination.total) }} 条，共
              {{ pagination.total.toLocaleString() }} 条
            </span>
            <UPagination
              v-model:page="page"
              :total="pagination.total"
              :items-per-page="pageSize"
              :sibling-count="1"
              size="xs"
              :disabled="pending"
              show-edges
            />
          </div>
        </UCard>
      </template>
    </UDashboardPanel>

    <RepoinsightCommitDetailModal
      v-if="selectedCommitId"
      v-model="showCommitModal"
      :commit-id="selectedCommitId"
    />
  </div>
</template>
