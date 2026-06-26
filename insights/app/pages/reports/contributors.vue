<script setup lang="ts">
import { h, ref, computed, watch, onMounted } from 'vue'
import type { TableColumn } from '@nuxt/ui'

const { apiBase } = useApiBase()

const UButton = resolveComponent('UButton')
const UProgress = resolveComponent('UProgress')
const UBadge = resolveComponent('UBadge')

interface ContributorReportItem {
  person_id: number
  person_name: string
  person_email: string
  department_name: string
  is_active: number
  total_commits: number
  files_added: number
  workload: number
  code_workload?: number
  lines_added: number
  lines_deleted: number
  lines_modified: number
  net_lines_added: number
  net_files_added: number
  daily_avg_lines: number
  submission_quality: number
  code_quality: number
  days: number
  first_commit_day: string
  last_commit_day: string
  periodWorkingDays: number
  total_lines_changed?: number
}

const { data: departmentsData } = await useFetch<{ data: { id: number, name: string }[] }>(`${apiBase}/departments`)
const departments = computed(() => departmentsData.value?.data || [])
const period = ref('year')
const { year } = usePersistedYear()

onMounted(() => {
  const stateYear = import.meta.client ? history.state?.year : undefined
  if (stateYear !== undefined && stateYear !== null) {
    period.value = stateYear == 0 ? 'all_time' : 'year'
    year.value = Number.parseInt(stateYear as string) || year.value
  }
})

const departmentId = ref('all')
const isActive = ref('1')

const { data: rawContributors, pending, refresh } = await useFetch<ContributorReportItem[]>(`${apiBase}/reports/contributors`, {
  key: 'contributors-report',
  query: computed(() => ({
    period: period.value,
    year: year.value,
    departmentId: departmentId.value,
    isActive: isActive.value
  }))
})

const contributors = computed(() => {
  if (!rawContributors.value) return []
  return rawContributors.value.map((c) => {
    const code_workload = Math.round(
      (Number(c.lines_added) || 0)
      + (Number(c.lines_deleted) || 0) * 0.5
      + (Number(c.lines_modified) || 0) * 1.3
    )
    const effective_days = c.days > 0 ? c.days : 1
    return {
      ...c,
      code_workload,
      daily_avg_lines: Math.round(code_workload / effective_days)
    }
  })
})

const periodWorkingDays = ref(0)

watch(contributors, () => {
  if (contributors.value && contributors.value.length > 0) {
    periodWorkingDays.value = contributors.value[0]?.periodWorkingDays || 0
  }
})

const columns: TableColumn<ContributorReportItem>[] = [
  {
    accessorKey: 'rank',
    header: '排名',
    cell: ({ row, table }) => {
      const sortedRows = table.getSortedRowModel().rows
      const index = sortedRows.findIndex(r => r.id === row.id)
      const sorting = table.getState().sorting
      const isAsc = sorting.length > 0 && !sorting[0]?.desc
      const rank = isAsc ? sortedRows.length - index : index + 1
      let colorClass = 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
      let content = String(rank)
      if (rank === 1) {
        colorClass = 'bg-yellow-100 text-yellow-600 dark:bg-yellow-500/10 dark:text-yellow-400'
        content = '🥇'
      } else if (rank === 2) {
        colorClass = 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400'
        content = '🥈'
      } else if (rank === 3) {
        colorClass = 'bg-orange-100 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400'
        content = '🥉'
      }
      return h('div', { class: 'flex items-center gap-2' }, [
        h('div', {
          class: `w-8 h-8 flex items-center justify-center rounded-full text-sm font-semibold ${colorClass}`
        }, content)
      ])
    }
  },
  {
    accessorKey: 'person_name',
    header: () => h(UButton, { color: 'neutral', variant: 'ghost', label: '姓名' }),
    cell: ({ row }) => {
      const isActiveVal = row.original.is_active
      return h('button', {
        class: `text-left ${isActiveVal ? '' : 'text-gray-400'} hover:underline focus:outline-none`,
        onClick: () => openCommitModalFromRow(row.original)
      }, row.getValue('person_name'))
    }
  },
  {
    accessorKey: 'department_name',
    header: () => h(UButton, { color: 'neutral', variant: 'ghost', label: '部门' }),
    cell: ({ row }) => h('div', { class: 'text-center' }, row.getValue('department_name'))
  },
  {
    accessorKey: 'days',
    header: ({ column }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '天数',
        class: 'font-semibold flex items-end',
        icon: isSorted ? (isSorted === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => h('div', { class: 'text-center' }, row.getValue('days'))
  },
  {
    accessorKey: 'total_commits',
    header: ({ column }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '提交',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: isSorted ? (isSorted === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => h('div', { class: 'text-center' }, row.getValue('total_commits'))
  },
  {
    accessorKey: 'net_files_added',
    header: ({ column }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '净增文件',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: isSorted ? (isSorted === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => {
      const val = Number(row.getValue('net_files_added'))
      return h('div', { class: 'text-right font-medium' }, val.toLocaleString())
    }
  },
  {
    accessorKey: 'lines_added',
    header: ({ column }) => {
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '新增行',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: column.getIsSorted() ? (column.getIsSorted() === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => {
      const val = Number(row.getValue('lines_added'))
      return h('div', { class: 'text-right font-medium' }, val.toLocaleString())
    }
  },
  {
    accessorKey: 'lines_deleted',
    header: ({ column }) => {
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '删除行',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: column.getIsSorted() ? (column.getIsSorted() === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => {
      const val = Number(row.getValue('lines_deleted'))
      return h('div', { class: 'text-right font-medium' }, val.toLocaleString())
    }
  },
  {
    accessorKey: 'lines_modified',
    header: ({ column }) => {
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '修改行',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: column.getIsSorted() ? (column.getIsSorted() === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => {
      const val = Number(row.getValue('lines_modified'))
      return h('div', { class: 'text-right font-medium' }, val.toLocaleString())
    }
  },
  {
    accessorKey: 'net_lines_added',
    header: ({ column }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '净增行',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: isSorted ? (isSorted === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => {
      const val = Number(row.getValue('net_lines_added'))
      return h('div', { class: 'text-right font-medium' }, val.toLocaleString())
    }
  },
  {
    accessorKey: 'code_workload',
    header: ({ column }) => {
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '代码工作量',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: column.getIsSorted() ? (column.getIsSorted() === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => {
      const workload = Number(row.getValue('code_workload'))
      return h('div', { class: 'text-right font-medium' }, workload.toLocaleString())
    }
  },
  {
    accessorKey: 'workload',
    header: ({ column }) => {
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '调整工作量',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: column.getIsSorted() ? (column.getIsSorted() === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => {
      const workload = Number.parseFloat(row.getValue('workload'))
      return h('div', { class: 'text-right font-medium' }, workload.toLocaleString())
    }
  },
  {
    accessorKey: 'daily_avg_lines',
    header: ({ column }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral', variant: 'ghost', label: '日均工作量',
        class: `font-semibold flex items-end ${column.getIsSorted() ? 'text-primary' : ''}`,
        icon: isSorted ? (isSorted === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
        onClick: () => column.toggleSorting(column.getIsSorted() !== 'desc')
      })
    },
    cell: ({ row }) => {
      const value = Number(row.getValue('daily_avg_lines'))
      return h('div', { class: 'text-right' }, value.toLocaleString())
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

// commit modal state
const commitModalOpen = ref(false)
const commitModalPersonId = ref<number | null>(null)
const commitModalUsername = ref<string | null>(null)

function openCommitModalFromRow(row: ContributorReportItem) {
  commitModalPersonId.value = row.person_id
  commitModalUsername.value = row.person_name
  commitModalOpen.value = true
}

const periodOptions = [
  { label: '当月', value: 'current_month' },
  { label: '上月', value: 'last_month' },
  { label: '年度', value: 'year' },
  { label: '全部', value: 'all_time' }
]

function periodChanged(value: string) {
  period.value = value
  if (value === 'year') {
    year.value = new Date().getFullYear()
  } else {
    year.value = 0
  }
}

const statusOptions = [
  { label: '有效', value: '1' },
  { label: '全部', value: 'all' }
]

const departmentOptions = computed(() => {
  const opts = departments.value.map(d => ({ label: d.name, value: String(d.id) }))
  return [{ label: '所有部门', value: 'all' }, ...opts]
})

const sorting = ref([{ id: 'workload', desc: true }])

const computedDateRange = computed(() => {
  const now = new Date()
  let start = '' as string | undefined
  let end = '' as string | undefined

  if (period.value === 'current_month') {
    const y = now.getFullYear()
    const m = now.getMonth()
    const firstDay = new Date(y, m, 1)
    const lastDay = new Date(y, m + 1, 0)
    start = new Date(firstDay.getTime() - firstDay.getTimezoneOffset() * 60000).toISOString().split('T')[0]
    end = new Date(lastDay.getTime() - lastDay.getTimezoneOffset() * 60000).toISOString().split('T')[0]
  } else if (period.value === 'last_month') {
    const y = now.getFullYear()
    const m = now.getMonth() - 1
    const firstDay = new Date(y, m, 1)
    const lastDay = new Date(y, m + 1, 0)
    start = new Date(firstDay.getTime() - firstDay.getTimezoneOffset() * 60000).toISOString().split('T')[0]
    end = new Date(lastDay.getTime() - lastDay.getTimezoneOffset() * 60000).toISOString().split('T')[0]
  } else if (period.value === 'year') {
    const y = year.value
    start = `${y}-01-01`
    end = `${y}-12-31`
  }

  return { startDate: start, endDate: end }
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel :ui="{ body: 'gap-1 sm:p-3' }">
      <template #header>
        <UDashboardNavbar
          title="贡献者报表"
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
              <span class="text-sm text-gray-600 dark:text-gray-400">时间范围:</span>
              <USelect
                v-model="period"
                :items="periodOptions"
                value-key="value"
                label-key="label"
                size="sm"
                class="min-w-[120px]"
                @update:model-value="periodChanged"
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
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-600 dark:text-gray-400">部门:</span>
              <USelect
                v-model="departmentId"
                :items="departmentOptions"
                value-key="value"
                label-key="label"
                size="sm"
                class="min-w-[120px]"
              />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-600 dark:text-gray-400">状态:</span>
              <USelect
                v-model="isActive"
                :items="statusOptions"
                value-key="value"
                label-key="label"
                size="sm"
                class="min-w-[100px]"
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
              v-if="contributors?.length"
              variant="soft"
              color="neutral"
            >
              {{ contributors?.length + '人' }}
            </UBadge>
          </template>
        </UDashboardToolbar>
      </template>

      <template #body>
        <UCard
          v-if="contributors !== null"
          :ui="{ body: 'p-0' }"
        >
          <UTable
            v-if="contributors"
            v-model:sorting="sorting"
            :ui="{ td: 'p-2' }"
            :columns="columns"
            :data="contributors"
            :loading="pending"
            sticky
            class="h-[calc(100vh-170px)] pt-0 w-full"
          />

          <div
            v-if="!pending && (!contributors || contributors.length === 0)"
            class="py-10 text-center text-sm text-muted-500"
          >
            暂无数据
          </div>

          <div
            v-if="!pending && contributors && contributors.length > 0"
            class="px-4 py-2 text-center text-xs text-muted-500 border-t border-gray-100 dark:border-gray-800"
          >
            共 {{ contributors.length }} 位贡献者
          </div>
        </UCard>
      </template>
    </UDashboardPanel>

    <RepoinsightCommitViewModal
      v-model="commitModalOpen"
      :person-id="commitModalPersonId ?? 0"
      :username="commitModalUsername"
      :limit="10"
      :start-date="computedDateRange.startDate"
      :end-date="computedDateRange.endDate"
    />
  </div>
</template>
