<script setup lang="ts">
/**
 * 侧边栏 Hover 浮层菜单
 *
 * 收起状态下鼠标悬停时弹出完整菜单，浮在内容上方。
 * 通过 appCode 自动从 Platform 应用清单获取应用名和图标。
 *
 * Props:
 *  - show: 是否显示
 *  - links: 菜单分组数组
 *  - appCode: 应用编码（自动获取名称和图标）
 */

interface AppInfo {
  appCode: string
  appName: string
  icon: string | null
}

const props = defineProps<{
  show: boolean
  links: Record<string, unknown>[][]
  appCode: string
}>()

const emit = defineEmits<{
  leave: []
}>()

const appInfo = ref<AppInfo | null>(null)

const loadAppInfo = async () => {
  if (appInfo.value) return
  try {
    const res = await $fetch<{ code: number, data: AppInfo[] }>('/api/user/applications')
    const app = (res.data || []).find(a => a.appCode === props.appCode)
    if (app) appInfo.value = app
  } catch {
    // 静默
  }
}

// 显示时加载
watch(() => props.show, (val) => {
  if (val && !appInfo.value) loadAppInfo()
}, { immediate: true })

// 首次 mount 也尝试加载
onMounted(loadAppInfo)

const displayName = computed(() => appInfo.value?.appName || props.appCode)
const appIcon = computed(() => appInfo.value?.icon || 'i-lucide-route')
const isIconName = computed(() => appIcon.value.startsWith('i-'))
</script>

<template>
  <Teleport to="body">
    <Transition name="sidebar-hover-slide">
      <div
        v-if="show"
        class="sidebar-hover-overlay"
        @mouseleave="emit('leave')"
      >
        <div class="sidebar-hover-panel">
          <!-- Header -->
          <div class="flex items-center gap-2 px-3 py-2 border-b border-default">
            <NuxtLink to="/" class="flex items-center gap-2">
              <UIcon
                v-if="isIconName"
                :name="appIcon"
                class="size-5 text-primary"
              />
              <img
                v-else
                :src="appIcon"
                class="h-5 w-auto"
                :alt="displayName"
              >
              <span class="font-semibold text-base">{{ displayName }}</span>
            </NuxtLink>
          </div>
          <!-- 菜单 -->
          <div class="flex-1 overflow-y-auto">
            <UNavigationMenu
              v-for="(group, idx) in links"
              :key="idx"
              :items="group"
              orientation="vertical"
              :class="idx === links.length - 1 ? 'mt-auto' : ''"
            />
          </div>
          <!-- Footer -->
          <div class="border-t border-default py-1">
            <UserMenu :collapsed="false" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.sidebar-hover-overlay {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 9999;
  width: 16rem;
}

.sidebar-hover-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ui-bg-elevated);
  border-right: 1px solid var(--ui-border);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.12);
}

.dark .sidebar-hover-panel {
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
}

.sidebar-hover-slide-enter-active {
  transition: transform 0.15s ease-out, opacity 0.15s ease-out;
}
.sidebar-hover-slide-leave-active {
  transition: transform 0.1s ease-in, opacity 0.1s ease-in;
}
.sidebar-hover-slide-enter-from,
.sidebar-hover-slide-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}
</style>
