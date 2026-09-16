<script setup lang="ts">
definePageMeta({
  layout: false
})

type ShellApplication = {
  appCode: string
  appName: string
  icon?: string | null
  homeUrl: string | null
  basePath?: string | null
}

type ShellFrame = {
  appCode: string
  appName: string
  logo: string | null
  target: string
  src: string
  title: string
  loaded: boolean
  lastUsedAt: number
}

type ShellNavigationOverride = {
  homeUrl?: string | null
  basePath?: string | null
  external?: boolean
  restoreLastRoute?: boolean
  hidden?: boolean
}

type ShellFeedbackTarget = {
  basePath: string
  pageUrl: string
  routePattern: string
}

const MAX_RETAINED_FRAMES = 2
const SHELL_HISTORY_STATE_KEY = 'hzyApplicationShell'

const route = useRoute()
const { apps, loaded, loading, loadApps } = useUserApplications()
const frames = ref<ShellFrame[]>([])
const frameElements = new Map<string, HTMLIFrameElement>()

const routeAppCode = computed(() => String(route.params.appCode || '').trim().toLowerCase())
const activeApplication = computed(() => (
  apps.value.find(app => app.appCode === routeAppCode.value) as ShellApplication | undefined
))
const activeFrame = computed(() => (
  frames.value.find(frame => frame.appCode === routeAppCode.value) || null
))
const activeBrandLogo = computed(() => activeFrame.value?.logo || null)
const shellReady = computed(() => (
  Boolean(
    activeApplication.value?.homeUrl
    && isApplicationShellApplication(routeAppCode.value)
    && import.meta.client
    && isSameOriginApplicationUrl(activeApplication.value.homeUrl, window.location.origin)
  )
))
const activeFeedbackTarget = computed<ShellFeedbackTarget | null>(() => {
  if (!import.meta.client || !shellReady.value || !activeApplication.value?.homeUrl || !activeFrame.value) {
    return null
  }

  try {
    const origin = window.location.origin
    const home = new URL(activeApplication.value.homeUrl, origin)
    const configuredBasePath = String(activeApplication.value.basePath || '').trim()
    const rawBasePath = configuredBasePath || home.pathname
    if (!rawBasePath.startsWith('/') || rawBasePath.includes('://') || rawBasePath.includes('?') || rawBasePath.includes('#')) {
      return null
    }

    const basePath = `/${rawBasePath.replace(/^\/+|\/+$/g, '')}`
    if (basePath === '/') return null

    const target = new URL(activeFrame.value.target, origin)
    const basePrefix = `${basePath}/`
    if (target.origin !== origin || (target.pathname !== basePath && !target.pathname.startsWith(basePrefix))) {
      return null
    }

    const relativePath = target.pathname === basePath
      ? '/'
      : `/${target.pathname.slice(basePrefix.length).replace(/^\/+/, '')}`
    return {
      basePath,
      pageUrl: `${target.origin}${target.pathname}`,
      routePattern: relativePath
    }
  } catch {
    return null
  }
})

const workspaceItem = [{
  appCode: 'workspace',
  appName: '工作台',
  icon: 'i-lucide-house',
  homeUrl: '/',
  external: false
}]

function requestedTarget() {
  const value = route.query.target
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function directEntryFor(app: ShellApplication) {
  if (!app.homeUrl) return ''
  if (!import.meta.client) return app.homeUrl
  return resolveAppEntryUrl(app.homeUrl, app.appCode, app.basePath)
}

function shellEntryFor(app: ShellApplication) {
  const retained = frames.value.find(frame => frame.appCode === app.appCode)
  const target = retained?.target || directEntryFor(app)
  return applicationShellEntryUrl(app.appCode, target, import.meta.client ? window.location.origin : 'http://localhost')
}

const applicationOverrides = computed(() => {
  const overrides: Record<string, ShellNavigationOverride> = {
    workspace: {
      homeUrl: '/',
      basePath: '/',
      external: false,
      restoreLastRoute: false
    },
    console: {
      homeUrl: '/admin',
      basePath: '/',
      external: false,
      restoreLastRoute: false
    }
  }

  for (const app of apps.value as ShellApplication[]) {
    if (!isApplicationShellApplication(app.appCode) || !app.homeUrl) continue
    overrides[app.appCode] = {
      homeUrl: shellEntryFor(app),
      basePath: app.basePath,
      external: false
    }
  }

  return overrides
})

function trimRetainedFrames(activeAppCode: string) {
  while (frames.value.length > MAX_RETAINED_FRAMES) {
    const removable = [...frames.value]
      .filter(frame => frame.appCode !== activeAppCode)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0]
    if (!removable) break

    frameElements.delete(removable.appCode)
    frames.value = frames.value.filter(frame => frame.appCode !== removable.appCode)
  }
}

function activateRouteFrame() {
  if (!import.meta.client || !loaded.value || !shellReady.value || !activeApplication.value?.homeUrl) return

  const application = activeApplication.value
  const target = applicationShellTargetUrl(
    requestedTarget(),
    application.homeUrl,
    window.location.origin,
    application.basePath
  )
  const existing = frames.value.find(frame => frame.appCode === application.appCode)
  const now = Date.now()

  if (existing) {
    existing.lastUsedAt = now
    if (existing.target !== target) {
      existing.target = target
      existing.src = withApplicationShellEmbedParam(target, window.location.origin)
      existing.loaded = false
    } else if (existing.loaded) {
      replaceVisibleTargetUrl(existing.target, application.appCode)
    }
  } else {
    frames.value.push({
      appCode: application.appCode,
      appName: application.appName,
      logo: null,
      target,
      src: withApplicationShellEmbedParam(target, window.location.origin),
      title: application.appName,
      loaded: false,
      lastUsedAt: now
    })
  }

  trimRetainedFrames(application.appCode)
}

function prewarmApplication(appCode: string) {
  if (!import.meta.client || frames.value.some(frame => frame.appCode === appCode)) return

  const application = apps.value.find(app => app.appCode === appCode) as ShellApplication | undefined
  if (!application?.homeUrl || !isApplicationShellApplication(application.appCode)) return

  const target = applicationShellTargetUrl(
    directEntryFor(application),
    application.homeUrl,
    window.location.origin,
    application.basePath
  )
  frames.value.push({
    appCode: application.appCode,
    appName: application.appName,
    logo: null,
    target,
    src: withApplicationShellEmbedParam(target, window.location.origin),
    title: application.appName,
    loaded: false,
    lastUsedAt: Date.now()
  })
  trimRetainedFrames(routeAppCode.value)
}

function setFrameElement(appCode: string, element: unknown) {
  if (element instanceof HTMLIFrameElement) {
    frameElements.set(appCode, element)
  } else {
    frameElements.delete(appCode)
  }
}

function markFrameLoaded(appCode: string) {
  const frame = frames.value.find(item => item.appCode === appCode)
  if (frame) frame.loaded = true
}

function refreshActiveFrame() {
  if (!import.meta.client || !activeFrame.value) return

  const frame = activeFrame.value
  const frameElement = frameElements.get(frame.appCode)
  if (!frameElement) return

  const src = withApplicationShellEmbedParam(frame.target, window.location.origin)
  frame.loaded = false
  frame.src = src
  frameElement.src = src
}

function replaceVisibleTargetUrl(target: string, appCode: string) {
  const targetPath = stripApplicationShellEmbedParam(target, window.location.origin)
  const currentState = window.history.state && typeof window.history.state === 'object'
    ? window.history.state as Record<string, unknown>
    : {}

  window.history.replaceState({
    ...currentState,
    [SHELL_HISTORY_STATE_KEY]: {
      version: 1,
      appCode,
      target: targetPath
    }
  }, '', targetPath)
}

function onShellHistoryPopState(event: PopStateEvent) {
  const marker = event.state?.[SHELL_HISTORY_STATE_KEY] as {
    version?: number
    appCode?: string
    target?: string
  } | undefined
  if (
    marker?.version !== 1
    || !isApplicationShellApplication(marker.appCode)
    || !marker.target
  ) {
    return
  }

  const shellEntry = applicationShellEntryUrl(
    marker.appCode,
    marker.target,
    window.location.origin
  )
  if (!isApplicationShellUrl(shellEntry, window.location.origin)) return
  window.location.replace(shellEntry)
}

function onFrameMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin) return

  const payload = event.data as {
    type?: string
    version?: number
    appCode?: string
    appName?: string
    logo?: string
    path?: string
    title?: string
  } | null
  if (
    payload?.type !== 'hzy:shell:navigation'
    || payload.version !== APPLICATION_SHELL_MESSAGE_VERSION
    || payload.appCode !== routeAppCode.value
  ) {
    return
  }

  const frameElement = frameElements.get(payload.appCode)
  if (event.source !== frameElement?.contentWindow) return

  const application = activeApplication.value
  const frame = activeFrame.value
  if (!application?.homeUrl || !frame) return

  const target = applicationShellTargetUrl(
    payload.path,
    application.homeUrl,
    window.location.origin,
    application.basePath
  )
  const appName = String(payload.appName || application.appName).trim()
  let logo: string | null = null
  if (payload.logo) {
    try {
      const logoURL = new URL(payload.logo, window.location.origin)
      if (logoURL.origin === window.location.origin) logo = logoURL.toString()
    } catch {
      logo = null
    }
  }

  frame.appName = appName || application.appName
  frame.logo = logo
  frame.target = target
  frame.title = String(payload.title || application.appName).trim() || application.appName
  frame.lastUsedAt = Date.now()

  replaceVisibleTargetUrl(target, application.appCode)
}

watch(
  () => [loaded.value, routeAppCode.value, requestedTarget()],
  activateRouteFrame,
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('message', onFrameMessage)
  window.addEventListener('popstate', onShellHistoryPopState)
  void loadApps().then(activateRouteFrame)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onFrameMessage)
  window.removeEventListener('popstate', onShellHistoryPopState)
})

useHead(() => ({
  title: `${activeFrame.value?.title || activeApplication.value?.appName || '应用'} - 汇智云`
}))
</script>

<template>
  <div class="flex h-svh min-h-0 w-full overflow-hidden bg-default">
    <AppRail
      :current-app-code="routeAppCode"
      :fixed-items="workspaceItem"
      :app-overrides="applicationOverrides"
      @intent="prewarmApplication"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-[46px] shrink-0 items-center gap-2 border-b border-default bg-default px-3">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <img
            v-if="activeBrandLogo"
            :src="activeBrandLogo"
            :alt="activeFrame?.appName || activeApplication?.appName"
            class="size-6 shrink-0 object-contain"
          >
          <UIcon
            v-else-if="isApplicationIconName(activeApplication?.icon)"
            :name="activeApplication!.icon!"
            class="size-5 shrink-0 text-primary"
          />
          <img
            v-else-if="activeApplication?.icon"
            :src="activeApplication.icon"
            :alt="activeApplication.appName"
            class="size-5 shrink-0 rounded object-contain"
          >
          <UIcon v-else name="i-lucide-panels-top-left" class="size-5 shrink-0 text-muted" />
          <span class="truncate text-lg font-semibold">
            {{ activeFrame?.appName || activeApplication?.appName || '企业应用' }}
          </span>
        </div>

        <UButton
          v-if="activeFrame"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          square
          size="sm"
          :loading="!activeFrame.loaded"
          aria-label="刷新当前应用"
          title="刷新当前应用"
          @click="refreshActiveFrame"
        />
        <div class="sm:hidden">
          <AppLauncher
            :current-app-code="routeAppCode"
            :app-overrides="applicationOverrides"
            @intent="prewarmApplication"
          />
        </div>
        <NotificationBell />
        <UserMenu header />
      </header>

      <main class="relative min-h-0 flex-1 overflow-hidden bg-muted/20">
        <div
          v-if="loading && !loaded"
          class="absolute inset-0 z-20 flex items-center justify-center bg-default"
        >
          <div class="flex items-center gap-2 text-sm text-muted">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
            正在加载应用…
          </div>
        </div>

        <div
          v-else-if="loaded && !shellReady"
          class="flex h-full items-center justify-center p-6"
        >
          <CommonEmptyState
            icon="i-lucide-shield-alert"
            title="无法在企业应用容器中打开"
            description="应用未获授权、属于 Console 原生入口，或部署地址不符合当前企业域名。"
          />
        </div>

        <template v-else>
          <iframe
            v-for="frame in frames"
            v-show="frame.appCode === routeAppCode"
            :key="frame.appCode"
            :ref="element => setFrameElement(frame.appCode, element)"
            :src="frame.src"
            :title="frame.appName"
            class="absolute inset-0 h-full w-full border-0 bg-default"
            allow="clipboard-read; clipboard-write; fullscreen"
            @load="markFrameLoaded(frame.appCode)"
          />

          <div
            v-if="activeFrame && !activeFrame.loaded"
            class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-default/90"
          >
            <div class="flex items-center gap-2 text-sm text-muted">
              <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
              正在进入{{ activeApplication?.appName }}…
            </div>
          </div>
        </template>
      </main>
    </div>

    <NotificationsSlideover />
    <IssueReporter
      v-if="activeFeedbackTarget"
      :target-base-path="activeFeedbackTarget.basePath"
      :target-page-url="activeFeedbackTarget.pageUrl"
      :target-route-pattern="activeFeedbackTarget.routePattern"
    />
  </div>
</template>
