<template>
  <UTooltip
    :content="{ side: 'top', sideOffset: 10, align: 'center' }"
    :delay-duration="150"
    arrow
    :ui="{
      content: 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-100 shadow-lg ring-1 ring-black/5 dark:ring-white/10 rounded-md max-w-80 whitespace-normal break-words overflow-visible !h-auto !min-h-0 !py-2.5 !px-3.5 !flex !flex-col !items-start !justify-start',
      arrow: 'fill-white dark:fill-gray-800'
    }"
  >
    <template #content>
      <div class="text-xs leading-5 whitespace-normal">
        <p class="font-medium mb-1">链接填写规则：</p>
        <ul class="list-disc pl-4 space-y-1">
          <li>以 http:// 或 https:// 开头：按原样使用（外部链接）。</li>
          <li>以 # 开头：页面内锚点(参见内容设置页)。</li>
          <li>相对路径（/login 或 login）</li>
          <li>email：可直接填email地址（自动补全为 mailto:），或填写 mailto:email地址。</li>
        </ul>
      </div>
    </template>
    <span class="inline-flex items-center cursor-help text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
      <UIcon name="i-heroicons-question-mark-circle" class="w-4 h-4 ml-1" aria-label="Link URL help" />
    </span>
  </UTooltip>
</template>

<script setup lang="ts">
// 无需脚本逻辑
</script>
