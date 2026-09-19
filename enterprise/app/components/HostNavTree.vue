<script setup lang="ts">
interface NavItem { label: string, icon?: string, to?: string, children?: NavItem[] }

const props = withDefaults(defineProps<{ items: NavItem[], level?: number }>(), { level: 1 })
const route = useRoute()

// A route matches its own page and anything beneath it, so a detail page keeps
// its list entry marked. The trailing slash stops /assets/product-directory
// from lighting up /assets/products.
function isCurrent(item: NavItem): boolean {
  return Boolean(item.to) && (route.path === item.to || route.path.startsWith(`${item.to}/`))
}

// Only the current row carries the three-part treatment. An ancestor merely
// holds the current page: it opens, but marking it too would leave the sidebar
// with several rows all claiming to be current.
function holdsCurrent(item: NavItem): boolean {
  return (item.children || []).some(child => isCurrent(child) || holdsCurrent(child))
}

function rowClass(item: NavItem) {
  return [
    'flex min-h-11 flex-1 items-center gap-2 rounded-md py-1 pr-2 text-left transition-colors sm:min-h-[34px]',
    // 第二级与第一级的标题文字左对齐：pl-3(12) + 图标 16 + gap-2(8) = 36。
    props.level === 1 ? 'pl-3' : props.level === 2 ? 'pl-9' : 'pl-[60px]',
    isCurrent(item)
      ? 'bg-primary/10 font-medium text-primary-700 dark:text-primary-300'
      : holdsCurrent(item)
        ? 'font-medium text-highlighted hover:bg-elevated'
        : 'text-muted hover:bg-elevated hover:text-highlighted'
  ]
}

const open = reactive<Record<string, boolean>>({})
// 业务领域已上移为分节标题，树的第一级就是工作域，因此不再有“整级强制展开”：
// 只有正持有当前页面的工作域是展开的，其余保持收起，侧栏长度才可控。
//
// Navigating resets the fold: a domain the reader opened on the way somewhere
// else closes again, so the sidebar shows where they are now rather than
// accumulating every path they browsed.
watch(() => route.path, () => {
  for (const item of props.items) {
    if (item.children) open[item.label] = holdsCurrent(item)
  }
}, { immediate: true })
</script>

<template>
  <ul class="flex flex-col gap-px">
    <li v-for="item in items" :key="item.label">
      <div class="relative flex items-center">
        <!-- The indicator is the third part of the current-row treatment, with
             the soft background and the darker label; colour alone never marks it. -->
        <span
          v-if="isCurrent(item)"
          class="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-primary"
          aria-hidden="true"
        />
        <!-- A page is a real link so it can be opened in a new tab, copied and
             followed without JavaScript; a pure group is a button that only
             expands. Resolving the component dynamically silently produced an
             unknown element instead, which looked right and clicked nowhere. -->
        <NuxtLink v-if="item.to" :to="item.to" :class="rowClass(item)" :aria-current="route.path === item.to ? 'page' : undefined">
          <UIcon v-if="item.icon" :name="item.icon" class="size-4 shrink-0" />
          <span class="truncate leading-5" :class="level === 1 ? 'text-sm font-medium' : 'text-[13px]'">{{ item.label }}</span>
        </NuxtLink>
        <button
          v-else
          type="button"
          :class="rowClass(item)"
          :aria-expanded="item.children ? open[item.label] === true : undefined"
          @click="item.children ? (open[item.label] = !open[item.label]) : undefined"
        >
          <UIcon v-if="item.icon" :name="item.icon" class="size-4 shrink-0" />
          <span class="truncate leading-5" :class="level === 1 ? 'text-sm font-medium' : 'text-[13px]'">{{ item.label }}</span>
        </button>

        <!-- Entering and expanding are separate targets: the label navigates,
             this button only opens the group, and both take keyboard focus. -->
        <button
          v-if="item.children && item.to"
          type="button"
          class="flex size-11 shrink-0 items-center justify-center rounded-md text-dimmed transition-colors hover:bg-elevated hover:text-muted sm:size-7"
          :aria-expanded="open[item.label] === true"
          :aria-label="`${open[item.label] ? '收起' : '展开'} ${item.label}`"
          @click="open[item.label] = !open[item.label]"
        >
          <UIcon name="i-lucide-chevron-right" class="size-4 transition-transform" :class="open[item.label] ? 'rotate-90' : ''" />
        </button>
        <UIcon
          v-else-if="item.children"
          name="i-lucide-chevron-right"
          class="pointer-events-none absolute right-3 size-4 text-dimmed transition-transform"
          :class="open[item.label] ? 'rotate-90' : ''"
          aria-hidden="true"
        />
      </div>

      <HostNavTree v-if="item.children && open[item.label]" :items="item.children" :level="level + 1" />
    </li>
  </ul>
</template>
