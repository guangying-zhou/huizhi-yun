<template>
  <UPageGrid class="lg:grid-cols-6 gap-2 gap-x-4 sm:gap-px pt-1">
    <UPageCard
      v-for="i in 6"
      :key="i"
      variant="subtle"
      spotlight
      orientation="horizontal"
      :ui="{
        container: 'gap-y-1 lg:p-1.5',
        wrapper: 'items-center',
        title: 'font-normal text-muted text-xs uppercase items-start pt-0',
        body: '!px-0 !pt-0 !pb-0 !m-0'
      }"
      class="p-0 lg:rounded-none first:rounded-l-lg last:rounded-r-lg hover:z-1 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 relative"
    >
      <template #leading>
        <USkeleton class="w-10 h-10 rounded-full" />
      </template>
      <template #title>
        <USkeleton class="h-3 w-20" />
      </template>
      <USkeleton class="h-8 w-24" />
    </UPageCard>
  </UPageGrid>
</template>
