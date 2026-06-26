<script setup lang="ts">
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
// WorkflowLaunchPayload type used by WorkflowPanel via auto-import

const props = withDefaults(defineProps<{
  appNavigation?: 'rail' | 'popover' | 'none'
  appTitle?: string
  primaryLinks?: Array<Record<string, unknown>>
  utilityLinks?: Array<Record<string, unknown>>
  refreshHandler?: () => void
}>(), {
  appNavigation: 'rail'
})

const open = ref(false)

const { isSidebarCollapsed, userPinnedCollapsed, toggleSidebarCollapsed } = useDashboard()
const sidebarLayoutState = useCookie<{ size?: number, collapsed?: boolean } | null>('dashboard-sidebar-hzy')

const SIDEBAR_COLLAPSED_WIDTH_REM = 4.375
const SIDEBAR_PREVIEW_OPEN_DELAY = 80
const SIDEBAR_PREVIEW_CLOSE_DELAY = 120

const sidebarPreviewWidthRem = computed(() => {
  const storedSize = Number(sidebarLayoutState.value?.size)
  if (Number.isFinite(storedSize) && storedSize > SIDEBAR_COLLAPSED_WIDTH_REM) {
    return storedSize
  }
  return 15
})

// Hover 展开侧边栏
const hoverExpanded = ref(false)
const sidebarHovering = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

const onSidebarEnter = () => {
  if (!isSidebarCollapsed.value) return
  sidebarHovering.value = true
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    hoverExpanded.value = true
    hoverTimer = null
  }, SIDEBAR_PREVIEW_OPEN_DELAY)
}

const onSidebarLeave = () => {
  sidebarHovering.value = false
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    hoverExpanded.value = false
    hoverTimer = null
  }, SIDEBAR_PREVIEW_CLOSE_DELAY)
}

onBeforeUnmount(() => {
  if (hoverTimer) clearTimeout(hoverTimer)
})

watch(isSidebarCollapsed, (collapsed) => {
  if (collapsed) return
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  hoverExpanded.value = false
  sidebarHovering.value = false
})

const isSidebarPreviewActive = computed(() => {
  return isSidebarCollapsed.value && hoverExpanded.value
})

const isSidebarHoverPreviewActive = computed(() => {
  return isSidebarCollapsed.value && hoverExpanded.value
})

const isSidebarVisualCollapsed = computed(() => {
  return isSidebarCollapsed.value && !hoverExpanded.value
})

const isSidebarMenuOverlayEnabled = computed(() => {
  return isSidebarVisualCollapsed.value && !sidebarHovering.value
})

const sidebarRootClass = computed(() => {
  return isSidebarPreviewActive.value ? 'z-50' : 'z-10'
})

const sidebarShellClass = computed(() => {
  if (isSidebarDrawerMode.value || !isSidebarCollapsed.value) {
    return 'relative w-full bg-default'
  }
  if (isSidebarPreviewActive.value) {
    return 'absolute inset-y-0 left-0 z-50 bg-default/96 border-r border-default backdrop-blur-md'
  }
  return 'relative w-full bg-elevated/20'
})

const sidebarShellStyle = computed(() => {
  if (!isSidebarPreviewActive.value) return undefined
  return { width: `${sidebarPreviewWidthRem.value}rem` }
})

const sidebarDrawerStyle = computed(() => ({
  '--sidebar-drawer-width': `${sidebarPreviewWidthRem.value}rem`
}))

const navigationUi = computed(() => {
  if (!isSidebarContentCollapsed.value) {
    return {
      root: 'gap-1',
      list: 'space-y-0.5',
      label: 'pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-dimmed',
      item: 'pl-3 pr-4',
      link: 'min-h-10 rounded-xl px-2 before:rounded-xl',
      linkLeadingIcon: 'ms-1.5 size-5 text-dimmed',
      linkTrailingIcon: 'size-4 text-dimmed',
      childList: 'mt-1 space-y-0.5 border-default/70',
      childItem: 'ps-1.5',
      childLink: 'min-h-9 rounded-lg px-2 py-1.5 before:rounded-lg',
      childLinkIcon: 'ms-1 text-dimmed'
    }
  }
  return {
    root: 'items-center gap-0.5',
    list: 'w-full',
    item: 'flex justify-center px-0.5',
    link: 'size-9 justify-center p-0 before:rounded-xl',
    linkLeadingIcon: 'mx-auto size-5',
    content: 'min-w-12'
  }
})

function toggleSidebarCollapse() {
  toggleSidebarCollapsed()
}

const pub = (useRuntimeConfig().public || {}) as Record<string, unknown>
const currentAppCode = String(pub.appCode || pub.appName || '')
const autoExpandBreakpoint = currentAppCode === 'workflow' ? 'lg' : 'xl'
const sidebarDrawerBreakpoint = 'sm'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isSidebarDrawerMode = breakpoints.smaller(sidebarDrawerBreakpoint)
const greaterOrEqualAutoExpand = breakpoints.greaterOrEqual(autoExpandBreakpoint)
const showAppRail = computed(() => props.appNavigation === 'rail' && !isSidebarDrawerMode.value)
const showAppLauncher = computed(() => props.appNavigation !== 'none')
const isSidebarContentCollapsed = computed(() => {
  return !isSidebarDrawerMode.value && isSidebarVisualCollapsed.value
})
const isSidebarContentPreviewActive = computed(() => {
  return !isSidebarDrawerMode.value && isSidebarPreviewActive.value
})

// 没有用户偏好时根据屏幕宽度自动调整
if (import.meta.client && !userPinnedCollapsed.value) {
  isSidebarCollapsed.value = !greaterOrEqualAutoExpand.value
}

onMounted(() => {
  watch(greaterOrEqualAutoExpand, (isExpandedLayout) => {
    if (userPinnedCollapsed.value) return
    isSidebarCollapsed.value = !isExpandedLayout
  })
})

// 处理导航错误
const router = useRouter()
const route = useRoute()

router.onError((error) => {
  if (error.message?.includes('parentNode')
    || error.message?.includes('Cannot read properties of null')) {
    console.warn('[Navigation Error Suppressed]', error.message)
    return
  }
  throw error
})

onErrorCaptured((err: Error) => {
  if (err.message?.includes('parentNode')
    || err.message?.includes('Cannot read properties of null')) {
    console.warn('[Navigation Error Suppressed]', err.message)
    return false
  }
  return true
})

const { appName, appLogo } = useAppInfo()
const displayAppName = computed(() => props.appTitle || appName.value)

// 审批模式
const { isApprovalMode, approvalTaskId, approvalInstanceId, exitApprovalMode } = useApprovalMode()

// 页面级流程声明（多动作模式）
const pageWorkflow = (() => {
  try {
    return usePageWorkflowState?.() || null
  } catch {
    return null
  }
})()

const hasPageWorkflow = computed(() => pageWorkflow?.hasPageWorkflow.value ?? false)
const hasMultipleActions = computed(() => pageWorkflow?.hasMultipleActions.value ?? false)
const pageWorkflowActions = computed(() => pageWorkflow?.actions.value ?? [])
const pageWorkflowSelectedIndex = computed(() => pageWorkflow?.selectedIndex.value ?? 0)
const pageWorkflowPayload = computed(() => pageWorkflow?.launchPayload.value ?? null)
const pageWorkflowCanSubmit = computed(() => pageWorkflow?.canSubmit.value ?? false)
const pageWorkflowIssues = computed(() => pageWorkflow?.completenessIssues.value ?? [])
// beforeSubmit 已经是稳定函数引用，直接取用
const pageWorkflowBeforeSubmit = pageWorkflow?.beforeSubmit
const pageWorkflowActiveInstance = computed(() => pageWorkflow?.activeInstance.value ?? null)

// 进入审批模式时自动折叠侧边栏，退出时恢复
const sidebarCollapsedBeforeApproval = ref<boolean | null>(null)

watch(isApprovalMode, (entering) => {
  if (entering) {
    // 记住当前状态并折叠
    sidebarCollapsedBeforeApproval.value = isSidebarCollapsed.value
    if (!isSidebarCollapsed.value) {
      isSidebarCollapsed.value = true
    }
  } else {
    // 恢复之前的状态
    if (sidebarCollapsedBeforeApproval.value === false) {
      isSidebarCollapsed.value = false
    }
    sidebarCollapsedBeforeApproval.value = null
  }
}, { immediate: true })

watch(() => route.path, (path) => {
  if (path === '/approval/tasks' && isApprovalMode.value) {
    exitApprovalMode()
  }
}, { immediate: true })

// 审批中心入口：查询待办数量，决定是否显示
const showApprovalEntry = ref(false)
const pendingCount = ref(0)

// workflow 模块不自动注入（它有自己的导航）
if (currentAppCode && currentAppCode !== 'workflow' && import.meta.client) {
  onMounted(async () => {
    try {
      const res = await $fetch<{ code: number, data: { total: number } }>('/api/workflow-proxy/tasks/pending', {
        params: { page_size: 1 }
      })
      if (res.code === 0) {
        pendingCount.value = res.data.total
        showApprovalEntry.value = true
      }
    } catch {
      // Workflow 不可达，不显示审批中心入口
    }
  })
}

function handleApprovalDone() {
  exitApprovalMode()
  navigateTo('/approval/tasks')
}

function handleExitApproval() {
  exitApprovalMode()
  navigateTo('/approval/tasks')
}

function resetSidebarTransientState() {
  open.value = false
  hoverExpanded.value = false
  sidebarHovering.value = false
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
}

function handleApprovalEntryClick() {
  resetSidebarTransientState()
  exitApprovalMode()
  navigateTo('/approval/tasks')
}

// 页面标题 & 操作
const pageTitle = ref('')
const sharedPageTitle = usePageTitle()

// 优先使用 usePageTitle，其次兼容 layoutHeaderTitle / title 路由元数据
watchEffect(() => {
  pageTitle.value = sharedPageTitle.value
    || (route.meta.layoutHeaderTitle as string)
    || (route.meta.title as string)
    || ''
})

// 暴露给 slot 的 props
const slotProps = computed(() => ({
  collapsed: isSidebarContentCollapsed.value,
  menuOverlayEnabled: !isSidebarDrawerMode.value && isSidebarMenuOverlayEnabled.value,
  navigationUi: navigationUi.value,
  currentAppCode
}))
</script>

<template>
  <slot name="app-rail" v-bind="{ currentAppCode }">
    <AppRail
      v-if="showAppRail"
      :current-app-code="currentAppCode"
    />
  </slot>

  <UDashboardSidebar
    id="hzy"
    v-model:open="open"
    v-model:collapsed="isSidebarCollapsed"
    collapsible
    :collapsed-size="SIDEBAR_COLLAPSED_WIDTH_REM"
    resizable
    :class="sidebarRootClass"
    :style="sidebarDrawerStyle"
    :ui="{ root: 'relative overflow-visible border-0 bg-transparent', body: 'overflow-hidden p-0', content: 'p-0 w-(--sidebar-drawer-width) max-w-[calc(100vw-2rem)]' }"
    @mouseenter="onSidebarEnter"
    @mouseleave="onSidebarLeave"
  >
    <template #default>
      <div
        class="sidebar-preview-shell flex h-full min-h-0 flex-col bg-default transition-[width,background-color,opacity,transform] duration-200 ease-out"
        :class="[sidebarShellClass, (!isSidebarDrawerMode && !open && !isSidebarPreviewActive) ? 'border-r border-default' : '']"
        :data-hover-preview-active="isSidebarHoverPreviewActive"
        :style="sidebarShellStyle"
        :data-preview-active="isSidebarContentPreviewActive"
      >
        <!-- Sidebar Header: Logo -->
        <div
          class="flex h-[46px] items-center border-b border-default pl-3 pr-3 sm:pl-5 sm:pr-5"
        >
          <NuxtLink
            to="/"
            class="flex flex-1 min-w-0 items-center gap-3 overflow-hidden"
          >
            <img
              :src="appLogo"
              class="h-7 w-7 shrink-0 object-contain"
              :alt="displayAppName"
            >
            <span
              class="truncate font-semibold text-lg transition-[max-width,opacity] duration-200 ease-out"
              :class="isSidebarContentCollapsed ? 'max-w-0 opacity-0' : 'max-w-[14rem] opacity-100'"
            >
              {{ displayAppName }}
            </span>
          </NuxtLink>
        </div>

        <!-- Sidebar Content: 菜单区域 -->
        <div class="flex flex-1 min-h-0 flex-col overflow-hidden">
          <!-- 主菜单（可滚动，避免挤掉底部工具菜单） -->
          <div class="min-h-0 shrink overflow-y-auto pt-2">
            <slot name="menu" v-bind="slotProps">
              <UNavigationMenu
                v-if="primaryLinks?.length"
                :collapsed="slotProps.collapsed"
                :items="primaryLinks"
                orientation="vertical"
                :tooltip="slotProps.menuOverlayEnabled"
                :popover="slotProps.menuOverlayEnabled"
                :ui="slotProps.navigationUi"
              />
            </slot>
          </div>

          <!-- 额外内容区域（独立滚动，如项目列表） -->
          <div class="min-h-0 flex-1 overflow-y-auto">
            <slot name="extra" v-bind="slotProps" />
          </div>

          <!-- 底部工具菜单（固定不滚动） -->
          <div class="shrink-0 py-1.5 border-t border-default">
            <slot name="utility" v-bind="slotProps">
              <UNavigationMenu
                v-if="utilityLinks?.length"
                :collapsed="slotProps.collapsed"
                :items="utilityLinks"
                orientation="vertical"
                :tooltip="slotProps.menuOverlayEnabled"
                :popover="slotProps.menuOverlayEnabled"
                :ui="slotProps.navigationUi"
              />
            </slot>

            <!-- 审批中心入口（自动注入） -->
            <div v-if="showApprovalEntry" class="mt-1">
              <div :class="isSidebarContentCollapsed ? 'flex justify-center px-0.5' : 'pl-3 pr-4'">
                <button
                  type="button"
                  class="group relative flex items-center rounded-xl text-sm text-default transition-colors hover:bg-elevated/60"
                  :class="[
                    isSidebarContentCollapsed ? 'size-9 justify-center p-0' : 'min-h-10 w-full px-2',
                    route.path === '/approval/tasks' ? 'bg-primary/10 text-primary font-medium' : ''
                  ]"
                  :aria-current="route.path === '/approval/tasks' ? 'page' : undefined"
                  @click="handleApprovalEntryClick"
                >
                  <div class="relative">
                    <UIcon
                      name="i-lucide-clipboard-check"
                      class="size-5 shrink-0"
                      :class="isSidebarContentCollapsed ? 'mx-auto text-dimmed' : 'ms-1.5 text-dimmed'"
                    />
                    <span
                      v-if="pendingCount > 0"
                      class="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-error text-[10px] font-bold text-white"
                    >
                      {{ pendingCount > 9 ? '9+' : pendingCount }}
                    </span>
                  </div>
                  <span
                    v-if="!isSidebarContentCollapsed"
                    class="truncate ps-2"
                  >
                    审批中心
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Sidebar Footer: 折叠按钮 -->
        <div class="relative h-12 shrink-0 border-t border-default py-1">
          <button
            type="button"
            class="absolute inset-y-1 rounded-xl text-default transition-colors hover:bg-elevated active:bg-elevated"
            :class="isSidebarContentCollapsed ? 'left-1/2 w-9 -translate-x-1/2 px-0' : 'inset-x-1 px-3'"
            :aria-label="isSidebarCollapsed ? '打开侧边栏' : '收起侧边栏'"
            @click="toggleSidebarCollapse"
          >
            <span
              class="absolute inset-y-0 flex items-center"
              :class="isSidebarContentCollapsed ? 'inset-x-0 justify-center px-0 -translate-x-px' : 'px-1.5 translate-x-0.5'"
            >
              <UIcon
                :name="isSidebarCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
                class="size-5 shrink-0 text-dimmed"
              />
            </span>

            <span
              class="right-4 flex items-center overflow-hidden px-8 text-sm font-medium transition-opacity duration-150"
              :class="isSidebarContentCollapsed ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'"
            >
              <span class="truncate">
                {{ isSidebarCollapsed ? '打开侧边栏' : '收起侧边栏' }}
              </span>
            </span>
          </button>
        </div>
      </div>
    </template>
  </UDashboardSidebar>

  <!-- 右侧主内容区 -->
  <div class="flex min-w-0 min-h-0 flex-1 flex-col bg-default h-svh overflow-hidden">
    <!-- 顶部导航栏：左侧 slot + 右侧 AppLauncher & UserMenu -->
    <UDashboardNavbar
      class="border-b border-default bg-default"
      :ui="{ root: 'h-[46px]', left: 'min-w-0 flex-1', right: 'flex items-center gap-2' }"
    >
      <template #left>
        <!-- 审批模式提示 -->
        <div v-if="isApprovalMode" class="flex items-center gap-2 px-2">
          <UButton
            icon="i-lucide-arrow-left"
            label="返回审批中心"
            color="warning"
            variant="ghost"
            size="sm"
            @click="handleExitApproval"
          />
          <USeparator orientation="vertical" class="h-5" />
          <span class="text-base text-warning font-medium">审批模式</span>
        </div>
        <slot v-else name="navbar-left">
          <h1 v-if="pageTitle" class="truncate text-base font-semibold">
            {{ pageTitle }}
          </h1>
        </slot>
      </template>

      <template #right>
        <slot name="navbar-right">
          <UButton
            v-if="refreshHandler"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            square
            @click="refreshHandler?.()"
          />
        </slot>
        <NotificationBell />
        <AppLauncher v-if="showAppLauncher" />
        <UserMenu header />
      </template>
    </UDashboardNavbar>

    <!-- 页面内容 + 审批面板 -->
    <div class="flex min-h-0 flex-1 overflow-hidden bg-default">
      <!-- 主内容区 -->
      <div class="flex flex-col min-w-0 flex-1 overflow-hidden">
        <slot />
      </div>

      <!-- 右侧 WorkflowPanel：审批模式 或 页面流程模式 -->
      <div
        v-if="isApprovalMode || hasPageWorkflow"
        class="w-54 shrink-0 border-l border-default overflow-y-auto"
      >
        <!-- 审批模式 -->
        <WorkflowPanel
          v-if="approvalTaskId"
          :task-id="approvalTaskId"
          @approved="handleApprovalDone"
          @rejected="handleApprovalDone"
        />
        <WorkflowPanel
          v-else-if="approvalInstanceId"
          :instance-id="approvalInstanceId"
        />
        <!-- 页面流程模式 -->
        <template v-else-if="hasPageWorkflow">
          <!-- 多动作选择器 -->
          <div v-if="hasMultipleActions" class="shrink-0 border-b border-default px-3 py-2">
            <div class="flex flex-wrap gap-1">
              <UButton
                v-for="(action, idx) in pageWorkflowActions"
                :key="action.actionCode"
                size="xs"
                :variant="pageWorkflowSelectedIndex === idx ? 'solid' : 'ghost'"
                :color="pageWorkflowSelectedIndex === idx ? 'primary' : 'neutral'"
                :icon="action.icon"
                :disabled="!!pageWorkflowActiveInstance && pageWorkflowActiveInstance.actionCode !== action.actionCode"
                @click="pageWorkflow?.selectAction(idx)"
              >
                {{ action.actionName }}
              </UButton>
            </div>
          </div>
          <!-- WorkflowPanel -->
          <WorkflowPanel
            v-if="pageWorkflowPayload"
            :key="pageWorkflowPayload.actionCode"
            :launch-payload="pageWorkflowPayload"
            :can-submit="pageWorkflowCanSubmit"
            :completeness-issues="pageWorkflowIssues"
            :before-submit="pageWorkflowBeforeSubmit"
            @instance-found="(p: { found: boolean, status?: string }) => pageWorkflow?.setInstanceFound(p)"
            @submitted="(p: { instanceId: number }) => pageWorkflow?.onSubmitted(p)"
            @approved="(p: { taskId: number, instanceId: number, instanceStatus?: string }) => { if (p.instanceStatus === 'approved') pageWorkflow?.onApproved(p) }"
            @rejected="(p: { taskId: number, instanceId: number }) => pageWorkflow?.onRejected(p)"
          />
        </template>
      </div>
    </div>
  </div>

  <NotificationsSlideover />

  <IssueReporter />
</template>

<style scoped>
.sidebar-preview-shell[data-preview-active="true"]::after {
  content: '';
  position: absolute;
  top: 0;
  right: -1px;
  bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.08));
  pointer-events: none;
}

.sidebar-preview-shell[data-hover-preview-active="true"] {
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.16);
}

:global(.dark) .sidebar-preview-shell[data-hover-preview-active="true"] {
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
}

:global(.dark) .sidebar-preview-shell[data-preview-active="true"]::after {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.04));
}
</style>
