<script setup lang="ts">
definePageMeta({
  layout: false
})

const route = useRoute()
const config = useRuntimeConfig()

const token = useCookie<string | null | undefined>('token')
const authUser = useCookie<string | null | undefined>('auth_user')

const redirectTarget = computed(() => {
  const raw = route.query.redirect
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim()
  }
  return '/'
})

onMounted(async () => {
  const tokenValue = String(token.value || '').trim()
  const userValue = String(authUser.value || '').trim()

  if (tokenValue && tokenValue !== 'null' && tokenValue !== 'undefined' && userValue) {
    if (redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')) {
      window.location.replace(redirectTarget.value)
      return
    }
    await navigateTo(redirectTarget.value, { replace: true })
    return
  }

  const accountBase = String(config.public.accountUrl || '').trim() || 'http://localhost:3000'
  const query = new URLSearchParams({
    target_app: String(config.public.appCode || 'align'),
    redirect: redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')
      ? redirectTarget.value
      : `${window.location.origin}${redirectTarget.value}`
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
