<script setup lang="ts">
const { apiBase } = useApiBase()

const sortBy = ref<'total_loc' | 'last_commit'>('last_commit')
const selectedId = ref<string | null>(null)
const selectedType = ref<'global' | 'department' | 'repo'>('global')
const rankSortBy = ref<'total_loc' | 'commits'>('total_loc')

interface TreeRepo {
  id: number
  label: string
  type: 'repo'
  total_loc: number
  last_commit: string | null
}

interface TreeDept {
  id: number
  label: string
  children: TreeRepo[]
  type: 'department'
}

// Fetch Tree Data
const { data: treeData, pending: treePending } = await useFetch<TreeDept[]>(`${apiBase}/dashboard/repos/tree`, {
  query: computed(() => ({ sortBy: sortBy.value }))
})

interface StatsData {
  totalRepos: number
  activeRepos: number
  totalCommits: number
  totalLoc: number
  avgLoc: number
  activeThreshold?: number
}

// Fetch Global/Dept Data
const { data: statsData } = await useFetch<StatsData>(`${apiBase}/dashboard/repos/stats`, {
  query: computed(() => ({ deptId: selectedType.value === 'department' ? selectedId.value : null })),
  immediate: true,
  watch: [selectedType, selectedId]
})

interface TrendItem {
  date: string
  commits: number
  locChanged: number
  contributors?: number
  activeRepos?: number
}

const { data: trendData } = await useFetch<TrendItem[]>(`${apiBase}/dashboard/repos/trend`, {
  query: computed(() => ({ deptId: selectedType.value === 'department' ? selectedId.value : null })),
  immediate: true,
  watch: [selectedType, selectedId]
})

interface RankingItem {
  id: number
  rank: number
  name: string
  deptName: string
  totalLoc: number
  commits: number
  lastCommit: string | null
}

const { data: rankingData } = await useFetch<RankingItem[]>(`${apiBase}/dashboard/repos/ranking`, {
  query: computed(() => ({
    deptId: selectedType.value === 'department' ? selectedId.value : null,
    sortBy: rankSortBy.value
  })),
  immediate: true,
  watch: [selectedType, selectedId, rankSortBy]
})

// Fetch Single Repo Data
const repoId = computed(() => selectedType.value === 'repo' ? selectedId.value : null)

interface RepoStats {
  id: number
  name: string
  description: string
  createdAt: string | null
  deptName: string
  totalLoc: number
  totalCommits: number
  totalContributors: number
  totalFiles: number
}

const { data: repoStats } = await useFetch<RepoStats>(computed(() =>
  repoId.value ? `${apiBase}/dashboard/repos/${repoId.value}/stats` : null
) as any, {
  immediate: true,
  watch: [repoId]
})

const { data: repoTrend } = await useFetch<TrendItem[]>(computed(() =>
  repoId.value ? `${apiBase}/dashboard/repos/${repoId.value}/trend` : null
) as any, {
  immediate: true,
  watch: [repoId]
})

interface ContributorItem {
  rank: number
  name: string
  commits: number
  loc: number
}

const { data: repoContributors, pending: repoContributorsPending } = await useFetch<ContributorItem[]>(computed(() =>
  repoId.value ? `${apiBase}/dashboard/repos/${repoId.value}/contributors` : null
) as any, {
  immediate: true,
  watch: [repoId]
})

interface DistributionData {
  languages: { name: string, value: number }[]
}

const { data: repoDistribution } = await useFetch<DistributionData>(computed(() =>
  repoId.value ? `${apiBase}/dashboard/repos/${repoId.value}/distribution` : null
) as any, {
  immediate: true,
  watch: [repoId]
})

// Selection Handler
const selectItem = (type: 'department' | 'repo', id: number) => {
  selectedType.value = type
  selectedId.value = String(id)
}

const selectGlobal = () => {
  selectedType.value = 'global'
  selectedId.value = null
}

// Expand/Collapse state
const expandedDepts = ref<Set<number>>(new Set())
const toggleDept = (deptId: number) => {
  if (expandedDepts.value.has(deptId)) {
    expandedDepts.value.delete(deptId)
  } else {
    expandedDepts.value.add(deptId)
  }
}

// Auto-expand all on load
watch(treeData, (newVal) => {
  if (newVal) {
    newVal.forEach((d: any) => expandedDepts.value.add(d.id))
  }
}, { immediate: true })
</script>

<template>
  <UDashboardPanel :ui="{ body: 'flex-1 min-h-0 p-0 flex flex-row overflow-hidden' }">
    <template #header>
      <UDashboardNavbar title="仓库看板">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Sidebar (Tree) -->
      <div class="w-48 border-r flex flex-col">
        <!-- Toolbar -->
        <div class="p-2 border-b flex items-center justify-between">
          <span class="text-xs font-semibold text-gray-500">排序方式</span>
          <div class="flex gap-1">
            <UTooltip text="按代码行数">
              <UButton
                icon="i-lucide-bar-chart-2"
                :variant="sortBy === 'total_loc' ? 'solid' : 'ghost'"
                size="xs"
                @click="sortBy = 'total_loc'"
              />
            </UTooltip>
            <UTooltip text="按最近提交">
              <UButton
                icon="i-lucide-clock"
                :variant="sortBy === 'last_commit' ? 'solid' : 'ghost'"
                size="xs"
                @click="sortBy = 'last_commit'"
              />
            </UTooltip>
          </div>
        </div>

        <!-- Tree List -->
        <div class="flex-1 overflow-y-auto p-2 space-y-1">
          <UButton
            block
            variant="ghost"
            color="secondary"
            :class="{ 'bg-gray-100 dark:bg-gray-800': selectedType === 'global' }"
            label="全局概览"
            icon="i-lucide-globe"
            @click="selectGlobal"
          />

          <div
            v-if="treePending"
            class="p-4 flex justify-center"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="animate-spin text-gray-400"
            />
          </div>

          <div
            v-for="dept in treeData"
            v-else
            :key="dept.id"
          >
            <!-- Dept Header -->
            <div class="flex items-center group">
              <UButton
                :icon="expandedDepts.has(dept.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                variant="ghost"
                color="neutral"
                size="xs"
                class="p-1"
                @click="toggleDept(dept.id)"
              />
              <div
                class="flex-1 flex items-center cursor-pointer p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                :class="{ 'bg-gray-100 dark:bg-gray-800': selectedType === 'department' && selectedId === String(dept.id) }"
                @click="selectItem('department', dept.id)"
              >
                <UIcon
                  name="i-lucide-building-2"
                  class="w-4 h-4 mr-2 text-gray-500"
                />
                <span class="text-sm truncate">{{ dept.label }}</span>
                <span class="ml-auto text-xs text-gray-400">{{ dept.children.length }}</span>
              </div>
            </div>

            <!-- Repos -->
            <div
              v-if="expandedDepts.has(dept.id)"
              class="ml-3 border-l border-gray-200 dark:border-gray-800 pl-2 mt-1 space-y-0.5"
            >
              <div
                v-for="repo in dept.children"
                :key="repo.id"
                class="flex items-center cursor-pointer p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
                :class="{ 'bg-primary-50 dark:bg-primary-900/10 text-primary-500': selectedType === 'repo' && selectedId === String(repo.id) }"
                @click="selectItem('repo', repo.id)"
              >
                <UIcon
                  name="i-lucide-git-branch"
                  class="w-3 h-3 mr-2 text-gray-400"
                />
                <span class="truncate">{{ repo.label }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content Area -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-y-auto p-4 space-y-6">
          <!-- Global / Department View -->
          <div v-if="selectedType === 'global' || selectedType === 'department'">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-bold">
                {{ selectedType === 'global' ? '全局概览' : treeData?.find(d => String(d.id)
                  === selectedId)?.label }}
              </h2>
            </div>

            <!-- Stats Cards -->
            <div class="grid grid-cols-4 gap-4 mb-6">
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  仓库总数
                </div>
                <div class="text-2xl font-bold text-secondary">
                  {{ statsData?.totalRepos || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  活跃仓库数 ({{ statsData?.activeThreshold || 90 }}天)
                </div>
                <div class="text-2xl font-bold text-primary rounded px-1">
                  {{ statsData?.activeRepos || 0
                  }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  总提交数
                </div>
                <div class="text-2xl font-bold text-warning">
                  {{
                    statsData?.totalCommits?.toLocaleString() || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  总代码行数
                </div>
                <div class="text-2xl font-bold text-success">
                  {{ statsData?.totalLoc?.toLocaleString()
                    || 0 }}
                </div>
              </UCard>
            </div>

            <!-- Trend Chart -->
            <UCard class="mb-6">
              <template #header>
                <div class="text-sm font-semibold">
                  仓库活跃趋势 (月度)
                </div>
              </template>
              <div class="h-64">
                <RepoinsightContributorDualTrendChart
                  v-if="Array.isArray(trendData) && trendData.length"
                  :data="trendData.map(d => ({ ...d, repoCount: d.activeRepos ?? 0 }))"
                  label1="活跃仓库数"
                />
                <div
                  v-else
                  class="h-full flex items-center justify-center text-gray-400"
                >
                  暂无数据
                </div>
              </div>
            </UCard>

            <!-- Ranking Chart -->
            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <div class="text-sm font-semibold">
                    仓库排行
                  </div>
                  <div class="flex gap-1">
                    <UButton
                      size="xs"
                      :variant="rankSortBy === 'total_loc' ? 'solid' : 'ghost'"
                      label="总代码行数"
                      @click="rankSortBy = 'total_loc'"
                    />
                    <UButton
                      size="xs"
                      :variant="rankSortBy === 'commits' ? 'solid' : 'ghost'"
                      label="提交数"
                      @click="rankSortBy = 'commits'"
                    />
                  </div>
                </div>
              </template>
              <div class="h-80 overflow-x-auto">
                <div class="min-w-[600px] h-full">
                  <RepoinsightRepoRankChart
                    v-if="Array.isArray(rankingData) && rankingData.length"
                    :data="rankingData"
                    :sort-by="rankSortBy"
                  />
                  <div
                    v-else
                    class="h-full flex items-center justify-center text-gray-400"
                  >
                    暂无数据
                  </div>
                </div>
              </div>
            </UCard>
          </div>

          <!-- Single Repo View -->
          <div v-else-if="selectedType === 'repo'">
            <div class="flex items-center justify-between mb-4">
              <div>
                <div class="text-lg font-bold flex items-center gap-2">
                  {{ repoStats?.name || 'Loading...' }}
                  <UBadge
                    v-if="repoStats?.description"
                    variant="outline"
                    color="secondary"
                  >
                    {{
                      repoStats?.description }}
                  </UBadge>
                </div>
                <div class="text-xs text-gray-500 mt-1">
                  部门: {{ repoStats?.deptName || '-' }} | 创建时间: {{ repoStats?.createdAt ? new
                    Date(repoStats.createdAt).toLocaleDateString() : '-' }}
                </div>
              </div>
              <UButton
                :to="'/repos/' + repoId"
                icon="i-lucide-folder-git-2"
                label="查看详情页"
                size="xs"
                variant="ghost"
              />
            </div>

            <!-- Repo Stats Cards -->
            <div class="grid grid-cols-4 gap-4 mb-6">
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  贡献者数
                </div>
                <div class="text-2xl font-bold text-secondary">
                  {{ repoStats?.totalContributors || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  总提交数
                </div>
                <div class="text-2xl font-bold text-primary">
                  {{
                    repoStats?.totalCommits?.toLocaleString() || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  文件数
                </div>
                <div class="text-2xl font-bold text-warning">
                  {{ repoStats?.totalFiles?.toLocaleString()
                    || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  总代码行数
                </div>
                <div class="text-2xl font-bold text-success">
                  {{ repoStats?.totalLoc?.toLocaleString()
                    || 0 }}
                </div>
              </UCard>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4">
              <!-- Language Distribution -->
              <UCard>
                <template #header>
                  <div class="text-sm font-semibold">
                    语言分布（文件数）
                  </div>
                </template>
                <div class="h-56">
                  <RepoinsightSimplePieChart
                    v-if="repoDistribution?.languages && repoDistribution.languages.length"
                    :data="repoDistribution.languages"
                  />
                  <div
                    v-else
                    class="h-full flex items-center justify-center text-gray-400"
                  >
                    暂无数据
                  </div>
                </div>
              </UCard>

              <!-- Trend Chart -->
              <UCard class="lg:col-span-3">
                <template #header>
                  <div class="text-sm font-semibold">
                    仓库活跃趋势 (月度)
                  </div>
                </template>
                <div class="h-56">
                  <RepoinsightContributorDualTrendChart
                    v-if="Array.isArray(repoTrend) && repoTrend.length"
                    :data="repoTrend.map(d => ({ date: d.date, repoCount: d.contributors ?? 0, locChanged: d.locChanged }))"
                    label1="月活跃人数"
                  />
                  <div
                    v-else
                    class="h-full flex items-center justify-center text-gray-400"
                  >
                    暂无数据
                  </div>
                </div>
              </UCard>
            </div>

            <!-- Charts Row -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div class="lg:col-span-2">
                <RepoinsightRepoContributionHeatmap
                  v-if="repoId"
                  :repo-id="Number(repoId)"
                />
              </div>

              <!-- Contributor Ranking -->
              <UCard class="lg:col-span-1 h-fit">
                <template #header>
                  <div class="text-sm font-semibold">
                    贡献者排行 (Top 20)
                  </div>
                </template>
                <div class="h-52 overflow-y-auto">
                  <table class="w-full text-sm text-left">
                    <thead class="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 sticky top-0">
                      <tr>
                        <th class="px-2 py-1">
                          排名
                        </th>
                        <th class="px-2 py-1">
                          姓名
                        </th>
                        <th class="px-2 py-1 text-right">
                          LOC
                        </th>
                        <th class="px-2 py-1 text-right">
                          提交
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="repoContributorsPending">
                        <td
                          colspan="4"
                          class="px-2 py-4 text-center text-gray-400"
                        >
                          Loading...
                        </td>
                      </tr>
                      <tr v-else-if="!repoContributors || !repoContributors.length">
                        <td
                          colspan="4"
                          class="px-2 py-4 text-center text-gray-400"
                        >
                          暂无数据
                        </td>
                      </tr>
                      <tr
                        v-for="c in repoContributors"
                        v-else
                        :key="c.name"
                        class="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <td class="px-2 py-1.5 font-mono text-xs text-gray-500">
                          #{{ c.rank }}
                        </td>
                        <td
                          class="px-2 py-1.5 font-medium truncate max-w-[100px]"
                          :title="c.name"
                        >
                          {{ c.name }}
                        </td>
                        <td class="px-2 py-1.5 text-right font-mono">
                          {{ c.loc.toLocaleString()
                          }}
                        </td>
                        <td class="px-2 py-1.5 text-right font-mono">
                          {{
                            c.commits.toLocaleString() }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </UCard>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
