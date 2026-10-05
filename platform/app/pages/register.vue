<script setup lang="ts">
definePageMeta({
  layout: 'public'
})

const route = useRoute()

onMounted(async () => {
  await navigateTo({
    path: '/dashboard/register',
    query: {
      redirect: typeof route.query.redirect === 'string' ? route.query.redirect : undefined
    }
  }, { replace: true })
})
</script>

<template>
  <section class="mx-auto flex min-h-[calc(100vh-90px)] max-w-3xl items-center px-6 py-12">
    <UCard class="w-full">
      <template #header>
        <h1 class="text-lg font-semibold text-slate-950">
          正在进入企业管理员注册
        </h1>
      </template>

      <UAlert
        color="info"
        variant="soft"
        icon="i-lucide-loader-circle"
        title="正在跳转到企业管理员注册入口"
      />
    </UCard>
  </section>
</template>
