<template>
  <UCard :ui="{ root: 'overflow-visible !p-0', body: 'sm:p-0 m-0', header: 'p-2' }">
    <template #header>
      <div class="flex items-center justify-between">
        <USkeleton class="w-36 h-6" />
        <USkeleton class="w-24 h-5" />
      </div>
    </template>

    <div class="space-y-3 p-4">
      <USkeleton class="h-12 w-full" />
      <USkeleton
        v-for="i in 6"
        :key="i"
        class="h-10 w-full"
      />
    </div>
  </UCard>
</template>
