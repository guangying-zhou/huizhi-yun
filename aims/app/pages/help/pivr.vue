<script setup lang="ts">
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '使用指南',
  layoutHeaderProjectSwitcher: false
})
</script>

<template>
  <UDashboardPanel
    id="pivr-guide"
    :ui="{ root: 'relative flex min-w-0 h-full shrink-0 flex-col', body: 'flex min-h-0 flex-1 flex-col overflow-hidden p-0' }"
  >
    <template #body>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-7">
        <div class="mx-auto w-full max-w-6xl">
          <div class="mb-6">
            <div class="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
              <UIcon name="i-lucide-book-open" class="size-4" />
              使用指南
            </div>
            <h1 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
              PIVR 项目管理生命周期模型
            </h1>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-muted sm:text-base">
              了解汇智云项目从立项到 P-I-V-R 四阶段推进、评审与闭环的统一方法。
            </p>
          </div>

          <UCard :ui="{ body: 'p-5 sm:p-7 lg:p-8' }">
            <PivrGuideContent />
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
