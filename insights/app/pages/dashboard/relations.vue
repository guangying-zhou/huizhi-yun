<script setup lang="ts">
const { apiBase } = useApiBase()

const { year } = usePersistedYear()
const yearOptions = ref<{ label: string, value: number }[]>([])
const repoLimit = ref(20)
const personLimit = ref(50)

interface SankeyData {
  nodes: { id: string, name: string, category: string }[]
  links: { source: string, target: string, value: number }[]
}

const { data, pending, refresh } = await useFetch<SankeyData>(`${apiBase}/dashboard/overview/sankey`, {
  query: computed(() => ({
    year: year.value,
    repoLimit: repoLimit.value,
    personLimit: personLimit.value
  }))
})

onMounted(async () => {
  const years = await $fetch<number[]>(`${apiBase}/statistics/stat-years`)
  yearOptions.value = [{ label: '全部', value: 0 }, ...years.map(year => ({ label: year.toString() + '年', value: year }))]
})
</script>

<template>
  <UDashboardPanel :ui="{ body: 'flex-1 min-h-0 p-0' }">
    <template #header>
      <UDashboardNavbar title="代码贡献总览">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <USelectMenu
            v-model="year"
            :items="yearOptions"
            value-key="value"
            class="w-28"
          />
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
            部门 - 仓库 - 人员贡献流向 (代码行数)
          </h2>
          <div class="flex items-center gap-4 text-sm">
            <div class="flex items-center gap-1">
              <span class="text-gray-500">仓库数</span>
              <UInput
                v-model.number="repoLimit"
                type="number"
                :min="5"
                :max="100"
                class="w-16"
                size="xs"
              />
            </div>
            <div class="flex items-center gap-1">
              <span class="text-gray-500">人员数</span>
              <UInput
                v-model.number="personLimit"
                type="number"
                :min="10"
                :max="200"
                class="w-16"
                size="xs"
              />
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 relative border rounded-lg bg-white dark:bg-gray-900">
          <div
            v-if="data && !pending"
            class="w-full h-full relative"
          >
            <ClientOnly>
              <RepoinsightSankeyChart :data="data" />
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
