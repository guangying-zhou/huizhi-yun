<script setup lang="ts">
import HostNavSections from '../components/HostNavSections.vue'
import HostNavTree from '../components/HostNavTree.vue'
import HostObjectNav from '../components/HostObjectNav.vue'
import HostWorkflowPanel from '../components/HostWorkflowPanel.vue'
import { selectActiveLeaf } from '../utils/navigation-active.mjs'

const { $enterpriseSession } = useNuxtApp()
const route = useRoute()
const editorWorkspace = computed(() => /^\/codocs\/documents\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(route.path))
const auth = useAuth()
const config = useRuntimeConfig()
const navigationAccess = useEnterpriseNavigationAccess()
const businessNavigation = navigationAccess.navigation
const primary = computed(() => businessNavigation.value.primary || [])
const auxiliary = computed(() => businessNavigation.value.auxiliary || [])
const workspaces = navigationAccess.workspaces
const preferredId = ref('')
const visibleTree = computed(() => [...primary.value, ...auxiliary.value])
provide('enterprise-navigation-context', {
  visibleTree,
  activeId: computed(() => selectActiveLeaf(visibleTree.value, route.path, preferredId.value)),
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
const enterpriseName = computed(() => String(auth.tenant?.value || '').trim())
const signedIn = computed(() => auth.authenticated.value)
const workflow = usePageWorkflowState()
const workflowWide = useMediaQuery('(min-width: 1280px)')
const workflowDrawer = ref(false)
const hostedCompletionPage = computed(() => /^\/aims\/projects\/[1-9]\d*\/board\/[1-9]\d*\/execution$/u.test(route.path))
const showWorkflow = computed(() => config.public.hostWorkflowEnabled === true && signedIn.value && hostedCompletionPage.value && workflow.hasPageWorkflow.value)

// The selected design starts at 224px and permits a modest desktop adjustment.
const width = ref(224)
const collapsed = ref(false)
const drawer = ref(false)
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
watch(() => route.path, () => {
  drawer.value = false
  workflowDrawer.value = false
})
</script>

<template>
  <div class="flex h-svh flex-col bg-default">
    <!-- The one public top bar. Brand, enterprise and environment on the left,
         the personal menu on the right; the Host has no second application
         header and no second way out. -->
    <header class="flex h-14 shrink-0 items-center gap-3 border-b border-default bg-default px-4">
      <UButton
        class="lg:hidden"
        color="neutral"
        variant="ghost"
        icon="i-lucide-menu"
        aria-label="打开业务导航"
        @click="drawer = true"
      />
      <NuxtLink to="/enterprise" class="host-nav-control flex items-center gap-2 rounded-md font-semibold text-highlighted">
        <img
          :src="appLogo"
          class="h-7 w-7 shrink-0 object-contain"
          alt="汇智云"
          width="28"
          height="28"
        >
        <span>汇智云</span>
      </NuxtLink>
      <NuxtLink v-if="editorWorkspace" to="/codocs/mydocs" class="shrink-0 text-sm text-muted hover:text-default" aria-label="返回文档">
        <span class="i-lucide-arrow-left inline-block h-4 w-4 sm:hidden" aria-hidden="true" />
        <span class="hidden sm:inline">返回文档</span>
      </NuxtLink>
      <span v-if="enterpriseName" class="hidden max-w-44 truncate rounded-md border border-default px-2.5 py-1 text-[13px] text-toned sm:inline">{{ enterpriseName }}</span>
      <UBadge v-if="nonProduction" color="info" variant="outline" size="sm">
        {{ environment }}
      </UBadge>
      <div class="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <UButton
          v-if="signedIn"
          to="/enterprise/approvals"
          color="neutral"
          variant="ghost"
          icon="i-lucide-list-checks"
          aria-label="待办审批"
        >
          <span class="hidden sm:inline">待办审批</span>
        </UButton>
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
        <NotificationBell v-if="signedIn" />
        <UDropdownMenu
          :items="[[{ label: '退出登录', icon: 'i-lucide-log-out', onSelect: () => $enterpriseSession.logout() }]]"
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

    <NotificationsSlideover v-if="signedIn" />
    <USlideover v-if="showWorkflow && !workflowWide" v-model:open="workflowDrawer" side="right" title="审批流程" :ui="{ content: 'w-[min(100vw,24rem)]' }">
      <template #body>
        <HostWorkflowPanel />
      </template>
    </USlideover>

    <div class="flex min-h-0 flex-1">
      <nav
        class="relative hidden shrink-0 border-r border-[var(--host-nav-border)] bg-[var(--host-nav-surface)] lg:flex lg:flex-col"
        :style="collapsed ? 'width:56px' : `width:${width}px`"
        aria-label="业务导航"
      >
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <p v-if="['idle', 'loading'].includes(navigationAccess.status.value) && !collapsed" class="p-2 text-sm text-muted" role="status">
            正在加载业务导航…
          </p>
          <div v-if="['error', 'expired'].includes(navigationAccess.status.value)" class="p-2 text-sm text-muted" role="status">
            <p v-if="!collapsed">
              导航权限暂不可用
            </p>
            <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" aria-label="重新加载导航" @click="navigationAccess.refresh()" />
          </div>
          <template v-if="objectMode">
            <UPopover v-if="collapsed" :content="{ side: 'right', align: 'start' }">
              <UButton icon="i-lucide-folder-kanban" :aria-label="`项目导航：${objectMode.label}`" color="neutral" variant="ghost" square class="host-nav-control w-full" />
              <template #content>
                <div class="max-h-[80svh] w-72 overflow-y-auto p-2">
                  <HostObjectNav :model="objectMode" :refresh-projects="projectContext.refreshProjects" />
                </div>
              </template>
            </UPopover>
            <HostObjectNav v-else :model="objectMode" :refresh-projects="projectContext.refreshProjects" />
          </template>
          <template v-else-if="collapsed">
            <UPopover v-for="area in [...primary, ...auxiliary]" :key="area.code" mode="click" :content="{ side: 'right', align: 'start' }">
              <UButton :icon="area.icon" :aria-label="area.label" color="neutral" variant="ghost" square class="host-nav-control w-full" />
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
            <HostNavSections :primary="primary" :auxiliary="auxiliary" />
          </template>
        </div>
        <div class="border-t border-[var(--host-nav-border)] p-2">
          <UButton
            class="host-nav-control w-full"
            color="neutral"
            variant="ghost"
            :square="collapsed"
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
      </nav>

      <USlideover v-model:open="drawer" side="left" title="业务导航" :ui="{ content: 'w-72 bg-[var(--host-nav-surface)]' }">
        <template #body>
          <p v-if="['idle', 'loading'].includes(navigationAccess.status.value)" class="p-2 text-sm text-muted" role="status">
            正在加载业务导航…
          </p>
          <div v-if="['error', 'expired'].includes(navigationAccess.status.value)" class="p-2 text-sm text-muted" role="status">
            导航权限暂不可用
            <UButton color="neutral" variant="ghost" label="重试" @click="navigationAccess.refresh()" />
          </div>
          <HostObjectNav v-if="objectMode" :model="objectMode" :refresh-projects="projectContext.refreshProjects" />
          <template v-else>
            <HostNavSections :primary="primary" :auxiliary="auxiliary" />
          </template>
        </template>
      </USlideover>

      <main class="min-w-0 flex-1 overflow-y-auto">
        <div :class="editorWorkspace ? 'p-0' : 'px-4 py-4 sm:px-6'">
          <slot />
        </div>
      </main>
      <aside v-if="showWorkflow && workflowWide" class="w-72 shrink-0 overflow-y-auto border-l border-default bg-default" aria-label="审批流程">
        <HostWorkflowPanel />
      </aside>
    </div>
  </div>
</template>
