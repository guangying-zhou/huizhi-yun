<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold leading-7 font-display">
          Passkey Manager
        </h2>
        <UButton
          size="lg"
          color="black"
          :loading="creating"
          @click="modal = true"
          :disabled="creating"
        >
          Add Passkey
        </UButton>
      </div>
      <p class="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">
        Add and manage your passkeys here
      </p>
    </template>
    <div v-if="status === 'pending'" class="flex items-center justify-center">
      <UIcon name="i-ph-spinner" class="animate-spin" />
    </div>
    <div v-else-if="status === 'success'">
      <div
        v-if="passkeys.length === 0"
        class="bg-gray-100 dark:bg-gray-800 p-4 rounded text-sm flex items-center flex-col gap-4 justify-center"
      >
        <UIcon name="i-ph-scan-smiley-duotone" class="h-6 w-6" />
        <p>No fingerprints or face IDs linked to your account.</p>
      </div>
      <ul class="divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="passkey in passkeys"
          :key="passkey.id"
          class="flex items-center justify-between py-4"
        >
          <div class="font-mono">
            {{ passkey.name }}
          </div>
          <UButton
            color="rose"
            variant="soft"
            icon="i-ph-trash"
            :loading="deleting === passkey.id"
            :disabled="deleting === passkey.id"
            @click="deletePasskey(passkey.id)"
          >
            Delete
          </UButton>
        </li>
      </ul>
    </div>
  </UCard>
  <UModal v-model="modal">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">Add a new passkey</h2>
          <UButton
            color="gray"
            variant="soft"
            icon="i-ph-x"
            @click="modal = false"
          />
        </div>
      </template>
      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="createPasskey"
      >
        <UFormField label="Name" name="name" size="lg">
          <UInput v-model="state.name" placeholder="Example: My MacBook" />
        </UFormField>
        <UButton
          type="submit"
          :loading="creating"
          :disabled="creating"
          icon="i-ph-fingerprint"
          label="Create Passkey"
          block
          size="lg"
          color="black"
        />
      </UForm>
    </UCard>
  </UModal>
</template>

<script setup>
import { z } from "zod";
import { toast } from "vue-sonner";
const creating = ref(false);
const modal = ref(false);
const { register } = useWebAuthn({
  registerEndpoint: "/api/auth/webauthn/link-passkey",
});
const { user } = useUserSession();
const schema = z.object({
  name: z.string().min(1).max(255),
});
const state = reactive({
  name: undefined,
});

const {
  data: passkeys,
  status,
  refresh,
} = await useFetch("/api/auth/webauthn/linked-passkeys", {
  server: false,
  lazy: true,
});

async function createPasskey(event) {
  try {
    creating.value = true;
    await register({
      userName: user.value.email,
      displayName: event.data.name,
    });

    await refresh();
    modal.value = false;
    state.name = undefined;
    toast.success("Passkey added successfully");
  } catch (error) {
    toast.error(error.data?.message || error.message);
  } finally {
    creating.value = false;
  }
}

const deleting = ref(null);
async function deletePasskey(id) {
  try {
    deleting.value = id;
    await $fetch("/api/auth/webauthn/delete-passkey", {
      method: "DELETE",
      body: { id },
    });
    await refresh();
    toast.success("Passkey deleted successfully");
  } catch (error) {
    toast.error(error.data?.statusMessage || "Failed to delete passkey");
  } finally {
    deleting.value = null;
  }
}
</script>
