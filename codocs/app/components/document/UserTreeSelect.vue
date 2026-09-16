<script setup lang="ts">
import { useAccountStore } from '~/stores/account'

interface User {
  uid: string
  realName: string
  email?: string
  avatar?: string | null
  deptName?: string
}

const props = defineProps<{
  modelValue: User[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: User[]): void
}>()

const accountStore = useAccountStore()
const loading = ref(false)
const selectedUids = ref<string[]>([])

// 从 Store 获取用户列表
const allUsers = computed(() => accountStore.allUsers)

// Sync from props
watch(() => props.modelValue, (newVal) => {
  selectedUids.value = newVal ? newVal.map(u => u.uid) : []
}, { immediate: true, deep: true })

const fetchUsers = async () => {
  loading.value = true
  try {
    await accountStore.fetchUsers()
  } catch (error) {
    console.error('Failed to fetch users:', error)
  } finally {
    loading.value = false
  }
}

// Computed options for USelectMenu
const userOptions = computed(() => {
  return allUsers.value.map((user) => {
    const avatarSrc = resolveAvatarSrc(user.avatar)

    return {
      value: user.uid,
      label: `${user.realName || user.uid}`,
      uid: user.uid,
      suffix: user.deptName || '',
      avatarProps: avatarSrc ? { src: avatarSrc } : undefined,
      user: user // Store full user object
    }
  })
})

const handleSelect = (selected: string[]) => {
  selectedUids.value = selected

  // Map uids back to user objects
  const selectedUsers = allUsers.value.filter(user =>
    selected.includes(user.uid)
  )

  emit('update:modelValue', selectedUsers)
}

onMounted(() => {
  fetchUsers()
})
</script>

<template>
  <USelectMenu
    v-model="selectedUids"
    :items="userOptions"
    :loading="loading"
    :filter-fields="['label', 'uid', 'suffix']"
    multiple
    searchable
    placeholder="选择用户..."
    value-key="value"
    :ui="{ content: 'min-w-fit' }"
    class="w-64"
    @update:model-value="handleSelect"
  >
    <!-- <template #default="{ open }">
            <UButton color="neutral" variant="outline" class="w-full flex justify-between items-center font-normal">
                <span v-if="selectedUids.length === 0" class="text-gray-500 dark:text-gray-400">选择用户...</span>
                <span v-else class="text-gray-900 dark:text-white">已选择 {{ selectedUids.length }} 人</span>
                <UIcon name="i-lucide-chevron-down" class="w-5 h-5 text-gray-400 transition-transform"
                    :class="[open && 'transform rotate-180']" />
            </UButton>
        </template> -->

    <template #item-label="{ item }">
      <div class="flex items-center gap-2 w-full">
        <UAvatar
          v-if="item.avatarProps"
          v-bind="item.avatarProps"
          :alt="item.label"
          size="2xs"
        />
        <UAvatar
          v-else
          :alt="item.label"
          size="2xs"
          icon="i-lucide-user"
        />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">
            {{ item.user.realName || item.user.uid }}<template v-if="item.user.realName">
              ({{ item.user.uid }})
            </template>
          </div>
        </div>
        <div v-if="item.suffix" class="text-xs text-gray-400 shrink-0">
          {{ item.suffix }}
        </div>
      </div>
    </template>
  </USelectMenu>
</template>
