<script setup lang="ts">
import type { TrendRow } from '~/types/repoinsight'

const { apiBase } = useApiBase()

const { year: currentYear } = usePersistedYear()
const yearOptions = ref<{ label: string, value: number }[]>([])
const currentChart = ref<'commits' | 'activity' | 'code'>('commits')

const stats = ref<TrendRow[]>([])
const pending = ref(false)

const isYearly = computed(() => currentYear.value === null || currentYear.value === 0)

async function loadTrendData() {
  pending.value = true
  try {
    if (isYearly.value) {
      console.log('[StatsTrendChart] Loading YEARLY trend data')
      stats.value = await $fetch<TrendRow[]>(`${apiBase}/statistics/trend`)
    } else {
      console.log('[StatsTrendChart] Loading MONTHLY trend data for year:', currentYear.value)
      stats.value = await $fetch<TrendRow[]>(`${apiBase}/statistics/trend`, {
        params: { year: currentYear.value }
      })
    }
  } catch (error) {
    console.error('[StatsTrendChart] Failed to load trend data:', error)
    stats.value = []
  } finally {
    pending.value = false
  }
}

// Initial load
await loadTrendData()

// Watch year changes
watch(() => currentYear.value, () => {
  console.log('[StatsTrendChart] Year changed, reloading trend data')
  loadTrendData()
})

onMounted(async () => {
  const years = await $fetch<number[]>(`${apiBase}/statistics/stat-years`)
  yearOptions.value = [{ label: '全部', value: 0 }, ...years.map(year => ({ label: year.toString() + '年', value: year }))]
})
</script>

<template>
  <UDashboardPanel :ui="{ body: 'sm:gap-3 sm:p-3 m-0' }">
    <template #header>
      <UDashboardNavbar
        title="总览看板"
        :ui="{ root: 'h-12', right: 'gap-1' }"
      >
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <ClientOnly>
            <span class="me-2 text-sm text-muted-foreground flex items-center">选择年份</span>
            <USelectMenu
              v-model="currentYear"
              :items="yearOptions"
              value-key="value"
              class="w-28"
            />
            <template #fallback>
              <USkeleton class="h-8 w-28" />
            </template>
          </ClientOnly>
          <UColorModeButton />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Overall statistics cards -->
      <RepoinsightStatisticsStatsOverview
        :year="currentYear"
        :display-only="false"
        @chart-selected="(type: any) => currentChart = type"
      />

      <!-- Trend chart area -->
      <div class="mt-0 min-h-[396px] relative">
        <Transition
          name="fade"
          mode="out-in"
        >
          <RepoinsightStatisticsStatsCommitsChart
            v-if="currentChart === 'commits'"
            :year="currentYear"
            :stats="stats"
          />
          <RepoinsightStatisticsStatsActivityChart
            v-else-if="currentChart === 'activity'"
            :year="currentYear"
            :stats="stats"
          />
          <RepoinsightStatisticsStatsCodeChart
            v-else-if="currentChart === 'code'"
            :year="currentYear"
            :stats="stats"
          />
        </Transition>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <!-- Active repositories -->
        <RepoinsightStatisticsStatsActiveRepositories
          :year="currentYear"
          :limit="10"
        />
        <!-- Top contributors -->
        <RepoinsightStatisticsStatsTopContributors
          :year="currentYear"
          :limit="20"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
