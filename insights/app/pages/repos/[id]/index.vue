<script setup lang="ts">
const route = useRoute()
const { apiBase } = useApiBase()
const repoId = route.params.id as string
const toast = useToast()

interface RepoDetail {
  id: number
  name: string
  description?: string
  departmentId?: number
  departmentName?: string
  sourceType: string
  sourceName?: string
  totalCommits: number
  currentYearCommits: number
  latestCommitAt?: string
  repoCreatedAt?: string
  isValid: boolean
}

interface RepoStats {
  totalCommits: number
  currentYearCommits: number
  totalContributors: number
  totalFiles: number
  totalLinesAdded: number
}

const { data: repo, pending: repoLoading } = await useFetch<RepoDetail>(`${apiBase}/repos/${repoId}`)
const { data: stats } = await useFetch<RepoStats>(`${apiBase}/repos/${repoId}/stats`)

const { data: trendData } = await useFetch<any[]>(`${apiBase}/repos/${repoId}/trend`)
const { data: contributorsData } = await useFetch<any[]>(`${apiBase}/repos/${repoId}/contributors`)

const formatDate = (dateStr?: string | null) => {
  if (!dateStr) return '-'
  return dateStr.replace('T', ' ').substring(0, 16)
}

const formatNumber = (val?: number | null) => val == null ? '-' : new Intl.NumberFormat('en-US').format(val)
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar :title="repo?.name || '仓库详情'">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <UButton
          :to="`/repos/${repoId}/visualization`"
          icon="i-lucide-network"
          label="可视化"
          size="sm"
          variant="soft"
        />
        <UButton
          to="/repos"
          icon="i-lucide-arrow-left"
          label="返回"
          size="sm"
          variant="ghost"
        />
      </template>
    </UDashboardNavbar>

    <div
      v-if="repoLoading"
      class="flex items-center justify-center h-64"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="animate-spin text-2xl text-muted-400"
      />
    </div>

    <div
      v-else-if="repo"
      class="p-4 space-y-4"
    >
      <!-- Basic Info -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">
              基本信息
            </h3>
            <UBadge
              :color="repo.isValid ? 'success' : 'neutral'"
              variant="soft"
            >
              {{ repo.isValid ? '有效'
                : '无效' }}
            </UBadge>
          </div>
        </template>
        <div class="grid grid-cols-4 gap-4">
          <div>
            <span class="text-sm text-muted-500">仓库ID</span>
            <p class="font-medium">
              {{ repo.id }}
            </p>
          </div>
          <div>
            <span class="text-sm text-muted-500">仓库名称</span>
            <p class="font-medium">
              {{ repo.name }}
            </p>
          </div>
          <div>
            <span class="text-sm text-muted-500">所属部门</span>
            <p class="font-medium">
              {{ repo.departmentName || '未分配' }}
            </p>
          </div>
          <div>
            <span class="text-sm text-muted-500">数据来源</span>
            <p class="font-medium">
              {{ repo.sourceName || repo.sourceType }}
            </p>
          </div>
          <div>
            <span class="text-sm text-muted-500">创建时间</span>
            <p class="font-medium text-sm">
              {{ formatDate(repo.repoCreatedAt) }}
            </p>
          </div>
          <div>
            <span class="text-sm text-muted-500">最新提交</span>
            <p class="font-medium text-sm">
              {{ formatDate(repo.latestCommitAt) }}
            </p>
          </div>
        </div>
      </UCard>

      <!-- Stats Cards -->
      <div class="grid grid-cols-5 gap-4">
        <UCard :ui="{ body: 'p-4' }">
          <div class="text-sm text-muted-500">
            总提交数
          </div>
          <div class="text-2xl font-bold text-primary">
            {{ formatNumber(stats?.totalCommits) }}
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-4' }">
          <div class="text-sm text-muted-500">
            本年提交
          </div>
          <div class="text-2xl font-bold text-secondary">
            {{ formatNumber(stats?.currentYearCommits) }}
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-4' }">
          <div class="text-sm text-muted-500">
            贡献者数
          </div>
          <div class="text-2xl font-bold text-success">
            {{ formatNumber(stats?.totalContributors) }}
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-4' }">
          <div class="text-sm text-muted-500">
            文件总数
          </div>
          <div class="text-2xl font-bold text-info">
            {{ formatNumber(stats?.totalFiles) }}
          </div>
        </UCard>
        <UCard :ui="{ body: 'p-4' }">
          <div class="text-sm text-muted-500">
            代码行数
          </div>
          <div class="text-2xl font-bold text-warning">
            {{ formatNumber(stats?.totalLinesAdded) }}
          </div>
        </UCard>
      </div>

      <!-- Trend Chart -->
      <UCard v-if="trendData">
        <template #header>
          <h3 class="font-semibold">
            活跃趋势
          </h3>
        </template>
        <div class="h-64">
          <RepoinsightContributorDualTrendChart :data="trendData" />
        </div>
      </UCard>

      <!-- Contributors -->
      <UCard v-if="contributorsData">
        <template #header>
          <h3 class="font-semibold">
            贡献者列表 ({{ contributorsData.length }})
          </h3>
        </template>
        <div class="max-h-64 overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th class="px-3 py-2 text-left">
                  姓名
                </th>
                <th class="px-3 py-2 text-center">
                  提交数
                </th>
                <th class="px-3 py-2 text-center">
                  代码行数
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in contributorsData"
                :key="c.personId"
                class="border-b border-gray-100 dark:border-gray-800"
              >
                <td class="px-3 py-2">
                  {{ c.personName || c.username }}
                </td>
                <td class="px-3 py-2 text-center">
                  {{ c.totalCommits }}
                </td>
                <td class="px-3 py-2 text-center">
                  {{ formatNumber(c.linesAdded) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>

    <div
      v-else
      class="flex items-center justify-center h-64 text-muted-500"
    >
      仓库不存在
    </div>
  </UDashboardPanel>
</template>
