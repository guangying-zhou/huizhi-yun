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

onMounted(async () => {
  if (auth.authenticated.value) {
    await navigateTo(redirectTarget.value, { replace: true })
    return
  }

  if (auth.enabled?.value && 'login' in auth && typeof auth.login === 'function') {
    await auth.login(
      redirectTarget.value.startsWith('http')
        ? redirectTarget.value
        : resolveCurrentAppUrl(redirectTarget.value)
    )
    return
  }

  const accountBase = String(config.public.accountUrl || '').trim() || 'http://localhost:3000'
  const query = new URLSearchParams({
    target_app: 'codocs',
    redirect: redirectTarget.value.startsWith('http')
      ? redirectTarget.value
      : resolveCurrentAppUrl(redirectTarget.value)
  })
  window.location.assign(`${accountBase.replace(/\/$/, '')}/login?${query.toString()}`)
})
</script>

<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="text-center">
      <UIcon
        name="i-lucide-loader-2"
        class="size-8 animate-spin text-primary"
      />
      <p class="mt-4 text-muted">
        正在跳转登录...
      </p>
    </div>
  </div>
</template>
