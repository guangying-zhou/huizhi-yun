<script setup lang="ts">
import type { EnterpriseProjectObjectModel } from '../composables/useEnterpriseProjectObjectContext'

const props = defineProps<{ model: EnterpriseProjectObjectModel, refreshProjects?: (page?: number, search?: string) => Promise<void> }>()
const route = useRoute()
const projectSearch = ref(props.model.projectsSearch)
const switcherOpen = ref(false)

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
function searchProjects() {
  void props.refreshProjects?.(1, projectSearch.value.trim())
}
function changeProjectPage(page: number) {
  void props.refreshProjects?.(page, projectSearch.value.trim())
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Returning is pinned at the top: object mode is somewhere you go into,
         and the way back to the business area is always in the same place. -->
    <NuxtLink
      :to="model.backTo"
      class="host-nav-row host-nav-control flex min-h-11 items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors sm:min-h-[34px]"
    >
      <UIcon
        name="i-lucide-arrow-left"
        class="size-4 shrink-0"
      />
      <span class="truncate">{{ model.backLabel }}</span>
    </NuxtLink>

    <!-- One control: the current project is the trigger, the list with
         search and paging opens beneath it. -->
    <UPopover
      v-model:open="switcherOpen"
      :content="{ align: 'start', side: 'bottom', sideOffset: 4 }"
      :ui="{ content: 'w-72 p-0' }"
    >
      <button
        type="button"
        class="host-nav-row host-nav-control mx-2 flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-left sm:min-h-[40px]"
        :aria-label="`当前项目：${model.label}，切换项目`"
      >
        <span class="min-w-0 flex-1">
          <span class="block text-xs font-semibold text-[var(--host-nav-muted)]">项目</span>
          <span class="block truncate text-sm font-medium text-highlighted">{{ model.label }}</span>
        </span>
        <UIcon
          name="i-lucide-chevrons-up-down"
          class="size-4 shrink-0 text-[var(--host-nav-muted)]"
        />
      </button>
      <template #content>
        <div class="border-b border-default p-2">
          <UInput
            v-model="projectSearch"
            size="sm"
            placeholder="搜索项目，回车确认"
            icon="i-lucide-search"
            :loading="model.projectsLoading"
            class="w-full"
            autofocus
            @keyup.enter="searchProjects"
          />
        </div>
        <ul
          class="max-h-72 overflow-y-auto p-1"
          aria-label="项目列表"
        >
          <li
            v-for="project in model.projects"
            :key="project.id"
          >
            <NuxtLink
              :to="projectTarget(project.id)"
              class="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm hover:bg-elevated"
              :aria-current="project.id === Number(route.params.id) ? 'page' : undefined"
              @click="switcherOpen = false"
            >
              <span
                class="truncate"
                :class="project.id === Number(route.params.id) ? 'font-medium text-highlighted' : 'text-toned'"
              >{{ project.name }}</span>
              <UIcon
                v-if="project.id === Number(route.params.id)"
                name="i-lucide-check"
                class="size-4 shrink-0 text-primary"
              />
            </NuxtLink>
          </li>
          <li
            v-if="!model.projectsLoading && !model.projects.length"
            class="px-2 py-6 text-center text-xs text-muted"
          >
            没有匹配的项目
          </li>
        </ul>
        <div
          v-if="model.projectsTotal > model.projectsPageSize"
          class="flex justify-center border-t border-default p-2"
        >
          <UPagination
            :page="model.projectsPage"
            :items-per-page="model.projectsPageSize"
            :total="model.projectsTotal"
            size="xs"
            @update:page="changeProjectPage"
          />
        </div>
      </template>
    </UPopover>

    <div class="border-t border-[var(--host-nav-border)]" />

    <ul
      v-for="group in model.groups"
      :key="group.id || group.label"
      class="flex flex-col gap-px"
    >
      <li class="px-3 pb-1 pt-2 text-xs font-semibold text-[var(--host-nav-muted)]">
        {{ group.label }}
      </li>
      <li
        v-for="item in group.items"
        :key="item.id || item.path"
        class="relative flex items-center"
      >
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
