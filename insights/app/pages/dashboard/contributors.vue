<script setup lang="ts">
const { apiBase } = useApiBase()

const sortBy = ref<'total_loc' | 'last_commit'>('total_loc')
const selectedId = ref<string | null>(null)
const selectedType = ref<'global' | 'department' | 'person'>('global')
const rankSortBy = ref<'total_loc' | 'daily_avg'>('total_loc')

// Fetch Tree Data
const { data: treeData, pending: treePending } = await useFetch(`${apiBase}/dashboard/contributors/tree`, {
  query: computed(() => ({ sortBy: sortBy.value }))
})

// Fetch Global/Dept Data
const { data: statsData } = await useFetch(`${apiBase}/dashboard/contributors/stats`, {
  query: computed(() => ({ deptId: selectedType.value === 'department' ? selectedId.value : null })),
  immediate: true,
  watch: [selectedType, selectedId]
})

const { data: trendData } = await useFetch<{ date: string, value: number }[]>(`${apiBase}/dashboard/contributors/trend`, {
  query: computed(() => ({ deptId: selectedType.value === 'department' ? selectedId.value : null })),
  immediate: true,
  watch: [selectedType, selectedId]
})

const { data: rankingData } = await useFetch(`${apiBase}/dashboard/contributors/ranking`, {
  query: computed(() => ({
    deptId: selectedType.value === 'department' ? selectedId.value : null,
    sortBy: rankSortBy.value
  })),
  immediate: true,
  watch: [selectedType, selectedId, rankSortBy]
})

// Fetch Person Data
const personId = computed(() => selectedType.value === 'person' ? selectedId.value : null)

const { data: personStats } = await useFetch(computed(() =>
  personId.value ? `${apiBase}/dashboard/contributors/${personId.value}/stats` : null
) as any, {
  immediate: true,
  watch: [personId]
})

const { data: personTrend } = await useFetch<{ date: string, repoCount: number, locChanged: number }[]>(computed(() =>
  personId.value ? `${apiBase}/dashboard/contributors/${personId.value}/trend` : null
) as any, {
  immediate: true,
  watch: [personId]
})

interface DistributionData {
  repos: { name: string, value: number }[]
  languages: { name: string, value: number }[]
}

const { data: personDistribution } = await useFetch<DistributionData>(computed(() =>
  personId.value ? `${apiBase}/dashboard/contributors/${personId.value}/distribution` : null
) as any, {
  immediate: true,
  watch: [personId]
})

// Selection Handler
const selectItem = (type: 'department' | 'person', id: number) => {
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
    (newVal as any[]).forEach((d: any) => expandedDepts.value.add(d.id))
  }
}, { immediate: true })
</script>

<template>
  <UDashboardPanel :ui="{ body: 'flex-1 min-h-0 sm:p-1 flex flex-row overflow-hidden' }">
    <template #header>
      <UDashboardNavbar title="贡献者看板">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Sidebar (Tree) -->
      <div class="w-48 border-r border-gray-200 dark:border-gray-800 flex flex-col">
        <!-- Toolbar -->
        <div class="p-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
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
        <div class="flex-1 overflow-y-auto pt-2 space-y-1">
          <UButton
            block
            variant="ghost"
            :class="{ 'bg-gray-100 dark:bg-gray-800': selectedType === 'global' }"
            color="secondary"
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
            v-for="dept in (treeData as any[])"
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

            <!-- Persons -->
            <div
              v-if="expandedDepts.has(dept.id)"
              class="ml-6 border-l border-gray-200 dark:border-gray-800 pl-2 mt-1 space-y-0.5"
            >
              <div
                v-for="person in dept.children"
                :key="person.id"
                class="flex items-center cursor-pointer p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
                :class="{ 'bg-primary-50 dark:bg-primary-900/10 text-primary-600': selectedType === 'person' && selectedId === String(person.id) }"
                @click="selectItem('person', person.id)"
              >
                <UIcon
                  name="i-lucide-user"
                  class="w-3 h-3 mr-2 text-gray-400"
                />
                <span class="truncate">{{ person.label }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content Area -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-y-auto p-2 space-y-2">
          <!-- Global / Department View -->
          <div v-if="selectedType === 'global' || selectedType === 'department'">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-bold">
                {{ selectedType === 'global' ? '全局概览' : (treeData as any[])?.find(d => String(d.id)
                  === selectedId)?.label }}
              </h2>
            </div>

            <!-- Stats Cards -->
            <div class="grid grid-cols-6 gap-4 mb-6">
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  贡献者总数
                </div>
                <div class="text-2xl font-bold text-secondary">
                  {{ (statsData as any)?.totalContributors
                    || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  程序员数
                </div>
                <div class="text-2xl font-bold text-secondary">
                  {{ (statsData as any)?.totalProgrammers
                    || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  总仓库数
                </div>
                <div class="text-2xl font-bold text-primary">
                  {{ (statsData as any)?.totalRepos || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  活跃仓库数
                </div>
                <div class="text-2xl font-bold rounded px-1 text-primary">
                  {{ (statsData as
                    any)?.activeRepos || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  总代码行数
                </div>
                <div class="text-2xl font-bold text-success">
                  {{ (statsData as
                    any)?.totalLoc?.toLocaleString() || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  人均代码行数
                </div>
                <div class="text-2xl font-bold text-success">
                  {{ (statsData as
                    any)?.avgLoc?.toLocaleString() || 0 }}
                </div>
              </UCard>
            </div>

            <!-- Trend Chart -->
            <UCard class="mb-6">
              <template #header>
                <div class="text-sm font-semibold">
                  贡献者趋势 (活跃人数)
                </div>
              </template>
              <div class="h-64">
                <RepoinsightContributorTrendChart
                  v-if="trendData"
                  :data="trendData"
                />
              </div>
            </UCard>

            <!-- Ranking Chart -->
            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <div class="text-sm font-semibold">
                    贡献者排行
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
                      :variant="rankSortBy === 'daily_avg' ? 'solid' : 'ghost'"
                      label="日均代码行数"
                      @click="rankSortBy = 'daily_avg'"
                    />
                  </div>
                </div>
              </template>
              <div class="h-80 overflow-x-auto">
                <div class="min-w-[600px] h-full">
                  <RepoinsightContributorRankChart
                    v-if="rankingData"
                    :data="rankingData as any"
                    :sort-by="rankSortBy"
                  />
                </div>
              </div>
            </UCard>
          </div>

          <!-- Person View -->
          <div v-else-if="selectedType === 'person'">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-bold">
                {{ (personStats as any)?.name || 'Loading...' }}
              </h2>
            </div>

            <!-- Person Stats Cards -->
            <div class="grid grid-cols-6 gap-4 mb-6">
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  入职天数
                </div>
                <div class="text-2xl font-bold text-secondary">
                  {{ (personStats as any)?.days_in_service
                    || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  参与仓库数
                </div>
                <div class="text-2xl font-bold text-secondary">
                  {{ (personStats as any)?.repo_count || 0
                  }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  加权行数
                </div>
                <div class="flex items-center justify-between ">
                  <div class="text-2xl font-bold text-primary">
                    {{
                      (personStats as any)?.workload?.toLocaleString() || 0 }}
                  </div>
                  <UBadge
                    v-if="(personStats as any)?.workloadRank"
                    size="xs"
                    variant="soft"
                    color="neutral"
                  >
                    排名: {{
                      (personStats as any)?.workloadRank }}
                  </UBadge>
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  日均代码行数
                </div>
                <div class="flex items-center justify-between ">
                  <div class="text-2xl font-bold text-primary">
                    {{
                      Math.round(((personStats as any)?.workload || 0) / ((personStats as
                        any)?.days_in_service
                        || 1)).toLocaleString() }}
                  </div>
                  <UBadge
                    v-if="(personStats as any)?.dailyAvgRank"
                    size="xs"
                    variant="soft"
                    color="neutral"
                  >
                    排名: {{
                      (personStats as any)?.dailyAvgRank }}
                  </UBadge>
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  代码贡献量
                </div>
                <div class="text-2xl font-bold text-success">
                  {{
                    (personStats as any)?.net_lines_added?.toLocaleString() || 0 }}
                </div>
              </UCard>
              <UCard :ui="{ body: 'p-3 sm:p-4' }">
                <div class="text-sm text-gray-500">
                  提交质量
                </div>
                <div class="text-2xl font-bold text-success">
                  {{
                    (personStats as any)?.commitQuality != null ? Number((personStats as
                      any).commitQuality).toFixed(0)
                    : '-' }}%
                </div>
              </UCard>
            </div>

            <!-- Trend Chart -->
            <UCard class="mb-6">
              <template #header>
                <div class="text-sm font-semibold">
                  月度活跃趋势
                </div>
              </template>
              <div class="h-64">
                <RepoinsightContributorDualTrendChart
                  v-if="personTrend && Array.isArray(personTrend) && personTrend.length"
                  :data="personTrend"
                />
              </div>
            </UCard>

            <!-- Bottom Row: Distribution & Heatmap -->
            <div class="flex flex-col lg:flex-row gap-4">
              <!-- Pie Charts -->
              <div class="w-full lg:w-2/5 flex gap-4">
                <UCard class="flex-1">
                  <template #header>
                    <div class="text-sm font-semibold">
                      仓库贡献分布
                    </div>
                  </template>
                  <div class="h-52">
                    <RepoinsightSimplePieChart
                      v-if="personDistribution?.repos"
                      :data="personDistribution.repos"
                    />
                  </div>
                </UCard>
                <UCard class="flex-1">
                  <template #header>
                    <div class="text-sm font-semibold">
                      语言分布（文件数）
                    </div>
                  </template>
                  <div class="h-52">
                    <RepoinsightSimplePieChart
                      v-if="personDistribution?.languages"
                      :data="personDistribution.languages"
                    />
                  </div>
                </UCard>
              </div>

              <!-- Heatmap -->
              <div class="w-full lg:w-3/5">
                <RepoinsightPersonContributionHeatmap
                  v-if="selectedId"
                  :person-id="Number(selectedId)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
