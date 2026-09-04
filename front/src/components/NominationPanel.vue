<template>
  <div class="nomination-panel q-mb-sm">
    <div class="row items-center q-mb-xs no-wrap">
      <q-icon name="assignment" size="18px" class="q-mr-xs text-secondary">
        <q-tooltip max-width="280px">
          Quantités entry/exit et bornes pression contractuelles.
          Valider évalue la tenue de chaque point de livraison.
        </q-tooltip>
      </q-icon>
      <span class="text-caption text-bold text-grey-3">Nomination</span>
      <q-space />
      <q-btn
        v-if="nominationStore.selected?.source === 'imported' && !showDemoPair"
        flat
        dense
        round
        icon="delete_outline"
        size="sm"
        :disable="disabled"
        @click="onDelete"
      >
        <q-tooltip>Supprimer la nomination importée</q-tooltip>
      </q-btn>
      <q-btn
        v-if="!showDemoPair"
        flat
        dense
        round
        icon="file_upload"
        size="sm"
        :disable="disabled"
        @click="onUploadClick"
      >
        <q-tooltip>Importer un fichier .scn personnalisé</q-tooltip>
      </q-btn>
      <input
        ref="fileInput"
        type="file"
        accept=".scn"
        class="hidden-input"
        @change="onFileSelected"
      />
    </div>

    <div v-if="showDemoPair" class="nomination-pair">
      <q-btn
        unelevated
        no-caps
        class="full-width"
        :color="isSelected(jour?.id) ? 'primary' : 'blue-grey-8'"
        :outline="!isSelected(jour?.id)"
        :disable="disabled || !jour"
        label="Nomination du jour"
        @click="jour && onSelect(jour.id)"
      />
      <q-btn
        unelevated
        no-caps
        class="full-width q-mt-xs"
        :color="isSelected(pointe?.id) ? 'primary' : 'blue-grey-8'"
        :outline="!isSelected(pointe?.id)"
        :disable="disabled || !pointe"
        label="Nomination de pointe"
        @click="pointe && onSelect(pointe.id)"
      />
      <div class="text-caption text-grey-5 q-mt-xs">
        Jour : contrat large (20–70 barg). Pointe : besoin 68 barg sur un point.
      </div>
    </div>

    <q-select
      v-else
      :model-value="nominationStore.activeId"
      :options="pickerOptions"
      :option-label="nominationOptionLabel"
      option-value="id"
      emit-value
      map-options
      placeholder="Choisir une nomination"
      dense
      outlined
      dark
      hide-bottom-space
      clearable
      :loading="nominationStore.loading"
      :disable="disabled"
      @update:model-value="onSelect"
    >
      <template #option="scope">
        <q-item v-bind="scope.itemProps">
          <q-item-section>
            <q-item-label>{{ nominationOptionLabel(scope.opt) }}</q-item-label>
            <q-item-label v-if="scope.opt.source === 'imported'" caption>
              importée
            </q-item-label>
          </q-item-section>
        </q-item>
      </template>
    </q-select>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Notify } from 'quasar';
import { useNetworkStore } from 'src/stores/network';
import { useNominationStore } from 'src/stores/nomination';
import { findDemoPair, nominationPickerLabel } from 'src/utils/nominationPicker';
import type { NovaScenarioSummary } from 'src/services/api';

defineProps<{ disabled?: boolean }>();

const nominationStore = useNominationStore();
const networkStore = useNetworkStore();
const fileInput = ref<HTMLInputElement | null>(null);

const pickerOptions = computed(() => nominationStore.studyList);

const demoPair = computed(() => findDemoPair(pickerOptions.value));
const jour = computed(() => demoPair.value.jour);
const pointe = computed(() => demoPair.value.pointe);
const showDemoPair = computed(() => Boolean(jour.value && pointe.value));

function isSelected(id: string | undefined): boolean {
  return Boolean(id) && nominationStore.activeId === id;
}

function nominationOptionLabel(opt: NovaScenarioSummary | string): string {
  if (typeof opt === 'string') {
    return nominationPickerLabel(opt);
  }
  return nominationPickerLabel(opt.filename);
}

function onSelect(id: string | null) {
  nominationStore.selectById(id);
}

function onUploadClick() {
  fileInput.value?.click();
}

async function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  try {
    await nominationStore.importFile(file);
  } catch (err) {
    Notify.create({
      type: 'negative',
      message: err instanceof Error ? err.message : 'Import .scn échoué',
    });
  } finally {
    target.value = '';
  }
}

async function onDelete() {
  const id = nominationStore.selected?.id;
  if (!id) return;
  try {
    await nominationStore.removeImported(id);
    Notify.create({ type: 'positive', message: 'Nomination supprimée' });
  } catch (err) {
    Notify.create({
      type: 'negative',
      message: err instanceof Error ? err.message : 'Suppression échouée',
    });
  }
}

watch(
  () => networkStore.activeNetwork,
  () => {
    void nominationStore.load(true);
  },
);

onMounted(() => {
  void nominationStore.load();
});
</script>

<style scoped>
.hidden-input {
  display: none;
}
</style>
