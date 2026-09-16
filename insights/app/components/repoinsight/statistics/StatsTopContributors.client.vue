<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'

const router = useRouter()
const { apiBase } = useApiBase()

interface PersonStats {
  person_id: number
  person_name: string
  person_email: string
  department_name: string
  total_commits: number
  files_added: number
  workload: number
  net_lines_added: number
  total_lines_changed: number
  repo_count: number
}

const props = defineProps<{
  year: number | null
  limit?: number
}>()

const UBadge = resolveComponent('UBadge')
// const UAvatar = resolveComponent('UAvatar')

const personStats = ref<PersonStats[]>([])
const pending = ref(false)

async function loadPersonStats() {
  pending.value = true
  try {
    console.log('[StatsTopContributors] Loading data for year:', props.year)
    personStats.value = await $fetch<PersonStats[]>(`${apiBase}/statistics/person-ranking`, {
      query: {
        year: props.year ?? 0,
        limit: props.limit || 10
      }
    })
  } catch (error) {
    console.error('[StatsTopContributors] Failed to load data:', error)
    personStats.value = []
  } finally {
    pending.value = false
  }
}

watch(() => [props.year, props.limit], () => {
  console.log('[StatsTopContributors] Props changed, reloading...')
  loadPersonStats()
})

function navigateToReport() {
  router.push({ path: '/reports/contributors', state: { year: props.year } })
}

onMounted(() => {
  loadPersonStats()
})

const columns: TableColumn<PersonStats>[] = [
  {
    accessorKey: 'rank',
    header: '排名',
    cell: ({ row }) => {
      const rank = row.index + 1
      const colors = ['success', 'warning', 'error'] as const
      const color = rank <= 3 ? colors[rank - 1] : 'neutral'

      return h('div', { class: 'flex items-center pl-2 gap-0' }, [
        h(UBadge, {
          color,
          variant: 'subtle',
          class: 'w-6 h-6 flex items-center justify-center rounded-full text-sm font-semibold'
        }, () => rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank)
      ])
    }
  },
  {
    accessorKey: 'person_name',
    header: '贡献者',
    cell: ({ row }) => {
      const name = (row.getValue('person_name') as string) || '未知'
      // const email = row.original.person_email
      // const initial = name ? name[0]?.toUpperCase() : '?'

      return h('div', { class: 'flex items-center gap-3' }, [
        // h(UAvatar, {
        //   text: initial,
        //   size: 'sm'
        // }),
        h('div', { class: 'flex flex-col' }, [
          h('span', { class: 'font-medium' }, name || '未知')
          // h('span', { class: 'text-xs text-muted' }, email || '-')
        ])
      ])
    }
  },
  {
    accessorKey: 'department_name',
    header: '部门',
    cell: ({ row }) => {
      const dept = row.getValue('department_name') as string
      return h('div', {
        class: 'text-xs'
      }, dept || '未分配')
    }
  },
  {
    accessorKey: 'repo_count',
    header: () => h('div', { class: 'text-right' }, '仓库'),
    cell: ({ row }) => {
      const value = row.getValue('repo_count') as number
      return h('div', { class: 'text-right font-mono' }, value)
    }
  },

  {
    accessorKey: 'total_commits',
    header: () => h('div', { class: 'text-right' }, '提交'),
    cell: ({ row }) => {
      const value = row.getValue('total_commits') as number
      return h('div', { class: 'text-right font-mono' }, value.toLocaleString('zh-CN'))
    }
  },
  {
    accessorKey: 'files_added',
    header: () => h('div', { class: 'text-right' }, '文件'),
    cell: ({ row }) => {
      const value = row.getValue('files_added') as number
      return h('div', { class: 'text-right font-mono' }, value)
    }
  },
  {
    accessorKey: 'net_lines_added',
    header: () => h('div', { class: 'text-right' }, '净增行数'),
    cell: ({ row }) => {
      const value = row.getValue('net_lines_added') as number
      return h('div', { class: 'text-right text-primary font-mono' }, `${value.toLocaleString('zh-CN')}`)
    }
  },
  {
    accessorKey: 'workload',
    header: () => h('div', { class: 'text-right' }, '加权行数'),
    cell: ({ row }) => {
      const value = row.getValue('workload') as number
      return h('div', { class: 'text-right text-info font-mono' }, `${value.toLocaleString('zh-CN')}`)
    }
  },
  {
    accessorKey: 'total_lines_changed',
    header: () => h('div', { class: 'text-right' }, 'Churn'),
    cell: ({ row }) => {
      const value = row.getValue('total_lines_changed') as number
      return h('div', { class: 'text-right text-info font-mono' }, `${value.toLocaleString('zh-CN')}`)
    }
  }
]
</script>

<template>
  <UCard :ui="{ root: 'overflow-visible !p-0', body: 'sm:p-0', header: 'p-2' }">
    <template #header>
      <div class="flex items-center justify-between">
        <ULink
          color="primary"
          class="text-md text-highlighted font-semibold pr-2"
          @click="navigateToReport"
        >
          贡献者TOP{{ limit }}
        </ULink>
        <div class="flex flex-wrap items-center gap-3 text-xs">
          <UBadge
            v-if="year"
            color="primary"
            variant="subtle"
          >
            {{ year }} 年
          </UBadge>
        </div>
        <!-- <NuxtLink to="/statistics/contributors" class="text-sm text-primary hover:underline">
          查看全部 →
        </NuxtLink> -->
      </div>
    </template>

    <div
      v-if="pending"
      class="h-90 space-y-3"
    >
      <USkeleton
        v-for="i in 6"
        :key="i"
        class="h-16 w-full"
      />
    </div>

    <UTable
      v-else-if="personStats && personStats.length > 0"
      :ui="{ td: 'p-1' }"
      :data="personStats"
      :columns="columns"
      sticky
      class="flex-1 h-90"
    />

    <div
      v-else
      class="h-90 py-12 text-center text-muted"
    >
      暂无数据
    </div>
  </UCard>
</template>
