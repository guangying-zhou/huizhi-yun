<script setup lang="ts">
import { provide } from 'vue'
import { authorizationModuleScope } from '../utils/authorizationModuleScope'

const props = defineProps<{ app: 'altoc' | 'finance' }>()
// A static owning module per component subtree; snapshots are never merged.
provide(authorizationModuleScope, props.app)
</script>

<template>
  <slot />
</template>
