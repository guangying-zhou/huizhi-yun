<script setup lang="ts">
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '风险管控',
  layoutHeaderProjectSwitcher: true
})

const route = useRoute()
const projectId = computed(() => Number(route.params.id))

const projectStore = useProjectStore()

onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
})

const riskItems = [
  { icon: 'i-lucide-alarm-clock', title: '逾期任务预警', color: 'text-error' },
  { icon: 'i-lucide-unplug', title: '阻塞依赖', color: 'text-warning' },
  { icon: 'i-lucide-users', title: '资源冲突', color: 'text-info' }
]
</script>

<template>
  <UDashboardPanel id="project-risks" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar />
        <div class="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center py-24 text-center">
          <div class="flex gap-6 mb-8">
            <div
              v-for="item in riskItems"
              :key="item.title"
              class="border border-default rounded-lg p-6 w-40 flex flex-col items-center gap-3"
            >
              <UIcon :name="item.icon" :class="['w-8 h-8', item.color]" />
              <span class="text-sm font-medium">{{ item.title }}</span>
            </div>
          </div>
          <p class="text-muted text-sm">
            即将上线
          </p>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
