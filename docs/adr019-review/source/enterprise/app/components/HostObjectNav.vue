<script setup lang="ts">
interface Item { label: string, path: string }
interface Workspace { code: string, label: string, base: string, backTo: string, backLabel: string, groups: { label: string, items: Item[] }[] }

const props = defineProps<{ workspace: Workspace, objectPath: string }>()
const route = useRoute()

// Paths are relative to the object root, so one declaration serves every object.
function target(item: Item) {
  return `${props.objectPath}${item.path}`
}
function isCurrent(item: Item) {
  const to = target(item)
  return route.path === to || (item.path !== '' && route.path.startsWith(`${to}/`))
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Returning is pinned at the top: object mode is somewhere you go into,
         and the way back to the business area is always in the same place. -->
    <NuxtLink
      :to="workspace.backTo"
      class="flex min-h-11 items-center gap-2 rounded-md px-3 py-1 text-[13px] text-secondary transition-colors hover:bg-elevated sm:min-h-[34px]"
    >
      <UIcon name="i-lucide-arrow-left" class="size-4 shrink-0" />
      <span class="truncate">{{ workspace.backLabel }}</span>
    </NuxtLink>

    <div class="px-3">
      <p class="text-[11px] font-semibold tracking-wider text-muted">{{ workspace.label }}</p>
      <p class="truncate text-sm font-medium text-highlighted">{{ objectPath.split('/').pop() }}</p>
    </div>

    <USeparator />

    <ul v-for="group in workspace.groups" :key="group.label" class="flex flex-col gap-px">
      <li class="px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wider text-muted">{{ group.label }}</li>
      <li v-for="item in group.items" :key="item.label" class="relative flex items-center">
        <span
          v-if="isCurrent(item)"
          class="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-primary"
          aria-hidden="true"
        />
        <NuxtLink
          :to="target(item)"
          class="flex min-h-11 flex-1 items-center rounded-md py-1 pl-[34px] pr-2 text-[13px] leading-5 transition-colors sm:min-h-[34px]"
          :class="isCurrent(item)
            ? 'bg-primary/10 font-medium text-primary-700 dark:text-primary-300'
            : 'text-muted hover:bg-elevated hover:text-highlighted'"
          :aria-current="route.path === target(item) ? 'page' : undefined"
        >
          <span class="truncate">{{ item.label }}</span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
