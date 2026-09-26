<script setup lang="ts">
interface NavItem { label: string, icon?: string, to?: string, children?: NavItem[] }
interface NavArea { code: string, label: string, icon: string, children: NavItem[] }
interface ObjectWorkspace { code: string, label: string, base: string, backTo: string, backLabel: string, groups: { label: string, items: { label: string, path: string }[] }[] }

const { $enterpriseSession } = useNuxtApp()
const route = useRoute()
const auth = useAuth()
const config = useRuntimeConfig()
const nav = (config.public.businessNavigation || {}) as { primary?: NavArea[], auxiliary?: NavArea[] }
const primary = computed(() => nav.primary || [])
const auxiliary = computed(() => nav.auxiliary || [])
const workspaces = (config.public.objectWorkspaces || []) as ObjectWorkspace[]

// A project is long enough to stay inside that the same sidebar becomes its
// object navigation. Switching only changes what the sidebar shows: the shell,
// the session and the area the object belongs to are untouched.
const objectMode = computed(() => {
  for (const workspace of workspaces) {
    const prefix = workspace.base.replace(/:[^/]+$/, '')
    if (!route.path.startsWith(prefix)) continue
    const id = route.path.slice(prefix.length).split('/')[0]
    if (id) return { workspace, objectPath: `${prefix}${id}` }
  }
  return null
})

// The environment badge marks anything that is not production, so a test tenant
// is never mistaken for the real one. Production shows no badge at all.
const environment = computed(() => String(config.public.platformEnvironment || '').trim())
const nonProduction = computed(() => environment.value !== '' && !['production', 'prod'].includes(environment.value.toLowerCase()))
const displayName = computed(() => auth.userRealname?.value || auth.userNickname?.value || auth.user?.value || '')
const enterpriseName = computed(() => String(auth.tenant?.value || '').trim())

// Sidebar width is a preference, kept between the specification's 248–280px.
const width = ref(264)
const collapsed = ref(false)
const drawer = ref(false)
function startResize(event: PointerEvent) {
  const origin = event.clientX
  const start = width.value
  const move = (moved: PointerEvent) => { width.value = Math.min(280, Math.max(248, start + moved.clientX - origin)) }
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}

// Selecting a page closes the drawer so it never covers the content it opened.
watch(() => route.path, () => { drawer.value = false })
</script>

<template>
  <div class="flex h-svh flex-col bg-default">
    <!-- The one public top bar. Brand, enterprise and environment on the left,
         the personal menu on the right; the Host has no second application
         header and no second way out. -->
    <header class="flex h-14 shrink-0 items-center gap-3 border-b border-default px-4">
      <UButton
        class="lg:hidden"
        color="neutral"
        variant="ghost"
        icon="i-lucide-menu"
        aria-label="打开业务导航"
        @click="drawer = true"
      />
      <NuxtLink to="/" class="flex items-center gap-2 font-semibold text-highlighted">
        <UIcon name="i-lucide-box" class="size-5 shrink-0 text-primary" />
        <span>汇智云</span>
      </NuxtLink>
      <span v-if="enterpriseName" class="hidden truncate text-[13px] text-muted sm:inline">{{ enterpriseName }}</span>
      <UBadge v-if="nonProduction" color="info" variant="outline" size="sm">{{ environment }}</UBadge>
      <UDropdownMenu
        class="ml-auto"
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
    </header>

    <div class="flex min-h-0 flex-1">
      <nav
        class="relative hidden shrink-0 border-r border-default bg-muted lg:flex lg:flex-col"
        :style="collapsed ? 'width:56px' : `width:${width}px`"
        aria-label="业务导航"
      >
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <template v-if="collapsed">
            <UPopover v-for="area in [...primary, ...auxiliary]" :key="area.code" mode="click" :content="{ side: 'right', align: 'start' }">
              <UButton :icon="area.icon" :aria-label="area.label" color="neutral" variant="ghost" square class="w-full" />
              <template #content>
                <div class="w-60 p-1">
                  <p class="px-2 py-1 text-[11px] font-semibold tracking-wider text-muted">{{ area.label }}</p>
                  <HostNavTree :items="area.children" />
                </div>
              </template>
            </UPopover>
          </template>
          <template v-else-if="objectMode">
            <HostObjectNav :workspace="objectMode.workspace" :object-path="objectMode.objectPath" />
          </template>
          <template v-else>
            <HostNavSections :primary="primary" :auxiliary="auxiliary" />
          </template>
        </div>
        <div class="border-t border-default p-2">
          <UButton
            class="w-full"
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
          class="absolute inset-y-0 -right-0.5 w-1 cursor-ew-resize hover:bg-accented"
          role="separator"
          aria-label="调整侧栏宽度"
          @pointerdown.prevent="startResize"
        />
      </nav>

      <USlideover v-model:open="drawer" side="left" title="业务导航" :ui="{ content: 'w-72' }">
        <template #body>
          <HostObjectNav v-if="objectMode" :workspace="objectMode.workspace" :object-path="objectMode.objectPath" />
          <template v-else>
            <HostNavSections :primary="primary" :auxiliary="auxiliary" />
          </template>
        </template>
      </USlideover>

      <main class="min-w-0 flex-1 overflow-y-auto">
        <div class="px-4 py-4 sm:px-6">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>
