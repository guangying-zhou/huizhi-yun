<script setup lang="ts">
interface NavItem { id: string, label: string, icon?: string, to?: string, module?: string, permission?: { resource: string, action: string }, permissionRefs?: { resource: string, action: string }[], mode?: 'all' | 'any', children?: NavItem[] }
interface NavigationContext { visibleTree: { value: NavItem[] }, activeId: { value: string }, setPreferred: (id: string) => void }

const props = withDefaults(defineProps<{ items: NavItem[], level?: number }>(), { level: 1 })
const route = useRoute()
const navigationContext = inject<NavigationContext | null>('enterprise-navigation-context', null)

// A route matches its own page and anything beneath it, so a detail page keeps
// its list entry marked. The trailing slash stops /assets/product-directory
// from lighting up /assets/products.
function matchesRoute(item: NavItem): boolean {
  return Boolean(item.to) && (route.path === item.to || route.path.startsWith(`${item.to}/`))
}

const activeLeafId = computed(() => navigationContext?.activeId.value || props.items
  .filter(item => item.to && matchesRoute(item))
  .sort((a, b) => (b.to?.length || 0) - (a.to?.length || 0))[0]?.id || '')
function isCurrent(item: NavItem): boolean { return item.id === activeLeafId.value }

// Only the current row carries the three-part treatment. An ancestor merely
// holds the current page: it opens, but marking it too would leave the sidebar
// with several rows all claiming to be current.
function holdsCurrent(item: NavItem): boolean {
  return (item.children || []).some(child => isCurrent(child) || holdsCurrent(child))
}

function rowClass(item: NavItem) {
  return [
    'host-nav-row flex min-h-11 flex-1 items-center gap-2 rounded-md py-1 pr-2 text-left transition-colors sm:min-h-[34px]',
    // Section headings are level one; workspaces and pages align at x36–37.
    props.level === 1 ? 'pl-3' : props.level === 2 ? 'pl-[37px]' : 'pl-[53px]',
    isCurrent(item)
      ? ''
      : holdsCurrent(item)
        ? 'font-medium text-[var(--host-nav-ink)]'
        : ''
  ]
}

const config = useRuntimeConfig()
const accessScope = useState<string>('enterprise-cache-scope', () => '')
const open = reactive<Record<string, boolean>>({})
const preferenceScope = computed(() => {
  const environment = String(config.public.platformEnvironment || '').trim() || 'production'
  return accessScope.value ? `${accessScope.value}:${environment}` : ''
})
const preferences = ref<Record<string, boolean>>({})
const visibleIds = computed(() => new Set((navigationContext?.visibleTree.value || props.items).flatMap(item => [item.id, ...item.children?.map(child => child.id) || []])))
function preferenceKey() { return `hzy.enterprise.nav:${preferenceScope.value}` }
function loadPreferences() {
  preferences.value = {}
  if (!preferenceScope.value || typeof localStorage === 'undefined') return
  try {
    const parsed = JSON.parse(localStorage.getItem(preferenceKey()) || '{}')
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      preferences.value = Object.fromEntries(Object.entries(record).filter(([id, value]) => visibleIds.value.has(id) && typeof value === 'boolean')) as Record<string, boolean>
    }
  } catch { /* stale or manually cleared preference is fail-closed */ }
}
function savePreference(id: string, value: boolean) {
  if (!preferenceScope.value || typeof localStorage === 'undefined') return
  loadPreferences()
  preferences.value[id] = value
  try { localStorage.setItem(preferenceKey(), JSON.stringify(preferences.value)) } catch { /* private mode or quota: keep in-memory state */ }
}
function setOpen(item: NavItem, value: boolean) {
  open[item.id] = value
  if (props.level === 1) savePreference(item.id, value)
}
// 业务领域已上移为分节标题，树的第一级就是工作域，因此不再有“整级强制展开”：
// 只有正持有当前页面的工作域是展开的，其余保持收起，侧栏长度才可控。
//
// Route/context changes open the active ancestors and restore only the current
// area's preferences. Clicking another group remains usable until navigation.
watch(preferenceScope, loadPreferences, { immediate: true })
watch([() => route.path, activeLeafId, preferenceScope, () => props.items], () => {
  for (const id of Object.keys(open)) delete open[id]
  const currentArea = navigationContext?.visibleTree.value.find(area => holdsCurrent(area))
  for (const item of props.items) {
    if (item.children) open[item.id] = holdsCurrent(item)
      || (Boolean(currentArea && item.id.startsWith(`${currentArea.id}.`)) && preferences.value[item.id] === true)
  }
}, { immediate: true })
</script>

<template>
  <ul class="flex flex-col gap-px" :class="level > 1 ? 'host-nav-branches' : ''">
    <li v-for="item in items" :key="item.id">
      <div class="relative flex items-center">
        <!-- The indicator is the third part of the current-row treatment, with
             the soft background and the darker label; colour alone never marks it. -->
        <span
          v-if="isCurrent(item)"
          class="host-nav-indicator absolute inset-y-1 z-10 w-[3px] rounded-r-full"
          :class="level > 1 ? 'left-[19px]' : 'left-0'"
          aria-hidden="true"
        />
        <!-- A page is a real link so it can be opened in a new tab, copied and
             followed without JavaScript; a pure group is a button that only
             expands. Resolving the component dynamically silently produced an
             unknown element instead, which looked right and clicked nowhere. -->
        <NuxtLink v-if="item.to" :to="item.to" :class="rowClass(item)" :aria-current="isCurrent(item) ? 'page' : undefined" @click="navigationContext?.setPreferred(item.id)">
          <UIcon v-if="item.icon" :name="item.icon" class="size-4 shrink-0" />
          <span class="truncate text-sm leading-5" :class="level === 1 ? 'font-medium' : ''">{{ item.label }}</span>
        </NuxtLink>
        <button
          v-else
          type="button"
          :class="rowClass(item)"
          :aria-expanded="item.children ? open[item.id] === true : undefined"
          @click="item.children ? setOpen(item, !open[item.id]) : undefined"
        >
          <UIcon v-if="item.icon" :name="item.icon" class="size-4 shrink-0" />
          <span class="truncate text-sm leading-5" :class="level === 1 ? 'font-medium' : ''">{{ item.label }}</span>
        </button>

        <!-- Entering and expanding are separate targets: the label navigates,
             this button only opens the group, and both take keyboard focus. -->
        <button
          v-if="item.children && item.to"
          type="button"
          class="host-nav-control flex size-11 shrink-0 items-center justify-center rounded-md text-[var(--host-nav-muted)] transition-colors hover:bg-[var(--host-nav-hover)] hover:text-[var(--host-nav-ink)] sm:size-7"
          :aria-expanded="open[item.id] === true"
          :aria-label="`${open[item.id] ? '收起' : '展开'} ${item.label}`"
          @click="setOpen(item, !open[item.id])"
        >
          <UIcon name="i-lucide-chevron-right" class="size-4 transition-transform" :class="open[item.id] ? 'rotate-90' : ''" />
        </button>
        <UIcon
          v-else-if="item.children"
          name="i-lucide-chevron-right"
          class="pointer-events-none absolute right-3 size-4 text-dimmed transition-transform"
          :class="open[item.id] ? 'rotate-90' : ''"
          aria-hidden="true"
        />
      </div>

      <HostNavTree v-if="item.children && open[item.id]" :items="item.children" :level="level + 1" />
    </li>
  </ul>
</template>
