<script setup lang="ts">
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'

const items = [
  { icon: 'i-lucide-trending-down', title: '燃尽图' },
  { icon: 'i-lucide-gauge', title: '迭代速度' },
  { icon: 'i-lucide-bug', title: '缺陷趋势' },
  { icon: 'i-lucide-git-commit', title: '代码贡献' }
]
</script>

<template>
  <UDashboardPanel id="enterprise-project-metrics" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar />
        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-4 sm:px-6">
          <section class="space-y-6">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <UCard v-for="item in items" :key="item.title" class="text-center">
                <UIcon :name="item.icon" class="mx-auto size-7 text-primary" />
                <p class="mt-3 font-medium">
                  {{ item.title }}
                </p>
              </UCard>
            </div>
            <CommonEmptyState icon="i-lucide-chart-no-axes-combined" title="度量分析即将上线" description="目前没有可展示的度量数据。" />
          </section>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
