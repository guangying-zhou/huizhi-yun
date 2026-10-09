<script setup lang="ts">
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { employeePagePermission } from '../utils/employee-page-access'
import { createHostSidebarPeek } from '../utils/host-sidebar-peek'
import { observeHostPageTitle } from '../utils/host-page-title'
import HostNavSections from '../components/HostNavSections.vue'
import HostNavTree from '../components/HostNavTree.vue'
import HostObjectNav from '../components/HostObjectNav.vue'
import HostAnnouncements from '../components/HostAnnouncements.vue'
import HostWorkflowPanel from '../components/HostWorkflowPanel.vue'
import { selectActiveLeaf } from '../utils/navigation-active.mjs'

const { $enterpriseSession } = useNuxtApp()
// Shell preflight must follow the target before Nuxt resolves its lazy page.
const route = useRouter().currentRoute
const editorWorkspace = computed(() => /^\/codocs\/documents\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(route.value.path))
const contentInsetDisabled = computed(() => editorWorkspace.value || route.value.meta.hostContentInset === false)
const auth = useAuth()
const config = useRuntimeConfig()
const navigationAccess = useEnterpriseNavigationAccess()
const businessNavigation = navigationAccess.navigation
const primary = computed(() => businessNavigation.value.primary || [])
const auxiliary = computed(() => businessNavigation.value.auxiliary || [])
const workspaces = navigationAccess.workspaces
const preferredId = ref('')
const visibleTree = computed(() => [...primary.value, ...auxiliary.value])
const activeId = computed(() => selectActiveLeaf(visibleTree.value, route.value.path, preferredId.value))
provide('enterprise-navigation-context', {
  visibleTree,
  activeId,
  setPreferred(id: string) { preferredId.value = id }
})

// A project is long enough to stay inside that the same sidebar becomes its
// object navigation. Switching only changes what the sidebar shows: the shell,
// the session and the area the object belongs to are untouched.
const projectContext = provideEnterpriseProjectObjectContext(useEnterpriseProjectObjectContext({
  workspace: computed(() => workspaces.value.find((workspace: { code: string }) => workspace.code === 'aims-project'))
}))
const objectMode = projectContext.model
// The Host brand is a static asset, not the Codocs/application-list icon.
// Avoid loading the application catalog just to render the common header.
const appLogo = computed(() => String(config.public.appLogo || '/enterprise/logo.svg'))

// The environment badge marks anything that is not production, so a test tenant
// is never mistaken for the real one. Production shows no badge at all.
const environment = computed(() => String(config.public.platformEnvironment || '').trim())
const nonProduction = computed(() => environment.value !== '' && !['production', 'prod'].includes(environment.value.toLowerCase()))
const displayName = computed(() => auth.userRealname?.value || auth.userNickname?.value || auth.user?.value || '')
// Console stays a standalone administration console (outside the Host routes),
// so its entry opens in a new tab with a full page load.
const consoleEntry = useConsoleEntryAccess()
const personalMenu = computed(() => [
  [
    { label: '使用说明', icon: 'i-lucide-book-open', to: '/enterprise/help' },
    { label: '系统公告', icon: 'i-lucide-megaphone', to: '/enterprise/announcements' },
    { label: '个人资料', icon: 'i-lucide-user-round', to: '/enterprise/profile' },
    ...(consoleEntry.allowed.value ? [{ label: '控制台', icon: 'i-lucide-settings', to: '/console/admin', target: '_blank', external: true }] : [])
  ],
  [{ label: '退出登录', icon: 'i-lucide-log-out', onSelect: () => $enterpriseSession.logout() }]
])
const { name: enterpriseName } = useEnterpriseBrand()
const signedIn = computed(() => auth.authenticated.value)
// The page's module permission snapshot failed to load (dependency outage or
// an unexpected response). Buttons stay disabled (fail closed), but the user is
// told why instead of seeing silently missing actions.
const authorization = useAuthorization({ routeMeta: () => route.value.meta })
function hasPermission(resource: string, action: string) {
  const snapshot = authorization.getAuthorization()
  return Boolean(snapshot && authorizationResourcesAllow(snapshot.resources, resource, action, snapshot.actionPolicies?.[resource]))
}
const authorizationFailed = computed(() => signedIn.value && Boolean(authorization.error.value))
const authorizationRetrying = ref(false)
watch(authorization.authorizationApp, () => {
  if (import.meta.client) void authorization.loadAuthorization()
}, { immediate: true })
const employeeReadPermission = computed(() => employeePagePermission(route.value.path))
const employeePageDenied = computed(() => Boolean(authorization.loaded.value && !authorization.error.value && employeeReadPermission.value
  && !(employeeReadPermission.value.anyActions || [employeeReadPermission.value.action]).some(action => hasPermission(employeeReadPermission.value!.resource, action))))
const projectEntryDenied = computed(() => /^\/aims\/projects\/[1-9]\d*(?:\/|$)/u.test(route.value.path)
  && navigationAccess.status.value === 'ready' && !projectContext.active.value)

async function retryAuthorization() {
  authorizationRetrying.value = true
  try {
    await authorization.loadAuthorization({ force: true })
  } finally {
    authorizationRetrying.value = false
  }
}
const workflow = usePageWorkflowState()
const workflowWide = useMediaQuery('(min-width: 1280px)')
const workflowDrawer = ref(false)
const hostedCompletionPage = computed(() => /^\/aims\/projects\/[1-9]\d*\/board\/[1-9]\d*\/execution$/u.test(route.value.path))
const showWorkflow = computed(() => config.public.hostWorkflowEnabled === true && signedIn.value && hostedCompletionPage.value && workflow.hasPageWorkflow.value)

// The selected design starts at 224px and permits a modest desktop adjustment.
const width = ref(224)
const collapsed = ref(false)
const drawer = ref(false)
const sidebarWidth = computed(() => `${collapsed.value ? 56 : width.value}px`)
const sidebarPeek = ref(false)
const sidebarCompact = computed(() => collapsed.value && !sidebarPeek.value)
const displayedSidebarWidth = computed(() => `${sidebarCompact.value ? 56 : width.value}px`)
const sidebarDesktop = useMediaQuery('(min-width: 1024px)')
const sidebarHover = useMediaQuery('(hover: hover) and (pointer: fine)')
const sidebarPeekController = createHostSidebarPeek({
  collapsed: () => collapsed.value,
  desktop: () => sidebarDesktop.value,
  hover: () => sidebarHover.value,
  update: (expanded) => {
    sidebarPeek.value = expanded
  }
})
watch([collapsed, sidebarDesktop, sidebarHover], () => sidebarPeekController.reset())
onBeforeUnmount(() => sidebarPeekController.stop())
async function focusSidebar(event: FocusEvent) {
  const wasCompact = sidebarCompact.value
  const nav = event.currentTarget as HTMLElement
  sidebarPeekController.focus()
  if (wasCompact && sidebarPeek.value) {
    // Disclosure replaces compact controls; carry keyboard focus into the
    // visible tree instead of losing it when that compact branch unmounts.
    await nextTick()
    nav.querySelector<HTMLElement>('a[href],button:not([disabled])')?.focus({ preventScroll: true })
  }
}
function blurSidebar(event: FocusEvent) {
  if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) return
  sidebarPeekController.blur()
}
const contentViewport = ref<HTMLElement | null>(null)
const pinnedTitle = ref({ title: '', visible: false })
let stopTitleObserver: (() => void) | undefined
onMounted(() => {
  if (contentViewport.value) {
    stopTitleObserver = observeHostPageTitle(contentViewport.value, (state) => {
      pinnedTitle.value = state
    })
  }
})
onBeforeUnmount(() => stopTitleObserver?.())
function startResize(event: PointerEvent) {
  const origin = event.clientX
  const start = width.value
  const move = (moved: PointerEvent) => {
    width.value = Math.min(256, Math.max(208, start + moved.clientX - origin))
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}

// Selecting a page closes the drawer so it never covers the content it opened.
watch(() => route.value.path, () => {
  drawer.value = false
  workflowDrawer.value = false
  sidebarPeekController.reset()
})
</script>

<template>
  <div
    class="flex h-svh flex-col bg-default"
    :style="{ '--host-sidebar-width': sidebarWidth, '--host-displayed-sidebar-width': displayedSidebarWidth, '--host-sidebar-peek-offset': `${sidebarPeek ? width - 56 : 0}px` }"
  >
    <!-- Brand and sidebar share one width, including resize/collapse. -->
    <header
      class="flex h-14 shrink-0 items-center border-b border-default bg-default"
      data-host-topbar
    >
      <div class="relative h-full w-14 shrink-0 lg:w-[var(--host-sidebar-width)]">
        <NuxtLink
          to="/enterprise"
          class="host-nav-control absolute inset-y-0 left-0 z-40 flex w-14 items-center justify-center gap-2 overflow-hidden border-r border-[var(--host-nav-border)] bg-default lg:w-[var(--host-displayed-sidebar-width)]"
          :class="sidebarCompact ? '' : 'lg:justify-start lg:px-4'"
          :aria-label="enterpriseName ? `汇智云 · ${enterpriseName}` : '汇智云'"
          data-host-brand
        >
          <img
            :src="appLogo"
            class="h-7 w-7 shrink-0 object-contain"
            alt="汇智云"
            width="28"
            height="28"
          >
          <template v-if="!sidebarCompact">
            <span class="hidden shrink-0 text-sm font-semibold text-highlighted lg:inline">汇智云</span>
            <span
              v-if="enterpriseName"
              class="hidden min-w-0 truncate text-xs text-toned lg:inline"
              :title="enterpriseName"
            >{{ enterpriseName }}</span>
          </template>
        </NuxtLink>
      </div>
      <div class="flex min-w-0 flex-1 items-center gap-2 px-2 sm:px-4 lg:pr-6 lg:pl-[calc(1.5rem+var(--host-sidebar-peek-offset))]">
        <UButton
          class="shrink-0 lg:hidden"
          color="neutral"
          variant="ghost"
          icon="i-lucide-menu"
          aria-label="打开业务导航"
          @click="drawer = true"
        />
        <NuxtLink
          v-if="editorWorkspace"
          to="/codocs/mydocs"
          class="shrink-0 text-sm text-muted hover:text-default"
          aria-label="返回文档"
        >
          <span
            class="i-lucide-arrow-left inline-block h-4 w-4 sm:hidden"
            aria-hidden="true"
          />
          <span class="hidden sm:inline">返回文档</span>
        </NuxtLink>
        <HostAnnouncements
          v-if="signedIn && config.public.announcementsEnabled"
          :title-visible="pinnedTitle.visible"
        />
        <span
          v-show="pinnedTitle.visible"
          class="min-w-0 truncate text-sm font-semibold text-highlighted transition-opacity duration-150 motion-reduce:transition-none"
          :class="pinnedTitle.visible ? 'opacity-100' : 'opacity-0'"
          :title="pinnedTitle.visible ? pinnedTitle.title : undefined"
          aria-hidden="true"
          data-host-pinned-title
        >{{ pinnedTitle.title }}</span>
      </div>
      <div
        class="flex shrink-0 items-center gap-1 pr-2 sm:gap-2 sm:pr-4"
        data-host-topbar-actions
      >
        <UTooltip
          v-if="signedIn"
          text="我的待办"
        >
          <UButton
            to="/enterprise/todos"
            color="neutral"
            variant="ghost"
            icon="i-lucide-list-todo"
            aria-label="我的待办"
          />
        </UTooltip>
        <UTooltip
          v-if="signedIn"
          text="待办审批"
        >
          <UButton
            to="/enterprise/approvals"
            color="neutral"
            variant="ghost"
            icon="i-lucide-clipboard-check"
            aria-label="待办审批"
          />
        </UTooltip>
        <UButton
          v-if="showWorkflow && !workflowWide"
          color="primary"
          variant="soft"
          icon="i-lucide-git-pull-request"
          aria-label="打开审批流程"
          @click="workflowDrawer = true"
        >
          <span class="hidden sm:inline">审批流程</span>
        </UButton>
        <GlobalFeedbackButton
          v-if="signedIn"
          :identity="`${auth.tenant?.value || ''}:${auth.user.value || ''}`"
          :display-name="displayName"
        />
        <NotificationBell v-if="signedIn" />
        <UBadge
          v-if="nonProduction"
          color="info"
          variant="outline"
          size="sm"
          class="max-w-20 truncate"
          :title="environment"
          data-host-environment
        >
          {{ environment }}
        </UBadge>
        <UDropdownMenu
          v-if="signedIn"
          :items="personalMenu"
        >
          <UButton
            color="neutral"
            variant="ghost"
            trailing-icon="i-lucide-chevron-down"
            :avatar="auth.userAvatar?.value ? { src: auth.userAvatar.value } : undefined"
            :icon="auth.userAvatar?.value ? undefined : 'i-lucide-circle-user'"
            :aria-label="`个人菜单${displayName ? '：' + displayName : ''}`"
          >
            <span class="hidden max-w-32 truncate sm:inline">{{ displayName || '账号' }}</span>
          </UButton>
        </UDropdownMenu>
      </div>
    </header>

    <NotificationsSlideover
      v-if="signedIn"
      view-all-path="/enterprise/notifications"
    />
    <USlideover
      v-if="showWorkflow && !workflowWide"
      v-model:open="workflowDrawer"
      side="right"
      title="审批流程"
      :ui="{ content: 'w-[min(100vw,24rem)]' }"
    >
      <template #body>
        <HostWorkflowPanel />
      </template>
    </USlideover>

    <div class="flex min-h-0 flex-1">
      <nav
        class="relative hidden shrink-0 lg:block"
        :style="{ width: sidebarWidth }"
        aria-label="业务导航"
        @pointerenter="sidebarPeekController.pointerEnter($event.pointerType)"
        @pointerleave="sidebarPeekController.pointerLeave()"
        @focusin="focusSidebar"
        @focusout="blurSidebar"
      >
        <div
          class="flex h-full flex-col border-r border-[var(--host-nav-border)] bg-[var(--host-nav-surface)]"
          :class="sidebarPeek ? 'absolute inset-y-0 left-0 z-30 shadow-lg' : 'relative'"
          :style="{ width: displayedSidebarWidth }"
          data-host-sidebar-panel
        >
          <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <p
              v-if="['idle', 'loading'].includes(navigationAccess.status.value) && !sidebarCompact"
              class="p-2 text-sm text-muted"
              role="status"
            >
              正在加载业务导航…
            </p>
            <div
              v-if="['error', 'expired'].includes(navigationAccess.status.value)"
              class="p-2 text-sm text-muted"
              role="status"
            >
              <p v-if="!sidebarCompact">
                导航权限暂不可用
              </p>
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                aria-label="重新加载导航"
                @click="navigationAccess.refresh()"
              />
            </div>
            <template v-if="objectMode">
              <UPopover
                v-if="sidebarCompact"
                :content="{ side: 'right', align: 'start' }"
              >
                <UButton
                  icon="i-lucide-folder-kanban"
                  :aria-label="`项目导航：${objectMode.label}`"
                  color="neutral"
                  variant="ghost"
                  square
                  class="host-nav-control w-full"
                />
                <template #content>
                  <div class="max-h-[80svh] w-72 overflow-y-auto p-2">
                    <HostObjectNav
                      :model="objectMode"
                      :refresh-projects="projectContext.refreshProjects"
                    />
                  </div>
                </template>
              </UPopover>
              <HostObjectNav
                v-else
                :model="objectMode"
                :refresh-projects="projectContext.refreshProjects"
              />
            </template>
            <template v-else-if="sidebarCompact">
              <template
                v-for="area in [...primary, ...auxiliary].filter(area => area.heading === false)"
                :key="area.id"
              >
                <UButton
                  v-for="group in area.children"
                  :key="group.id"
                  :to="group.children[0]?.to"
                  :icon="group.icon"
                  :aria-label="group.children[0]?.label"
                  :aria-current="activeId === group.children[0]?.id ? 'page' : undefined"
                  color="neutral"
                  variant="ghost"
                  square
                  class="host-nav-control w-full"
                />
              </template>
              <UPopover
                v-for="area in [...primary, ...auxiliary].filter(area => area.heading !== false)"
                :key="area.code"
                mode="click"
                :content="{ side: 'right', align: 'start' }"
              >
                <UButton
                  :icon="area.icon"
                  :aria-label="area.label"
                  color="neutral"
                  variant="ghost"
                  square
                  class="host-nav-control w-full"
                />
                <template #content>
                  <div class="w-60 p-1">
                    <p class="px-2 py-1 text-[11px] font-semibold tracking-wider text-muted">
                      {{ area.label }}
                    </p>
                    <HostNavTree :items="area.children" />
                  </div>
                </template>
              </UPopover>
            </template>
            <template v-else>
              <HostNavSections
                :primary="primary"
                :auxiliary="auxiliary"
              />
            </template>
          </div>
          <div class="border-t border-[var(--host-nav-border)] p-2">
            <UButton
              class="host-nav-control w-full"
              color="neutral"
              variant="ghost"
              :square="sidebarCompact"
              :icon="collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
              :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
              @click="collapsed = !collapsed"
            />
          </div>
          <div
            v-if="!collapsed"
            class="absolute inset-y-0 -right-0.5 w-1 cursor-ew-resize hover:bg-[var(--host-nav-border)]"
            role="separator"
            aria-label="调整侧栏宽度"
            @pointerdown.prevent="startResize"
          />
        </div>
      </nav>

      <USlideover
        v-model:open="drawer"
        side="left"
        title="业务导航"
        :ui="{ content: 'w-72 bg-[var(--host-nav-surface)]' }"
      >
        <template #body>
          <p
            v-if="['idle', 'loading'].includes(navigationAccess.status.value)"
            class="p-2 text-sm text-muted"
            role="status"
          >
            正在加载业务导航…
          </p>
          <div
            v-if="['error', 'expired'].includes(navigationAccess.status.value)"
            class="p-2 text-sm text-muted"
            role="status"
          >
            导航权限暂不可用
            <UButton
              color="neutral"
              variant="ghost"
              label="重试"
              @click="navigationAccess.refresh()"
            />
          </div>
          <HostObjectNav
            v-if="objectMode"
            :model="objectMode"
            :refresh-projects="projectContext.refreshProjects"
          />
          <template v-else>
            <HostNavSections
              :primary="primary"
              :auxiliary="auxiliary"
            />
          </template>
        </template>
      </USlideover>

      <main
        ref="contentViewport"
        class="min-w-0 flex-1 overflow-y-auto"
      >
        <div
          class="host-page-container"
          :data-page-app="route.meta.authorizationApp"
          :data-content-width="route.meta.hostContentWidth"
          :data-editor-workspace="editorWorkspace || undefined"
          :class="contentInsetDisabled ? 'p-0' : 'p-4 sm:p-6'"
        >
          <UAlert
            v-if="authorizationFailed && !employeeReadPermission"
            class="mb-4"
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-alert"
            title="权限信息加载失败"
            description="当前页面的操作权限未能加载，相关操作已暂时停用。请稍后重试。"
            role="alert"
            :actions="[{ label: '重试', color: 'neutral', variant: 'outline', loading: authorizationRetrying, onClick: retryAuthorization }]"
          />
          <CommonEmptyState
            v-if="employeePageDenied || projectEntryDenied"
            icon="i-lucide-lock-keyhole"
            title="无权限访问此页面"
            description="当前账号没有此页面的访问权限。需要使用时，请联系管理员。"
          >
            <UButton
              to="/enterprise"
              color="neutral"
              variant="outline"
            >
              返回工作台
            </UButton>
          </CommonEmptyState>
          <CommonEmptyState
            v-else-if="employeeReadPermission && (!authorization.loaded.value || authorizationFailed)"
            icon="i-lucide-shield-alert"
            :title="authorizationFailed ? '权限信息加载失败' : '正在加载权限'"
            description="权限核验完成前，页面内容与操作暂不显示。"
          >
            <UButton
              v-if="authorizationFailed"
              :loading="authorizationRetrying"
              color="neutral"
              variant="outline"
              @click="retryAuthorization"
            >
              重试
            </UButton>
          </CommonEmptyState>
          <CommonEmptyState
            v-else-if="projectContext.error.value"
            icon="i-lucide-folder-lock"
            title="无法打开项目"
            :description="projectContext.error.value"
          >
            <UButton
              to="/aims/projects"
              color="neutral"
              variant="outline"
            >
              返回项目总览
            </UButton>
            <UButton
              color="primary"
              @click="projectContext.refresh()"
            >
              重试
            </UButton>
          </CommonEmptyState>
          <CommonEmptyState
            v-else-if="projectContext.tabDenied.value"
            icon="i-lucide-shield-alert"
            title="无权访问此项目页签"
            description="当前项目关系或管理范围不允许访问（403）。"
          />
          <div
            v-else-if="projectContext.tabPending.value || (projectContext.active.value && !projectContext.project.value && !projectContext.error.value)"
            role="status"
          >
            正在核对项目访问权限…
          </div>
          <slot v-else />
        </div>
      </main>
      <aside
        v-if="showWorkflow && workflowWide"
        class="w-72 shrink-0 overflow-y-auto border-l border-default bg-default"
        aria-label="审批流程"
      >
        <HostWorkflowPanel />
      </aside>
    </div>
  </div>
</template>
