<script setup lang="ts">
import { ref } from 'vue'

interface Role {
  id: number
  role_code: string
  role_name: string
  description: string | null
  parent_id: number | null
  is_system: number
  status: number
  children?: Role[]
  created_at: string
  updated_at: string
  user_count?: number
}

const props = defineProps<{
  role: Role
  selectedRole: Role | null
  level?: number
}>()

const emit = defineEmits<{
  select: [role: Role]
  edit: [role: Role]
  delete: [role: Role]
  viewUsers: [role: Role]
  createChild: [role: Role]
}>()

const expanded = ref(true)
const showActions = ref(false)

const isSelected = computed(() => props.selectedRole?.id === props.role.id)
const hasChildren = computed(() => props.role.children && props.role.children.length > 0)
const currentLevel = computed(() => props.level ?? 0)
const indent = computed(() => currentLevel.value * 16)

function toggleExpand() {
  if (hasChildren.value) {
    expanded.value = !expanded.value
  }
}

function handleSelect() {
  emit('select', props.role)
}

function handleEdit(e: Event) {
  e.stopPropagation()
  emit('edit', props.role)
}

function handleDelete(e: Event) {
  e.stopPropagation()
  emit('delete', props.role)
}

function handleCreateChild(e: Event) {
  e.stopPropagation()
  emit('createChild', props.role)
}
</script>

<template>
  <div>
    <div
      class="group relative flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
      :class="{
        'bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30': isSelected
      }"
      :style="{ paddingLeft: `${indent + 8}px` }"
      @click="handleSelect"
      @mouseenter="showActions = true"
      @mouseleave="showActions = false"
    >
      <!-- 展开/折叠图标 -->
      <div class="w-4 h-4 shrink-0" @click.stop="toggleExpand">
        <UIcon
          v-if="hasChildren"
          :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="text-gray-500 transition-transform"
        />
      </div>

      <!-- 角色图标 -->
      <UIcon
        :name="role.is_system === 1 ? 'i-lucide-shield-check' : 'i-lucide-shield'"
        class="shrink-0"
        :class="isSelected ? 'text-primary-500' : 'text-gray-400'"
      />

      <!-- 角色名称 -->
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm truncate" :class="isSelected ? 'text-primary-600 dark:text-primary-400' : ''">
          {{ role.role_name }}
        </div>
        <div class="text-xs text-gray-500 font-mono truncate">
          {{ role.role_code }}
        </div>
      </div>

      <!-- 状态指示器 -->
      <div
        class="w-2 h-2 rounded-full shrink-0"
        :class="role.status === 1 ? 'bg-green-500' : 'bg-gray-400'"
        :title="role.status === 1 ? '启用' : '禁用'"
      />

      <!-- 操作按钮（hover显示） -->
      <div v-if="showActions || isSelected" class="flex items-center gap-0.5 ml-1" @click.stop>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-plus"
          title="创建子角色"
          @click="handleCreateChild"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-pencil"
          title="编辑"
          @click="handleEdit"
        />
        <UButton
          v-if="role.is_system !== 1"
          size="xs"
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          title="删除"
          @click="handleDelete"
        />
      </div>
    </div>

    <!-- 子角色 -->
    <div v-if="hasChildren && expanded" class="mt-1">
      <RoleTreeItem
        v-for="child in role.children"
        :key="child.id"
        :role="child"
        :selected-role="selectedRole"
        :level="currentLevel + 1"
        @select="emit('select', $event)"
        @edit="emit('edit', $event)"
        @delete="emit('delete', $event)"
        @create-child="emit('createChild', $event)"
      />
    </div>
  </div>
</template>
