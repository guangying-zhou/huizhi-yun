<template>
  <UCard :ui="{ body: '!px-0 !pt-0 !pb-3' }">
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs text-muted uppercase mb-1.5">
            部门贡献排行
          </p>
          <p class="text-sm text-muted">
            --- 年 --- 月
          </p>
        </div>
      </div>
    </template>

    <div class="h-90 flex items-center justify-center">
      <USkeleton class="h-full w-full" />
    </div>
  </UCard>
</template>
