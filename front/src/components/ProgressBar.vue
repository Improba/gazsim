<template>
  <div v-if="simulateStore.loading" class="q-mb-md">
    <div class="text-caption text-grey-4 q-mb-xs">Validation en cours…</div>
    <q-linear-progress
      indeterminate
      color="primary"
      aria-label="Validation en cours"
    />
  </div>
</template>

<script setup lang="ts">
import { useSimulateStore } from 'src/stores/simulate';

const simulateStore = useSimulateStore();
</script>
