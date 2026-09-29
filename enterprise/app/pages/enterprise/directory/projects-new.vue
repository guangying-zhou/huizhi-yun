<script setup lang="ts">
import DirectoryProjectFormPage from '../../../../../foundation/app/components/DirectoryProjectFormPage.vue'

definePageMeta({ hostContentInset: false, name: 'console-host-directory-projects-new', navigationOwner: 'console' })
</script>

<template>
  <DirectoryProjectFormPage mode="create" />
</template>
