<script setup lang="ts">
import type { EnterpriseProjectObjectModel } from '../composables/useEnterpriseProjectObjectContext'

const props = defineProps<{ model: EnterpriseProjectObjectModel, refreshProjects?: (page?: number, search?: string) => Promise<void> }>()
const route = useRoute()
const projectSearch = ref(props.model.projectsSearch)

// Paths are relative to the object root, so one declaration serves every object.
function target(item: { path: string }) {
  return { path: `${props.model.objectPath}${item.path}`, query: { returnTo: props.model.backTo } }
}
function isCurrent(item: { path: string }) {
  const to = target(item).path
  return route.path === to || (item.path !== '' && route.path.startsWith(`${to}/`))
}
function projectTarget(id: number) {
  return { path: `/aims/projects/${id}`, query: { returnTo: props.model.backTo } }
}
function searchProjects() { void props.refreshProjects?.(1, projectSearch.value.trim()) }
function changeProjectPage(page: number) { void props.refreshProjects?.(page, projectSearch.value.trim()) }
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Returning is pinned at the top: object mode is somewhere you go into,
         and the way back to the business area is always in the same place. -->
    <NuxtLink
      :to="model.backTo"
      class="host-nav-row host-nav-control flex min-h-11 items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors sm:min-h-[34px]"
    >
      <UIcon name="i-lucide-arrow-left" class="size-4 shrink-0" />
      <span class="truncate">{{ model.backLabel }}</span>
    </NuxtLink>

    <div class="px-3">
      <p class="text-xs font-semibold text-[var(--host-nav-muted)]">项目</p>
      <p class="truncate text-sm font-medium text-highlighted">{{ model.label }}</p>
    </div>

    <div class="mx-2 space-y-2">
      <UFormField label="切换项目">
        <UInput v-model="projectSearch" size="sm" placeholder="搜索项目" icon="i-lucide-search" :loading="model.projectsLoading" @keyup.enter="searchProjects" />
      </UFormField>
      <UDropdownMenu
        :items="[model.projects.map(project => ({ label: project.name, to: projectTarget(project.id), checked: project.id === Number(route.params.id) }))]"
        :content="{ align: 'start', side: 'bottom' }"
      >
        <UButton class="w-full justify-between" color="neutral" variant="soft" trailing-icon="i-lucide-chevrons-up-down" :disabled="!model.projects.length || model.projectsLoading">切换项目</UButton>
      </UDropdownMenu>
      <p v-if="!model.projectsLoading && !model.projects.length" class="px-1 text-xs text-muted">没有匹配的项目</p>
      <UPagination v-if="model.projectsTotal > model.projectsPageSize" :page="model.projectsPage" :items-per-page="model.projectsPageSize" :total="model.projectsTotal" size="xs" @update:page="changeProjectPage" />
    </div>

    <div class="border-t border-[var(--host-nav-border)]" />

    <ul v-for="group in model.groups" :key="group.id || group.label" class="flex flex-col gap-px">
      <li class="px-3 pb-1 pt-2 text-xs font-semibold text-[var(--host-nav-muted)]">{{ group.label }}</li>
      <li v-for="item in group.items" :key="item.id || item.path" class="relative flex items-center">
        <span
          v-if="isCurrent(item)"
          class="host-nav-indicator absolute inset-y-1 left-0 w-[3px] rounded-r-full"
          aria-hidden="true"
        />
        <NuxtLink
          :to="target(item)"
          class="host-nav-row flex min-h-11 flex-1 items-center rounded-md py-1 pl-[37px] pr-2 text-sm leading-5 transition-colors sm:min-h-[34px]"
          :class="isCurrent(item)
            ? 'font-medium'
            : ''"
          :aria-current="isCurrent(item) ? 'page' : undefined"
        >
          <span class="truncate">{{ item.label }}</span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
