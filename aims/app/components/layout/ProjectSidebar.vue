<script setup lang="ts">
import { getProjectMenuItems } from '~/config/navigation'

const props = defineProps<{
  projectId: string | number
  collapsed: boolean
  menuOverlayEnabled: boolean
  navigationUi: Record<string, string | undefined>
}>()

const emit = defineEmits<{
  'exit-project': []
}>()

const projectIdValue = computed(() => String(props.projectId || ''))

const route = useRoute()

const projectMenuItems = computed(() => {
  if (!projectIdValue.value) return []
  const items = getProjectMenuItems(projectIdValue.value)
  const projectRootPath = `/projects/${projectIdValue.value}`
  // 子路由高亮：
  //  - "概览"（to === 项目根路径）：仅精确匹配才 active，否则会吞掉所有子路由
  //  - 其他菜单：当前路径以 menu.to 开头（允许子路径）
  return items.map((item) => {
    const isRoot = item.to === projectRootPath
    const isMilestoneMenu = item.to === `${projectRootPath}/plan`
    const active = isRoot
      ? route.path === item.to
      : isMilestoneMenu
        ? (
            route.path === item.to
            || route.path.startsWith(`${item.to}/`)
            || route.path.startsWith(`${projectRootPath}/milestones/`)
          )
        : route.path === item.to || route.path.startsWith(`${item.to}/`)
    return { ...item, active }
  })
})
</script>

<template>
  <div
    class="border-b border-default"
    :class="collapsed ? 'flex h-13 items-center justify-center px-2' : 'h-13 px-3 py-1.5'"
  >
    <button
      v-show="collapsed"
      class="flex size-9 items-center justify-center rounded-xl px-2 text-default transition-colors hover:bg-elevated"
      @click="emit('exit-project')"
    >
      <UIcon name="i-lucide-corner-up-left" class="size-5 shrink-0" />
    </button>

    <button
      v-show="!collapsed"
      class="flex w-full items-center gap-2 rounded-xl bg-elevated px-3 py-2.5 text-left text-sm font-medium text-highlighted transition-colors hover:bg-accented"
      @click="emit('exit-project')"
    >
      <UIcon name="i-lucide-corner-up-left" class="pl-6 size-5 shrink-0 text-default" />
      <span class="truncate">返回主菜单</span>
    </button>
  </div>

  <div class="pt-2">
    <UNavigationMenu
      :collapsed="collapsed"
      :items="projectMenuItems"
      orientation="vertical"
      :tooltip="menuOverlayEnabled"
      :popover="menuOverlayEnabled"
      :ui="navigationUi"
    />
  </div>
</template>
