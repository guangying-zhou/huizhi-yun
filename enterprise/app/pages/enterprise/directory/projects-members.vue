<script setup lang="ts">
import DirectoryProjectFormPage from '../../../../../foundation/app/components/DirectoryProjectFormPage.vue'

definePageMeta({ hostContentInset: false, name: 'console-host-directory-projects-members', navigationOwner: 'console' })
</script>

<template>
  <DirectoryProjectFormPage mode="members" />
</template>
