<script setup lang="ts">
const route = useRoute()
const config = useRuntimeConfig()
const uuid = computed(() => String(route.params.uuid || ''))
const codocsUrl = computed(() => String(config.public.codocsUrl || ''))
const validUuid = computed(() => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(uuid.value))

usePageTitle('协作文档')
</script>

<template>
  <section class="w-full" style="height: calc(100svh - 3.5rem); min-height: 32rem">
    <UAlert v-if="!validUuid" color="error" title="文档标识无效" />
    <CodocsEditor v-else :uuid="uuid" :base-url="codocsUrl" class="h-full" />
  </section>
</template>
