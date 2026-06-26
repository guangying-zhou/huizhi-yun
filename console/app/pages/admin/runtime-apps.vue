<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('应用运行管理')

type RuntimeAppStatus = {
  appCode: string
  appName: string
  processName: string
  basePath: string
  port: number
  hmrPort: number
  enabledInStack: boolean
  manageable: boolean
  status: string
  pid: number | null
  cpu: number
  memoryMb: number
  uptimeMs: number | null
  restarts: number
  note: string | null
}

type RuntimeContext = {
  enabled: boolean
  stackEnv: string
  ecosystemFile: string
  pm2Bin: string
}

type ApiResponse<T> = {
  code: number
  data: T
  message?: string
}

type RuntimeAction = 'start' | 'stop' | 'restart'

const toast = useToast()
const pendingKey = ref('')
const confirmOpen = ref(false)
const selectedApp = ref<RuntimeAppStatus | null>(null)
const selectedAction = ref<RuntimeAction>('restart')

const { data, pending, refresh } = await useFetch<ApiResponse<{ context: RuntimeContext, items: RuntimeAppStatus[] }>>(
  '/api/v1/console/runtime/apps',
  {
    default: () => ({
      code: 0,
      data: {
        context: {
          enabled: false,
          stackEnv: '',
          ecosystemFile: '',
          pm2Bin: 'pm2'
        },
        items: []
      }
    })
  }
)

const context = computed(() => data.value?.data.context)
const apps = computed(() => data.value?.data.items || [])
const totals = computed(() => {
  const online = apps.value.filter(app => app.status === 'online').length
  const stopped = apps.value.filter(app => ['stopped', 'not_found'].includes(app.status)).length
  return { online, stopped, total: apps.value.length }
})

function statusColor(status: string) {
  if (status === 'online') return 'success'
  if (status === 'stopped' || status === 'not_found') return 'neutral'
  if (status === 'errored') return 'error'
  return 'warning'
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    online: '运行中',
    stopped: '已停止',
    errored: '异常',
    launching: '启动中',
    not_found: '未创建'
  }
  return labels[status] || status
}

function uptimeLabel(value: number | null) {
  if (!value || value < 0) return '-'
  const minutes = Math.floor(value / 60000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分钟`
  const days = Math.floor(hours / 24)
  return `${days} 天 ${hours % 24} 小时`
}

function actionLabel(action: RuntimeAction) {
  return {
    start: '启动',
    stop: '停止',
    restart: '重启'
  }[action]
}

function actionColor(action: RuntimeAction) {
  return action === 'stop' ? 'warning' : 'primary'
}

function openConfirm(app: RuntimeAppStatus, action: RuntimeAction) {
  selectedApp.value = app
  selectedAction.value = action
  confirmOpen.value = true
}

async function applyAction() {
  if (!selectedApp.value) return

  const app = selectedApp.value
  const action = selectedAction.value
  pendingKey.value = `${app.appCode}:${action}`

  try {
    await $fetch(`/api/v1/console/runtime/apps/${encodeURIComponent(app.appCode)}/action`, {
      method: 'POST',
      body: { action }
    })
    toast.add({ color: 'success', title: `${actionLabel(action)}命令已提交`, description: app.appName })
    confirmOpen.value = false
    await refresh()
  } catch (error) {
    toast.add({
      color: 'error',
      title: `${actionLabel(action)}失败`,
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    pendingKey.value = ''
  }
}
</script>

<template>
  <UDashboardPanel id="runtime-apps" :ui="dashboardPanelUi">
    <template #header>
      <UDashboardNavbar title="应用运行管理">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            label="刷新"
            color="neutral"
            variant="soft"
            :loading="pending"
            @click="refresh()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="!context?.enabled"
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          title="运行环境控制未启用"
          description="生产构建默认禁用 Web 启停能力。如确需启用，请设置 HZY_RUNTIME_APP_CONTROL_ENABLED=true。"
        />

        <div class="grid gap-3 md:grid-cols-3">
          <UCard :ui="{ body: 'flex items-center gap-3' }">
            <UIcon name="i-lucide-server" class="size-7 text-primary" />
            <div>
              <p class="text-xs text-muted">
                应用总数
              </p>
              <p class="text-xl font-semibold">
                {{ totals.total }}
              </p>
            </div>
          </UCard>
          <UCard :ui="{ body: 'flex items-center gap-3' }">
            <UIcon name="i-lucide-circle-check" class="size-7 text-success" />
            <div>
              <p class="text-xs text-muted">
                运行中
              </p>
              <p class="text-xl font-semibold">
                {{ totals.online }}
              </p>
            </div>
          </UCard>
          <UCard :ui="{ body: 'flex items-center gap-3' }">
            <UIcon name="i-lucide-circle-pause" class="size-7 text-warning" />
            <div>
              <p class="text-xs text-muted">
                已停止/未创建
              </p>
              <p class="text-xl font-semibold">
                {{ totals.stopped }}
              </p>
            </div>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="font-semibold">
                  PM2 应用
                </p>
                <p class="text-xs text-muted">
                  环境：{{ context?.stackEnv || '-' }} · PM2：{{ context?.pm2Bin || 'pm2' }}
                </p>
              </div>
              <UBadge color="neutral" variant="subtle">
                {{ context?.ecosystemFile || '未找到 ecosystem 配置' }}
              </UBadge>
            </div>
          </template>

          <div class="overflow-hidden rounded-lg border border-default">
            <div class="grid grid-cols-12 gap-3 border-b border-default bg-muted px-4 py-3 text-xs font-medium text-muted">
              <div class="col-span-3">
                应用
              </div>
              <div class="col-span-2">
                状态
              </div>
              <div class="col-span-2">
                资源
              </div>
              <div class="col-span-2">
                端口
              </div>
              <div class="col-span-3 text-right">
                操作
              </div>
            </div>

            <div v-if="pending" class="space-y-3 p-4">
              <USkeleton v-for="i in 5" :key="i" class="h-16 w-full" />
            </div>

            <div v-else class="divide-y divide-default">
              <div
                v-for="app in apps"
                :key="app.appCode"
                class="grid grid-cols-12 items-center gap-3 px-4 py-3"
              >
                <div class="col-span-12 min-w-0 md:col-span-3">
                  <div class="font-medium text-highlighted">
                    {{ app.appName }}
                  </div>
                  <div class="font-mono text-xs text-muted">
                    {{ app.processName }} · {{ app.basePath }}
                  </div>
                  <div v-if="app.note" class="mt-1 text-xs text-muted">
                    {{ app.note }}
                  </div>
                </div>

                <div class="col-span-6 md:col-span-2">
                  <UBadge :color="statusColor(app.status)" variant="soft">
                    {{ statusLabel(app.status) }}
                  </UBadge>
                  <div class="mt-1 text-xs text-muted">
                    PID {{ app.pid || '-' }}
                  </div>
                </div>

                <div class="col-span-6 text-sm md:col-span-2">
                  <div>{{ app.memoryMb }} MB</div>
                  <div class="text-xs text-muted">
                    CPU {{ app.cpu.toFixed(1) }}% · 重启 {{ app.restarts }}
                  </div>
                  <div class="text-xs text-muted">
                    {{ uptimeLabel(app.uptimeMs) }}
                  </div>
                </div>

                <div class="col-span-6 text-sm md:col-span-2">
                  <div>HTTP {{ app.port }}</div>
                  <div class="text-xs text-muted">
                    HMR {{ app.hmrPort }}
                  </div>
                </div>

                <div class="col-span-6 md:col-span-3">
                  <div class="flex justify-end gap-2">
                    <UButton
                      icon="i-lucide-play"
                      label="启动"
                      size="sm"
                      variant="soft"
                      :disabled="!app.manageable || app.status === 'online'"
                      :loading="pendingKey === `${app.appCode}:start`"
                      @click="openConfirm(app, 'start')"
                    />
                    <UButton
                      icon="i-lucide-rotate-cw"
                      label="重启"
                      size="sm"
                      color="neutral"
                      variant="soft"
                      :disabled="!app.manageable || app.status !== 'online'"
                      :loading="pendingKey === `${app.appCode}:restart`"
                      @click="openConfirm(app, 'restart')"
                    />
                    <UButton
                      icon="i-lucide-square"
                      label="停止"
                      size="sm"
                      color="warning"
                      variant="soft"
                      :disabled="!app.manageable || app.status !== 'online'"
                      :loading="pendingKey === `${app.appCode}:stop`"
                      @click="openConfirm(app, 'stop')"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="confirmOpen" :title="`${actionLabel(selectedAction)}应用`" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="space-y-3">
        <UAlert
          :color="actionColor(selectedAction)"
          variant="soft"
          icon="i-lucide-terminal"
          :title="selectedApp?.appName || '-'"
          :description="`将执行 PM2 ${actionLabel(selectedAction)} 操作。`"
        />
        <p class="text-sm text-muted">
          该操作只作用于白名单进程 {{ selectedApp?.processName }}。停止业务应用后，对应路径会暂时不可访问；Console 自身不可在此页面停止。
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="confirmOpen = false">
          取消
        </UButton>
        <UButton
          :color="actionColor(selectedAction)"
          :loading="Boolean(selectedApp && pendingKey === `${selectedApp.appCode}:${selectedAction}`)"
          @click="applyAction"
        >
          确认{{ actionLabel(selectedAction) }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
