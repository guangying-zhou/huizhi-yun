<script setup lang="ts">
export interface AppRailItem {
  appCode: string
  appName: string
  icon?: string | null
  homeUrl?: string | null
  external?: boolean
}

export interface AppRailItemOverride {
  appName?: string | null
  icon?: string | null
  homeUrl?: string | null
  external?: boolean
  hidden?: boolean
}

interface AppRailDisplayItem {
  appCode: string
  appName: string
  icon: string | null
  homeUrl: string
  external: boolean
}

const props = withDefaults(defineProps<{
  currentAppCode?: string | number
  fixedItems?: AppRailItem[]
  hiddenAppCodes?: Array<string | number>
  appOverrides?: Record<string, AppRailItemOverride>
}>(), {
  currentAppCode: '',
  fixedItems: () => [],
  hiddenAppCodes: () => [],
  appOverrides: () => ({})
})

const { apps, loaded, loading, loadApps } = useUserApplications()

const currentCode = computed(() => String(props.currentAppCode || '').trim())
const hiddenCodes = computed(() => new Set(props.hiddenAppCodes.map(code => String(code || '').trim()).filter(Boolean)))

onMounted(() => {
  loadApps()
})

function normalizeRailItem(item: AppRailItem, defaultExternal: boolean) {
  const appCode = String(item.appCode || '').trim()
  if (!appCode || hiddenCodes.value.has(appCode)) return null

  const override = props.appOverrides[appCode]
  if (override?.hidden) return null

  const homeUrl = String((override && 'homeUrl' in override ? override.homeUrl : item.homeUrl) || '').trim()
  if (!homeUrl) return null

  return {
    appCode,
    appName: String((override && 'appName' in override ? override.appName : item.appName) || appCode),
    icon: (override && 'icon' in override ? override.icon : item.icon) || null,
    homeUrl,
    external: override?.external ?? item.external ?? defaultExternal
  }
}

const railItems = computed(() => {
  const items: AppRailDisplayItem[] = []
  const seen = new Set<string>()

  for (const item of props.fixedItems) {
    const normalized = normalizeRailItem(item, false)
    if (!normalized || seen.has(normalized.appCode)) continue
    items.push(normalized)
    seen.add(normalized.appCode)
  }

  for (const app of apps.value) {
    const normalized = normalizeRailItem(app, true)
    if (!normalized || seen.has(normalized.appCode)) continue
    items.push(normalized)
    seen.add(normalized.appCode)
  }

  return items
})

function isCurrentApp(appCode: string) {
  return currentCode.value === appCode
}
</script>

<template>
  <aside
    v-if="loading || !loaded || railItems.length"
    class="hidden h-svh w-16 shrink-0 flex-col items-center border-r border-default bg-elevated/30 py-2 sm:flex"
    aria-label="应用导航"
  >
    <div class="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1">
      <div v-if="loading && !loaded" class="flex h-12 w-full items-center justify-center">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-dimmed" />
      </div>

      <UTooltip
        v-for="app in railItems"
        :key="app.appCode"
        :text="app.appName"
        :content="{ side: 'right' }"
      >
        <NuxtLink
          :to="app.homeUrl"
          :external="app.external"
          class="group relative flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center transition-colors"
          :class="isCurrentApp(app.appCode)
            ? 'bg-primary/10 text-primary'
            : 'text-muted hover:bg-elevated hover:text-default'"
          :aria-current="isCurrentApp(app.appCode) ? 'page' : undefined"
        >
          <span
            v-if="isCurrentApp(app.appCode)"
            class="absolute left-0 top-1/2 h-7 w-0.5 -translate-y-1/2 rounded-r bg-primary"
          />
          <UIcon
            v-if="isApplicationIconName(app.icon)"
            :name="app.icon!"
            class="size-5 shrink-0"
          />
          <img
            v-else-if="app.icon"
            :src="app.icon"
            class="size-5 rounded object-contain"
            :alt="app.appName"
          >
          <UIcon v-else name="i-lucide-box" class="size-5 shrink-0" />
          <span class="w-full truncate text-[10px] leading-3">
            {{ getShortApplicationName(app.appName, app.appCode) }}
          </span>
        </NuxtLink>
      </UTooltip>
    </div>

    <div
      class="relative -mb-2 mt-2 h-44 w-full shrink-0 overflow-hidden bg-gradient-to-t from-blue-600 via-violet-600/80 to-transparent"
      aria-label="汇智云数智协同"
    >
      <span
        class="pointer-events-none absolute bottom-16 left-1/2 w-52 origin-center -translate-x-1/2 -rotate-90 whitespace-nowrap text-center text-lg font-bold leading-none tracking-normal text-white drop-shadow-md"
      >
        汇智云数智协同
      </span>
      <span class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-white/10 blur-md" />
    </div>
  </aside>
</template>
