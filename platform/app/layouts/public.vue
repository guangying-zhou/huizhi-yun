<script setup lang="ts">
const route = useRoute()
const { getVisibleSection } = useConsoleMenus()
const navItems = computed(() => getVisibleSection('public').items)
</script>

<template>
  <div class="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(31,103,242,0.12),_transparent_42%),linear-gradient(180deg,_#f8fbff_0%,_#eef5ff_38%,_#ffffff_100%)]">
    <header class="border-b border-white/70 bg-white/85 backdrop-blur">
      <div class="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <NuxtLink
          to="/"
          class="flex items-center gap-3 text-slate-900"
        >
          <img
            src="/logo.svg"
            alt="platform"
            class="h-9 w-9"
          >
          <div>
            <p class="text-xl font-semibold tracking-wide">汇智云</p>
            <p class="text-xs text-slate-500">企业智能协同平台</p>
          </div>
        </NuxtLink>

        <nav class="hidden items-center gap-2 md:flex">
          <NuxtLink
            v-for="item in navItems"
            :key="item.key"
            :to="item.disabled ? undefined : item.to"
            class="rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            :class="{ 'pointer-events-none opacity-45': item.disabled, 'bg-slate-100 text-slate-900': route.path === item.to }"
          >
            {{ item.label }}
          </NuxtLink>
        </nav>

        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            to="/dashboard/login"
          >
            登录
          </UButton>
          <!-- <UButton
            color="primary"
            to="/dashboard/register"
          >
            注册试用
          </UButton> -->
        </div>
      </div>
    </header>

    <main>
      <slot />
    </main>
  </div>
</template>
