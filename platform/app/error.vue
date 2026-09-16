<script setup lang="ts">
defineProps<{
  error?: {
    statusCode?: number
    statusMessage?: string
    message?: string
  }
}>()
</script>

<template>
  <main class="min-h-screen bg-gradient-to-br from-sky-50 via-white to-lime-50 text-slate-900">
    <div class="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
      <UCard class="w-full">
        <template #header>
          <div class="space-y-1">
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
              Platform Error
            </p>
            <h1 class="text-2xl font-semibold">
              {{ error?.statusCode || 500 }}
            </h1>
          </div>
        </template>

        <div class="space-y-3 text-sm text-slate-600">
          <p>{{ error?.statusMessage || error?.message || '发生未知异常。' }}</p>
          <p>当前页面属于 `platform` 绿地骨架，可在后续接入统一错误治理。</p>
        </div>
      </UCard>
    </div>
  </main>
</template>
