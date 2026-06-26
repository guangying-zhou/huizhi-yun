<script setup lang="ts">
definePageMeta({
  layout: false
})

const route = useRoute()

const { authenticated } = useAuth()

const redirectTarget = computed(() => {
  const raw = route.query.redirect
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim()
  }
  return '/'
})

onMounted(async () => {
  if (authenticated.value) {
    if (redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')) {
      window.location.replace(redirectTarget.value)
      return
    }
    await navigateTo(redirectTarget.value, { replace: true })
    return
  }

  const query = new URLSearchParams({
    redirect: redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')
      ? redirectTarget.value
      : `${window.location.origin}${redirectTarget.value}`
  })
  window.location.assign(`/api/auth/oidc-login?${query.toString()}`)
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
