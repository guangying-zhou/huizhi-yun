<template>
  <UCard
    ref="cardRef"
    :ui="{ root: 'overflow-visible !p-0', body: 'sm:p-0 m-0', header: 'p-2' }"
  >
    <template #header>
      <div class="flex items-center justify-between">
        <USkeleton class="w-36 h-6" />
        <USkeleton class="w-60 h-5" />
      </div>
    </template>

    <div class="h-84 flex items-center justify-center">
      <USkeleton class="h-full w-full" />
    </div>
  </UCard>
</template>
