<script setup lang="ts">
const route = useRoute()
const { apiBase } = useApiBase()
const repoId = route.params.id as string

const { data: repo } = useFetch<{ id: number, name: string }>(`${apiBase}/repos/${repoId}`)
const { data: graphData } = useFetch<any>(`${apiBase}/repos/${repoId}/graph`)
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar :title="`${repo?.name || '仓库'} - 可视化`">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <UButton
          :to="`/repos/${repoId}`"
          icon="i-lucide-arrow-left"
          label="返回详情"
          size="sm"
          variant="ghost"
        />
      </template>
    </UDashboardNavbar>

    <div class="p-4">
      <UCard>
        <template #header>
          <h3 class="font-semibold">
            贡献者关系图
          </h3>
        </template>
        <div class="h-[calc(100vh-200px)]">
          <RepoinsightSankeyChart
            v-if="graphData"
            :data="graphData"
          />
          <div
            v-else
            class="flex items-center justify-center h-full text-muted-500"
          >
            暂无数据
          </div>
        </div>
      </UCard>
    </div>
  </UDashboardPanel>
</template>
