<template>
  <UCard
    ref="cardRef"
    :ui="{ root: 'overflow-visible', body: 'sm:p-0', header: 'p-2' }"
  >
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          <USkeleton class="h-6 w-32 mr-2" />
          <USkeleton class="h-5 w-16" />
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-3 text-xs text-muted">
            <div class="flex items-center gap-2">
              <USkeleton class="w-3 h-3 rounded-full" />
              <USkeleton class="h-5 w-16" />
            </div>
            <div class="flex items-center gap-2">
              <USkeleton class="w-3 h-3 rounded-full" />
              <USkeleton class="h-5 w-16" />
            </div>
          </div>
        </div>
      </div>
    </template>

    <div class="h-90 flex items-center justify-center">
      <USkeleton class="h-full w-full" />
    </div>
  </UCard>
</template>
