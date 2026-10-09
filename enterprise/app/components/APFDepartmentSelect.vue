<script setup lang="ts">
import DeptTreeSelector from '../../../foundation/app/components/DeptTreeSelector.vue'
import type { Department } from '../../../foundation/app/types/account'

const props = defineProps<{ disabled?: boolean, allowedCodes?: string[] }>()
const model = defineModel<string | undefined>({ required: true })
const { tree, departmentName, directoryError, refresh } = useAltocDirectoryLabels(computed(() => []))
const search = ref('')
function filtered(nodes: Department[]): Department[] {
  const q = search.value.trim().toLowerCase()
  return nodes.flatMap((node) => {
    if (props.allowedCodes && !props.allowedCodes.includes(node.deptCode)) {
      return filtered(node.children || [])
    }
    if (!q || node.name.toLowerCase().includes(q) || node.deptCode.toLowerCase().includes(q)) return [{ ...node, children: props.allowedCodes ? filtered(node.children || []) : node.children }]
    const children = filtered(node.children || [])
    return children.length ? [{ ...node, children }] : []
  })
}
</script>

<template>
  <div class="space-y-2">
    <UPopover>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="props.disabled"
        class="w-full justify-between"
        trailing-icon="i-lucide-chevron-down"
      >
        {{ model ? departmentName(model) : '搜索选择部门' }}
      </UButton>
      <template #content>
        <div class="w-80 max-w-[90vw] space-y-2 p-3">
          <UInput
            v-model="search"
            placeholder="搜索部门名称或编码"
            class="w-full"
          />
          <div class="max-h-64 overflow-y-auto">
            <DeptTreeSelector
              v-for="node in filtered(tree)"
              :key="node.deptCode"
              :node="node"
              :selected-dept-code="model || ''"
              @select="model = $event"
            />
          </div>
          <p
            v-if="directoryError"
            class="text-sm text-error"
          >
            部门目录加载失败 <UButton
              variant="link"
              @click="refresh()"
            >
              重试
            </UButton>
          </p>
          <p
            v-else-if="!filtered(tree).length"
            class="text-sm text-muted"
          >
            暂无匹配部门
          </p>
        </div>
      </template>
    </UPopover>
    <UButton
      v-if="model"
      color="neutral"
      variant="ghost"
      size="xs"
      :disabled="props.disabled"
      @click="model = ''"
    >
      清除部门
    </UButton>
  </div>
</template>
