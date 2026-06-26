<script setup lang="ts">
const { apps, loaded, loading, loadApps } = useUserApplications()
</script>

<template>
  <UPopover
    :content="{ align: 'end', sideOffset: 8 }"
    :ui="{ content: 'w-72 p-2' }"
    @update:open="(open: boolean) => open && loadApps()"
  >
    <UButton
      icon="i-lucide-grip"
      color="neutral"
      variant="ghost"
      square
      size="sm"
    />

    <template #content>
      <div v-if="loading || !loaded" class="flex items-center justify-center py-4">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-dimmed" />
      </div>

      <div v-else-if="!apps.length" class="py-4 text-center text-sm text-dimmed">
        暂无应用
      </div>

      <div v-else class="grid grid-cols-3 gap-1">
        <a
          v-for="app in apps"
          :key="app.appCode"
          :href="app.homeUrl!"
          class="flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-elevated"
        >
          <UIcon
            v-if="isApplicationIconName(app.icon)"
            :name="app.icon!"
            class="size-8 text-muted"
          />
          <img
            v-else-if="app.icon"
            :src="app.icon"
            class="size-8 rounded object-contain"
            :alt="app.appName"
          >
          <UIcon v-else name="i-lucide-box" class="size-8 text-dimmed" />
          <span class="line-clamp-2 text-center text-xs leading-tight text-default">
            {{ getShortApplicationName(app.appName, app.appCode) }}
          </span>
        </a>
      </div>
    </template>
  </UPopover>
</template>
