<script setup lang="ts">
definePageMeta({
  layout: false
})

const route = useRoute()

const redirectTarget = computed(() => {
  const raw = route.query.redirect
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim()
  }
  return '/'
})

function toAbsoluteRedirect(value: string) {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value
  }

  const path = value.startsWith('/') ? value : `/${value}`
  return `${window.location.origin}${path}`
}

onMounted(() => {
  const query = new URLSearchParams({
    redirect: toAbsoluteRedirect(redirectTarget.value)
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
