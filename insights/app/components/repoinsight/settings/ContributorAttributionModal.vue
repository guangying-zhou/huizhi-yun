<script setup lang="ts">
import { ref, watch } from 'vue'

interface Contributor {
  id: number
  name: string
  username: string
  email?: string
}

const props = defineProps<{
  open: boolean
  currentParentId?: number | null
  contributors: { id: number, name: string }[]
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'select', id: number | null): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: v => emit('update:open', v)
})

const searchQuery = ref('')
const selectedId = ref<number | null>(props.currentParentId ?? null)

// Filter contributors based on search
const filteredContributors = computed(() => {
  if (!searchQuery.value) return props.contributors.slice(0, 100) // Show first 100 by default
  const q = searchQuery.value.toLowerCase()
  return props.contributors.filter(c =>
    c.name.toLowerCase().includes(q)
  ).slice(0, 100)
})

function onSelect(id: number | null) {
  emit('select', id)
  isOpen.value = false
}

watch(() => props.currentParentId, (newVal) => {
  selectedId.value = newVal ?? null
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="选择归属人"
  >
    <!-- <template #header>
            <div class="flex items-center justify-between">
                <UButton color="neutral" variant="ghost" icon="i-heroicons-x-mark-20-solid" class="-my-1"
                    @click="isOpen = false" />
            </div>
        </template> -->

    <template #body>
      <div class="p-4 space-y-4">
        <UInput
          v-model="searchQuery"
          icon="i-heroicons-magnifying-glass-20-solid"
          placeholder="搜索贡献者..."
          autofocus
        />

        <div class="max-h-60 overflow-y-auto space-y-1">
          <div
            v-if="!searchQuery && !props.contributors.length"
            class="text-sm text-gray-500 text-center py-4"
          >
            无数据
          </div>

          <!-- Option to clear/set as independent -->
          <button
            class="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between group"
            :class="{ 'bg-primary-50 dark:bg-primary-900/10 text-primary-600': selectedId === null }"
            @click="onSelect(null)"
          >
            <span class="text-sm font-medium">无（独立贡献者）</span>
            <UIcon
              v-if="selectedId === null"
              name="i-heroicons-check-20-solid"
              class="w-5 h-5"
            />
          </button>

          <button
            v-for="person in filteredContributors"
            :key="person.id"
            class="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between group"
            :class="{ 'bg-primary-50 dark:bg-primary-900/10 text-primary-600': selectedId === person.id }"
            @click="onSelect(person.id)"
          >
            <span class="text-sm">{{ person.name }}</span>
            <UIcon
              v-if="selectedId === person.id"
              name="i-heroicons-check-20-solid"
              class="w-5 h-5"
            />
          </button>

          <div
            v-if="props.contributors.length > 100 && filteredContributors.length === 100"
            class="text-xs text-gray-400 text-center pt-2"
          >
            仅显示前 100 条，请使用搜索查找更多
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
