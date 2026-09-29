<script setup lang="ts">
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'

const items = [
  { icon: 'i-lucide-alarm-clock', title: '逾期任务预警' },
  { icon: 'i-lucide-unplug', title: '阻塞依赖' },
  { icon: 'i-lucide-users', title: '资源冲突' }
]
</script>

<template>
  <UDashboardPanel id="enterprise-project-risks" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar />
        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-4 sm:px-6">
          <section class="space-y-6">
            <div class="grid gap-3 sm:grid-cols-3">
              <UCard v-for="item in items" :key="item.title" class="text-center">
                <UIcon :name="item.icon" class="mx-auto size-7 text-warning" />
                <p class="mt-3 font-medium">
                  {{ item.title }}
                </p>
              </UCard>
            </div>
            <CommonEmptyState icon="i-lucide-shield-alert" title="风险管控即将上线" description="目前没有可展示的风险数据。" />
          </section>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
