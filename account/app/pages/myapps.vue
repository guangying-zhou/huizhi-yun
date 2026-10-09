<script setup lang="ts">
import { ref, onMounted } from 'vue'

usePageTitle('我的应用')

interface UserApp {
  appCode: string
  appName: string
  description: string | null
  icon: string | null
  homeUrl: string | null
  appType: string
}

interface ApiResponse<T> {
  code?: number
  message?: string
  data: T
}

type BadgeColor = 'error' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'neutral'

const toast = useToast()
const loading = ref(true)
const apps = ref<UserApp[]>([])

const appTypeColors: Record<string, BadgeColor> = {
  internal: 'primary',
  external: 'neutral'
}

async function loadApps() {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<UserApp[]>>('/api/user/applications')
    apps.value = res.data || []
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '加载应用失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

function openApp(app: UserApp) {
  if (app.homeUrl) {
    window.open(app.homeUrl, '_blank')
  }
}

onMounted(() => {
  loadApps()
})
</script>

<template>
  <UDashboardPanel>
    <UDashboardPage>
      <UPageBody>
        <!-- 加载中 -->
        <div v-if="loading" class="flex items-center justify-center py-20">
          <UIcon name="i-lucide-loader-2" class="w-8 h-8 text-gray-400 animate-spin" />
        </div>

        <!-- 无应用 -->
        <div v-else-if="apps.length === 0" class="flex flex-col items-center justify-center py-20">
          <UIcon name="i-lucide-box" class="w-12 h-12 text-gray-400 mb-4" />
          <h3 class="text-lg font-medium text-gray-900 dark:text-white">
            暂无可访问的应用
          </h3>
          <p class="text-gray-500 mt-2">
            请联系管理员分配应用权限
          </p>
        </div>

        <!-- 应用卡片网格 -->
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
          <UCard
            v-for="app in apps"
            :key="app.appCode"
            class="cursor-pointer transition-shadow hover:shadow-lg"
            :class="{ 'opacity-60 cursor-not-allowed': !app.homeUrl }"
            @click="openApp(app)"
          >
            <div class="flex items-start gap-3">
              <div class="shrink-0 w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <img
                  v-if="app.icon"
                  :src="app.icon"
                  class="w-8 h-8 rounded"
                  :alt="app.appName"
                >
                <UIcon v-else name="i-lucide-box" class="w-6 h-6 text-gray-400" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h4 class="font-medium text-gray-900 dark:text-white truncate">
                    {{ app.appName }}
                  </h4>
                  <UBadge :color="appTypeColors[app.appType] || 'neutral'" variant="subtle" size="xs">
                    {{ app.appType === 'internal' ? '内部' : '外部' }}
                  </UBadge>
                </div>
                <p class="text-sm text-gray-500 mt-1 line-clamp-2">
                  {{ app.description || '暂无描述' }}
                </p>
              </div>
            </div>
            <div v-if="app.homeUrl" class="mt-3 flex items-center text-xs text-gray-400">
              <UIcon name="i-lucide-external-link" class="w-3 h-3 mr-1" />
              <span class="truncate">{{ app.homeUrl }}</span>
            </div>
            <div v-else class="mt-3 text-xs text-gray-400">
              未配置访问地址
            </div>
          </UCard>
        </div>
      </UPageBody>
    </UDashboardPage>
  </UDashboardPanel>
</template>
