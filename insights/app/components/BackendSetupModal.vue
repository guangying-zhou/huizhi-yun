<script setup lang="ts">
/**
 * Modal component that prompts business owners to configure their backend URL
 * when accessing a business that has no backend configured.
 */
const props = defineProps<{
  open: boolean
  businessName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

function goToDashboard() {
  emit('close')
}
</script>

<template>
  <UModal
    :open="open"
    @update:open="emit('close')"
  >
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center gap-3">
            <div
              class="flex-shrink-0 w-10 h-10 rounded-full bg-warning-100 dark:bg-warning-900 flex items-center justify-center"
            >
              <UIcon
                name="i-lucide-settings"
                class="w-5 h-5 text-warning-600 dark:text-warning-400"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                后端服务未配置
              </h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                业务 "{{ businessName }}"
              </p>
            </div>
          </div>
        </template>

        <div class="space-y-4">
          <p class="text-gray-600 dark:text-gray-300">
            您的业务 <strong class="text-gray-900 dark:text-white">"{{ businessName }}"</strong> 尚未配置后端服务地址。
          </p>

          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="需要配置后端"
            description="RepoInsight 需要连接到您的代码仓库分析后端才能正常工作。请在控制台中配置后端服务地址。"
          />

          <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
            <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
              配置步骤：
            </p>
            <ol class="text-sm text-gray-600 dark:text-gray-400 list-decimal list-inside space-y-1">
              <li>进入 RepoInsight 控制台</li>
              <li>找到业务设置页面</li>
              <li>填写后端服务 URL 和端口</li>
              <li>保存配置</li>
            </ol>
          </div>
        </div>

        <template #footer>
          <div class="flex flex-col sm:flex-row gap-3 justify-end">
            <UButton
              color="primary"
              @click="goToDashboard"
            >
              确定
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
