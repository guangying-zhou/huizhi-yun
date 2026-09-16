<script setup lang="ts">
export interface AppLauncherItemOverride {
  homeUrl?: string | null
  basePath?: string | null
  external?: boolean
  restoreLastRoute?: boolean
  hidden?: boolean
}

const props = withDefaults(defineProps<{
  currentAppCode?: string | number
  appOverrides?: Record<string, AppLauncherItemOverride>
}>(), {
  currentAppCode: '',
  appOverrides: () => ({})
})

const emit = defineEmits<{
  intent: [appCode: string]
}>()

const { apps, loaded, loading, loadApps } = useUserApplications()
const config = useRuntimeConfig()
const pub = (config.public || {}) as Record<string, unknown>
const runtimeAppCode = String(pub.appCode || pub.appName || '').trim()

const clientReady = ref(false)
onMounted(() => {
  clientReady.value = true
})

// 切换回某应用时直接深链到其上次访问位置（丝滑直达）；SSR / 首帧未就绪时用首页 homeUrl。
const launcherApps = computed(() => apps.value
  .filter(app => !props.appOverrides[app.appCode]?.hidden)
  .map((app) => {
    const override = props.appOverrides[app.appCode]
    return {
      ...app,
      homeUrl: override && 'homeUrl' in override ? override.homeUrl || null : app.homeUrl,
      basePath: override && 'basePath' in override ? override.basePath || null : app.basePath,
      external: override?.external ?? app.appCode !== runtimeAppCode,
      restoreLastRoute: override?.restoreLastRoute ?? true
    }
  })
  .filter(app => app.homeUrl))

function directAppEntryUrl(app: { appCode: string, homeUrl: string | null, basePath?: string | null, restoreLastRoute?: boolean }) {
  if (!clientReady.value || !app.homeUrl) return app.homeUrl || ''
  if (isApplicationShellUrl(app.homeUrl, window.location.origin)) return app.homeUrl
  if (app.restoreLastRoute === false) return app.homeUrl
  return resolveAppEntryUrl(app.homeUrl, app.appCode, app.basePath)
}

function appEntryUrl(app: { appCode: string, homeUrl: string | null, basePath?: string | null }) {
  if (!clientReady.value) return app.homeUrl || ''
  const target = directAppEntryUrl(app)
  const consoleHome = apps.value.find(item => item.appCode === 'workspace' || item.appCode === 'console')?.homeUrl
  return applicationShellEntryUrl(app.appCode, target, window.location.origin, consoleHome)
}

function prefetchApp(app: { appCode: string, homeUrl: string | null, basePath?: string | null }) {
  prefetchApplicationEntry(directAppEntryUrl(app))
  prefetchApplicationEntry(appEntryUrl(app))
  emit('intent', app.appCode)
}
</script>

<template>
  <UPopover
    :content="{ align: 'end', sideOffset: 8 }"
    :ui="{ content: 'w-72 p-2' }"
    @update:open="(open: boolean) => open && loadApps()"
  >
    <UButton
      icon="i-lucide-grip"
      color="neutral"
      variant="ghost"
      square
      size="sm"
    />

    <template #content>
      <div v-if="loading || !loaded" class="flex items-center justify-center py-4">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-dimmed" />
      </div>

      <div v-else-if="!launcherApps.length" class="py-4 text-center text-sm text-dimmed">
        暂无应用
      </div>

      <div v-else class="grid grid-cols-3 gap-1">
        <NuxtLink
          v-for="app in launcherApps"
          :key="app.appCode"
          :to="appEntryUrl(app)"
          :external="app.external"
          class="flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-elevated"
          :aria-current="String(props.currentAppCode || '') === app.appCode ? 'page' : undefined"
          @pointerenter="prefetchApp(app)"
          @focus="prefetchApp(app)"
        >
          <UIcon
            v-if="isApplicationIconName(app.icon)"
            :name="app.icon!"
            class="size-8 text-muted"
          />
          <img
            v-else-if="app.icon"
            :src="app.icon"
            class="size-8 rounded object-contain"
            :alt="app.appName"
          >
          <UIcon v-else name="i-lucide-box" class="size-8 text-dimmed" />
          <span class="line-clamp-2 text-center text-xs leading-tight text-default">
            {{ getShortApplicationName(app.appName, app.appCode) }}
          </span>
        </NuxtLink>
      </div>
    </template>
  </UPopover>
</template>
