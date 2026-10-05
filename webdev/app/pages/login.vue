<script setup lang="ts">
definePageMeta({
  layout: false
})

const route = useRoute()
const auth = useAuth()
const { resolveCurrentAppUrl } = useAppUrls()

const redirectTarget = computed(() => {
  const raw = route.query.redirect
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '/'
})

const loggedOut = computed(() => route.query.logged_out === '1' || route.query.state === 'logged_out')

function startLogin() {
  const target = redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')
    ? redirectTarget.value
    : resolveCurrentAppUrl(redirectTarget.value)
  const query = new URLSearchParams({ redirect: target })
  window.location.assign(resolveCurrentAppUrl(`/api/auth/oidc-login?${query.toString()}`))
}

onMounted(async () => {
  if (loggedOut.value) return

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
  <div class="flex min-h-screen items-center justify-center bg-default text-default">
    <div class="text-center">
      <UIcon
        :name="loggedOut ? 'i-lucide-log-out' : 'i-lucide-loader-2'"
        :class="[
          'mx-auto size-8 text-primary',
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
