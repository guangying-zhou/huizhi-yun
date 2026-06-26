<script setup lang="ts">
const { authenticated } = useAuth()
const toast = useToast()
const {
  session,
  active,
  ending,
  loadSession,
  endSession,
  clearSession
} = useAuthorizationSimulationSession()

let expiresTimer: ReturnType<typeof setTimeout> | null = null

function clearExpiresTimer() {
  if (!expiresTimer) return
  clearTimeout(expiresTimer)
  expiresTimer = null
}

async function refreshPermissions() {
  const { clearCache, loadPermissions } = usePermissions()
  clearCache()
  await loadPermissions({ force: true })
}

onMounted(() => {
  if (authenticated.value) {
    void loadSession({ force: true })
  }
})

onBeforeUnmount(() => {
  clearExpiresTimer()
})

watch(authenticated, (isAuthenticated) => {
  if (isAuthenticated) {
    void loadSession({ force: true })
    return
  }

  clearExpiresTimer()
  clearSession()
})

watch(() => session.value.expiresAt, (expiresAt) => {
  clearExpiresTimer()
  if (!active.value || !expiresAt) return

  const expiresAtMs = new Date(expiresAt).getTime()
  const delayMs = expiresAtMs - Date.now() + 500
  if (!Number.isFinite(expiresAtMs) || delayMs <= 0) {
    void loadSession({ force: true }).then((next) => {
      if (!next.active) {
        void refreshPermissions()
      }
    })
    return
  }

  expiresTimer = setTimeout(() => {
    void loadSession({ force: true }).then((next) => {
      if (!next.active) {
        void refreshPermissions()
      }
    })
  }, delayMs)
})

const modeLabel = computed(() => {
  return session.value.mode === 'user_simulation' ? '用户模拟' : '角色模拟'
})

const targetLabel = computed(() => {
  if (session.value.mode === 'user_simulation') {
    return session.value.subjectCode || '未指定用户'
  }

  return session.value.roleCode || '未指定角色'
})

const expiresLabel = computed(() => {
  if (!session.value.expiresAt) return ''

  const date = new Date(session.value.expiresAt)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
})

async function handleExit() {
  try {
    await endSession()
    toast.add({
      title: '已退出模拟',
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '退出模拟失败'
    toast.add({
      title: '退出模拟失败',
      description: message,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  }
}
</script>

<template>
  <div
    v-if="active"
    class="shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-2"
  >
    <div class="flex min-h-9 flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <UBadge
          color="warning"
          variant="soft"
          :label="modeLabel"
        />
        <span class="text-default">当前目标</span>
        <span class="max-w-64 truncate font-medium text-highlighted">
          {{ targetLabel }}
        </span>
        <span
          v-if="session.reason"
          class="hidden max-w-96 truncate text-muted lg:inline"
        >
          {{ session.reason }}
        </span>
        <span
          v-if="expiresLabel"
          class="text-muted"
        >
          至 {{ expiresLabel }}
        </span>
      </div>

      <UButton
        icon="i-lucide-log-out"
        label="退出模拟"
        color="warning"
        variant="ghost"
        size="sm"
        :loading="ending"
        @click="handleExit"
      />
    </div>
  </div>
</template>
