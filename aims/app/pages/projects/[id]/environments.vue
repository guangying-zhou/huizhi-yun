<script setup lang="ts">
import { projectModuleEnabled } from '~/utils/projectModuleConfig'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '环境',
  layoutHeaderProjectSwitcher: true
})

const route = useRoute()
const projectStore = useProjectStore()
const projectId = computed(() => Number(route.params.id))

onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
})

const project = computed(() => projectStore.currentProject)
const canManage = computed(() => project.value?.currentUserRole === 'manager')
const moduleEnabled = computed(() =>
  projectModuleEnabled(project.value?.moduleConfig, project.value?.category, 'environments')
)
</script>

<template>
  <UDashboardPanel id="project-environments" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar />

        <div class="flex-1 min-h-0 overflow-y-auto p-4">
          <div
            v-if="projectStore.loading && !project"
            class="flex justify-center py-12"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="size-6 animate-spin text-muted"
            />
          </div>

          <ProjectModuleDisabledState
            v-else-if="!moduleEnabled"
            title="环境模块未启用"
          />

          <ProjectEnvironmentPanel
            v-else
            :project-id="projectId"
            :can-manage="canManage"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
