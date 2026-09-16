<script setup lang="ts">
interface User {
  uid: string
  realName: string
  avatar?: string
}

interface TreeNode {
  deptCode: string
  name: string
  children?: TreeNode[]
  users?: User[]
}

const props = defineProps<{
  node: TreeNode
  level?: number
  selectedUsers: Set<string>
}>()

const emit = defineEmits<{
  (e: 'toggleUser', uid: string, user: User): void
}>()

// Default to open for better UX
const isOpen = ref(true)

const hasChildren = computed(() => {
  return (props.node.children && props.node.children.length > 0)
    || (props.node.users && props.node.users.length > 0)
})

const indentation = computed(() => {
  return { paddingLeft: `${(props.level || 0) * 16 + 8}px` }
})

const toggleOpen = () => {
  isOpen.value = !isOpen.value
}

// Check if user is selected
const isUserSelected = (uid: string) => {
  return props.selectedUsers.has(uid)
}

const onUserCheck = (user: User) => {
  emit('toggleUser', user.uid, user)
}
</script>

<template>
  <div class="select-none">
    <!-- Department Node -->
    <div
      class="flex items-center gap-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded py-1.5 px-1 cursor-pointer transition-colors"
      :style="indentation"
      @click="toggleOpen"
    >
      <button
        v-if="hasChildren"
        class="p-0.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        type="button"
      >
        <UIcon :name="isOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="w-4 h-4" />
      </button>
      <span v-else class="w-5" />

      <UIcon name="i-lucide-folder" class="w-4 h-4 text-blue-500 shrink-0" />
      <span class="text-sm font-medium truncate">{{ node.name }}</span>
      <span v-if="node.users?.length" class="text-xs text-gray-400 ml-1">({{ node.users.length }})</span>
    </div>

    <!-- Children & Users -->
    <Transition name="slide-fade">
      <div v-show="isOpen">
        <!-- Recursive Departments -->
        <template v-if="node.children">
          <DocumentUserTreeItem
            v-for="child in node.children"
            :key="child.deptCode"
            :node="child"
            :level="(level || 0) + 1"
            :selected-users="selectedUsers"
            @toggle-user="(u, user) => emit('toggleUser', u, user)"
          />
        </template>

        <!-- Users in this department -->
        <template v-if="node.users">
          <div
            v-for="user in node.users"
            :key="user.uid"
            class="flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded py-1.5 px-1 cursor-pointer transition-colors"
            :style="{ paddingLeft: `${((level || 0) + 1) * 16 + 28}px` }"
            @click.stop="onUserCheck(user)"
          >
            <UCheckbox
              :model-value="isUserSelected(user.uid)"
              class="pointer-events-none"
              @update:model-value="onUserCheck(user)"
            />

            <UAvatar :alt="user.realName" size="2xs" />
            <div class="text-sm leading-none flex-1 truncate">
              <span class="font-medium">{{ user.realName }}</span>
              <span class="text-xs text-gray-500 ml-1">({{ user.uid }})</span>
            </div>
          </div>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.slide-fade-enter-active,
.slide-fade-leave-active {
    transition: all 0.2s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}
</style>
