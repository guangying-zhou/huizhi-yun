<script setup lang="ts">
definePageMeta({
  layout: false
})

const route = useRoute()
const config = useRuntimeConfig()

const auth = useAuth()
const { resolveCurrentAppUrl } = useAppUrls()

const redirectTarget = computed(() => {
  const raw = route.query.redirect
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim()
  }
  return '/'
})

const loggedOut = computed(() => {
  return route.query.logged_out === '1' || route.query.state === 'logged_out'
})

function startLogin() {
  const consoleBase = String(config.public.consoleUrl || '').trim()
  const authMode = String(config.public.authMode || '').trim()
  const legacyAuthBridge = config.public.legacyAuthBridge === true || String(config.public.legacyAuthBridge || '').toLowerCase() === 'true'
  if (consoleBase && authMode !== 'legacy' && !legacyAuthBridge) {
    const target = redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')
      ? redirectTarget.value
      : resolveCurrentAppUrl(redirectTarget.value)
    const query = new URLSearchParams({ redirect: target })
    window.location.assign(resolveCurrentAppUrl(`/api/auth/oidc-login?${query.toString()}`))
    return
  }

  const accountBase = String(config.public.accountUrl || '').trim() || 'http://localhost:3000'
  const authBase = accountBase.replace(/\/$/, '')
  const query = new URLSearchParams({
    target_app: String(config.public.appName || 'assets'),
    redirect: redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')
      ? redirectTarget.value
      : resolveCurrentAppUrl(redirectTarget.value)
  })
  window.location.assign(`${authBase}/login?${query.toString()}`)
}

onMounted(async () => {
  if (loggedOut.value) {
    return
  }

  if (auth.authenticated.value) {
    if (redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')) {
      window.location.replace(redirectTarget.value)
      return
    }
    await navigateTo(redirectTarget.value, { replace: true })
    return
  }

  startLogin()
})
</script>

<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="text-center">
      <UIcon
        :name="loggedOut ? 'i-lucide-log-out' : 'i-lucide-loader-2'"
        :class="[
          'size-8 text-primary mx-auto',
          loggedOut ? '' : 'animate-spin'
        ]"
      />
      <p class="mt-4 text-muted">
        {{ loggedOut ? '已退出登录' : '正在跳转登录...' }}
      </p>
      <UButton
        v-if="loggedOut"
        class="mt-4"
        icon="i-lucide-log-in"
        @click="startLogin"
      >
        重新登录
      </UButton>
    </div>
  </div>
</template>
