<script setup lang="ts">
interface NavItem { label: string, icon?: string, to?: string, children?: NavItem[] }
interface NavArea { code: string, label: string, icon: string, children: NavItem[] }

// 业务领域（产品 / 交付与服务 / 经营…）是分节标题，不是可点、可展开的行：
// 它本身没有页面，把它做成按钮会让读者以为点得进去。标题只分节，真正的
// 入口从工作域（第二级）开始，因此图标也下移到工作域那一层。
defineProps<{ primary: NavArea[], auxiliary: NavArea[] }>()
</script>

<template>
  <div>
    <template
      v-for="area in primary"
      :key="area.code"
    >
      <p class="px-3 pb-1 pt-4 text-xs font-medium text-muted first:pt-1">
        {{ area.label }}
      </p>
      <HostNavTree :items="area.children" />
    </template>
    <template v-if="auxiliary.length">
      <USeparator class="my-2" />
      <template
        v-for="area in auxiliary"
        :key="area.code"
      >
        <p class="px-3 pb-1 pt-4 text-xs font-medium text-muted">
          {{ area.label }}
        </p>
        <HostNavTree :items="area.children" />
      </template>
    </template>
  </div>
</template>
