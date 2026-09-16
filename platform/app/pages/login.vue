<script setup lang="ts">
definePageMeta({
  layout: 'public'
})

const route = useRoute()

function normalizeRedirect(value: unknown) {
  const redirect = String(Array.isArray(value) ? value[0] : value || '').trim()
  if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//')) {
    return '/dashboard'
  }

  return redirect
}

onMounted(async () => {
  const redirect = normalizeRedirect(route.query.redirect)
  await navigateTo({
    path: redirect.startsWith('/admin') ? '/admin/login' : '/dashboard/login',
    query: {
      redirect
    }
  }, { replace: true })
})
</script>

<template>
  <section class="mx-auto flex min-h-[calc(100vh-90px)] max-w-3xl items-center px-6 py-12">
    <UCard class="w-full">
      <template #header>
        <h1 class="text-lg font-semibold text-slate-950">
          正在选择登录入口
        </h1>
      </template>

      <UAlert
        color="info"
        variant="soft"
        icon="i-lucide-loader-circle"
        title="正在跳转到对应的登录入口"
      />
    </UCard>
  </section>
</template>
