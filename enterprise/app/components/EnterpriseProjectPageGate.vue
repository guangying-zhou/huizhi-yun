<script setup lang="ts">
import { useProvidedEnterpriseProjectObjectContext } from '../composables/useEnterpriseProjectObjectContext'
import { projectPageCanMount } from '../utils/object-navigation.mjs'

// NuxtPage must stay behind a lazy slot gate, not merely be visually hidden by
// the layout: setup/data requests must not run until project discovery allows it.
const route = useRoute()
const context = useProvidedEnterpriseProjectObjectContext()
const allowed = computed(() => projectPageCanMount(route.path, context?.project.value))
</script>

<template>
  <slot v-if="allowed" />
</template>
