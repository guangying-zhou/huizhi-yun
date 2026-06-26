<script setup lang="ts">
interface AppItem {
  appCode: string
  appName: string
  description: string | null
  icon: string | null
  homeUrl: string | null
  appType: string
}

const apps = ref<AppItem[]>([])
const loaded = ref(false)

async function loadApps() {
  if (loaded.value) return

  try {
    const res = await $fetch<{ code: number, data: AppItem[] }>('/api/user/applications')
    apps.value = (res.data || []).filter(app => app.homeUrl)
    loaded.value = true
  } catch {
    // silent
  }
}
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
      <div v-if="!loaded" class="flex items-center justify-center py-4">
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
          target="_blank"
          rel="noreferrer"
          class="flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-elevated"
        >
          <img
            v-if="app.icon"
            :src="app.icon"
            class="size-8 rounded object-contain"
            :alt="app.appName"
          >
          <UIcon v-else name="i-lucide-box" class="size-8 text-dimmed" />
          <span class="line-clamp-2 text-center text-xs leading-tight text-default">{{ app.appName }}</span>
        </a>
      </div>
    </template>
  </UPopover>
</template>
