<script setup lang="ts">
const { apiBase } = useApiBase()

const { data, pending, refresh } = await useFetch<{ name: string, children: any[], value?: number }>(`${apiBase}/dashboard/departments/treemap`)
</script>

<template>
  <UDashboardPanel :ui="{ body: 'flex-1 min-h-0 p-0' }">
    <template #header>
      <UDashboardNavbar title="部门看板">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="pending"
            @click="() => refresh()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col h-full p-0">
        <div class="flex items-center justify-between mb-2">
          <h2 class="font-semibold">
            各部门仓库代码规模 (LOC)
          </h2>
        </div>

        <div class="flex-1 min-h-0 relative border rounded-lg bg-white dark:bg-gray-900 overflow-hidden">
          <div
            v-if="data && !pending"
            class="w-full h-full relative"
          >
            <ClientOnly>
              <RepoinsightTreemapChart :data="data" />
            </ClientOnly>
          </div>
          <div
            v-else-if="pending"
            class="w-full h-full flex items-center justify-center"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="animate-spin w-8 h-8 text-gray-400"
            />
          </div>
          <div
            v-else
            class="w-full h-full flex items-center justify-center text-gray-500"
          >
            暂无数据
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
