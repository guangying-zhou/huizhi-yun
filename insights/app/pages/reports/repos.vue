<script setup lang="ts">
import { h, ref, computed, watch, onMounted } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { Department, RepoReportItem } from '~/types/repoinsight'

const { apiBase } = useApiBase()

const UButton = resolveComponent('UButton')
const UProgress = resolveComponent('UProgress')
const UBadge = resolveComponent('UBadge')

const { data: departmentsResponse } = useAsyncData(
  'repoDepartments',
  () => $fetch<{ data: Department[] }>(`${apiBase}/departments`)
)
const departments = computed(() => departmentsResponse.value?.data ?? [])
const validDepartments = computed(() => departments.value.filter(dept => dept.isActive))
const deptOptions = computed(() => [
  { label: '全部', value: 0 },
  ...validDepartments.value.map(dept => ({ label: dept.name, value: dept.id }))
])
const selectedDeptId = ref(0)

const period = ref('year')
const { year } = usePersistedYear()

onMounted(() => {
  const stateYear = import.meta.client ? history.state?.year : undefined
  if (stateYear !== undefined && stateYear !== null) {
    period.value = stateYear == 0 ? 'all_time' : 'year'
    year.value = Number.parseInt(stateYear as string) || year.value
  }
})

const columns: TableColumn<RepoReportItem>[] = [
  {
    id: 'rank',
    accessorFn: () => null,
    header: () => h(UButton, { color: 'neutral', variant: 'ghost', label: '排名' }),
    cell: ({ row, table }) => {
      const sortedRows = table.getSortedRowModel().rows
      const index = sortedRows.findIndex(r => r.id === row.id)
      const sorting = table.getState().sorting
      const isAsc = sorting.length > 0 && !sorting[0]?.desc
      const rank = isAsc ? sortedRows.length - index : index + 1
      let colorClass = 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
      let content = String(rank)
      if (rank === 1) { colorClass = 'bg-yellow-100 text-yellow-600 dark:bg-yellow-500/10 dark:text-yellow-400'; content = '🥇' } else if (rank === 2) { colorClass = 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400'; content = '🥈' } else if (rank === 3) { colorClass = 'bg-orange-100 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400'; content = '🥉' }
      return h('div', { class: 'flex items-center gap-2' }, [
        h('div', { class: `w-8 h-8 flex items-center justify-center rounded-full text-sm font-semibold ${colorClass}` }, content)
      ])
    }
  },
  {
    accessorKey: 'repo_name',
    header: () => h(UButton, { color: 'neutral', variant: 'ghost', label: '仓库' }),
    cell: ({ row }) => h(UButton, {
      to: `/repos/${row.original.repo_catalog_id}`,
      color: 'secondary',
      variant: 'ghost',
      label: row.getValue('repo_name')
    })
  },
  {
    accessorKey: 'department_name',
    header: () => h(UButton, { color: 'neutral', variant: 'ghost', label: '部门' }),
    cell: ({ row }) => h('div', { class: 'text-sm text-muted-500' }, row.getValue('department_name') || '-')
  },
  {
    accessorKey: 'active_contributors',
    header: ({ column }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '活跃人数',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: isSorted ? (isSorted === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => h('div', { class: 'text-center' }, row.getValue('active_contributors'))
  },
  {
    accessorKey: 'total_commits',
    header: ({ column }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '提交次数',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: isSorted ? (isSorted === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => h('div', { class: 'text-center' }, row.getValue('total_commits'))
  },
  {
    accessorKey: 'net_lines_added',
    header: ({ column }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '净增行数',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: isSorted ? (isSorted === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => {
      const net_lines_added = Number.parseFloat(row.getValue('net_lines_added'))
      return h('div', { class: 'text-right font-medium' }, net_lines_added.toLocaleString())
    }
  },
  {
    accessorKey: 'submission_quality',
    header: ({ column }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '提交质量',
        class: `font-semibold flex text-right ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: isSorted ? (isSorted === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => {
      const value = Number(row.getValue('submission_quality'))
      return h('div', { class: 'text-right' }, [
        h('span', { class: 'text-right text-xs' }, value.toLocaleString() + '%'),
        h(UProgress, { color: 'secondary', size: 'sm', modelValue: value })
      ])
    }
  }
]

const repos = ref<RepoReportItem[]>([])
const { data: originalRepos, pending, refresh } = await useFetch<RepoReportItem[]>(`${apiBase}/reports/repos`, {
  key: 'repos-report',
  query: computed(() => ({ period: period.value, year: year.value }))
})

repos.value = originalRepos.value
  ? originalRepos.value.filter(repo =>
      repo.department_name === (validDepartments.value.find(d => d.id === selectedDeptId.value)?.name || null)
      || selectedDeptId.value === 0
    )
  : []

const periodWorkingDays = ref(0)

watch(repos, () => {
  if (repos.value && repos.value.length > 0) {
    periodWorkingDays.value = repos.value[0]?.periodWorkingDays || 0
  }
})

watch(originalRepos, () => {
  repos.value = originalRepos.value
    ? originalRepos.value.filter(repo =>
        repo.department_name === (validDepartments.value.find(d => d.id === selectedDeptId.value)?.name || null)
        || selectedDeptId.value === 0
      )
    : []
})

watch(selectedDeptId, () => {
  repos.value = originalRepos.value
    ? originalRepos.value.filter(repo =>
        repo.department_name === (validDepartments.value.find(d => d.id === selectedDeptId.value)?.name || null)
        || selectedDeptId.value === 0
      )
    : []
})

const periodOptions = [
  { label: '当月', value: 'current_month' },
  { label: '上月', value: 'last_month' },
  { label: '年度', value: 'year' },
  { label: '全部', value: 'all_time' }
]

const sorting = ref([{ id: 'net_lines_added', desc: true }])
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel :ui="{ body: 'gap-1 sm:p-3' }">
      <template #header>
        <UDashboardNavbar
          title="仓库报表"
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
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-600 dark:text-gray-400">部门:</span>
              <USelect
                v-model="selectedDeptId"
                :items="deptOptions"
                value-key="value"
                label-key="label"
                size="sm"
                class="min-w-[120px]"
              />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-600 dark:text-gray-400">时间范围:</span>
              <USelect
                v-model="period"
                :items="periodOptions"
                value-key="value"
                label-key="label"
                size="sm"
                class="w-24"
              />
            </div>
            <div
              v-if="period === 'year'"
              class="flex items-center gap-2"
            >
              <span class="text-sm text-gray-600 dark:text-gray-400">年份:</span>
              <UInput
                v-model="year"
                type="number"
                size="sm"
                class="w-24"
              />
            </div>
          </template>
          <template #right>
            <UBadge
              v-if="periodWorkingDays"
              variant="soft"
              color="neutral"
            >
              {{ periodWorkingDays + '天' }}
            </UBadge>
            <UBadge
              v-if="repos?.length"
              variant="soft"
              color="neutral"
            >
              {{ repos?.length + '个仓库' }}
            </UBadge>
          </template>
        </UDashboardToolbar>
      </template>

      <template #body>
        <UCard
          v-if="repos !== null"
          :ui="{ body: 'p-0' }"
        >
          <UTable
            v-if="repos"
            v-model:sorting="sorting"
            :ui="{ td: 'p-2' }"
            :columns="columns"
            :data="repos"
            :loading="pending"
            row-key="repo_catalog_id"
            sticky
            class="h-[calc(100vh-170px)] pt-0 w-full"
          />

          <div
            v-if="!pending && (!repos || repos.length === 0)"
            class="py-10 text-center text-sm text-muted-500"
          >
            暂无数据
          </div>

          <div
            v-if="!pending && repos && repos.length > 0"
            class="px-4 py-2 text-center text-xs text-muted-500 border-t border-gray-100 dark:border-gray-800"
          >
            共 {{ repos.length }} 个仓库
          </div>
        </UCard>
      </template>
    </UDashboardPanel>
  </div>
</template>
