<template>
  <div class="study-context-bar" role="status" aria-live="polite">
    <div class="study-context-bar__kicker">Étude de tenue pression</div>
    <div class="study-context-bar__trail row items-center no-wrap">
      <q-btn
        flat
        dense
        no-caps
        class="study-step study-step--network"
        :loading="networkStore.switching"
        :title="status.network.value ?? 'Aucun réseau'"
        aria-label="Changer de réseau"
      >
        <span class="ellipsis">{{ status.network.value ?? 'Aucun réseau' }}</span>
        <q-icon name="expand_more" size="16px" class="study-step__caret" aria-hidden="true" />
        <q-tooltip>Changer de réseau</q-tooltip>
        <q-menu dark class="network-menu">
          <q-list dark dense>
            <q-item-label header class="text-grey-5">Réseaux disponibles</q-item-label>
            <q-item
              v-for="id in networkStore.availableNetworks"
              :key="id"
              v-close-popup
              clickable
              :active="id === networkStore.activeNetwork"
              active-class="text-primary"
              :aria-label="`Charger le réseau ${id}`"
              @click="onPickNetwork(id)"
            >
              <q-item-section avatar>
                <q-icon
                  :name="id === networkStore.activeNetwork ? 'check' : 'hub'"
                  size="18px"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ id }}</q-item-label>
                <q-item-label caption>{{ networkCaption(id) }}</q-item-label>
              </q-item-section>
            </q-item>
            <q-item v-if="networkStore.availableNetworks.length === 0">
              <q-item-section class="text-grey-5">Aucun réseau disponible</q-item-section>
            </q-item>
            <q-separator dark />
            <q-item v-close-popup clickable :to="{ name: 'import' }">
              <q-item-section avatar>
                <q-icon name="upload_file" size="18px" />
              </q-item-section>
              <q-item-section>Importer un réseau</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
      <q-icon name="chevron_right" size="16px" class="study-sep" aria-hidden="true" />
      <span class="study-step ellipsis" :title="status.nomination.value.label">
        {{ status.nomination.value.label }}
      </span>
      <q-icon name="chevron_right" size="16px" class="study-sep" aria-hidden="true" />
      <span
        class="study-step study-step--holding ellipsis"
        :class="`study-step--${status.holding.value.tone}`"
        :title="status.holding.value.label"
      >
        {{ status.holding.value.label }}
      </span>
      <template v-if="showN1">
        <q-icon name="chevron_right" size="16px" class="study-sep gt-sm" aria-hidden="true" />
        <span
          class="study-step ellipsis gt-sm"
          :class="`study-step--${status.n1Status.value.tone}`"
          :title="status.n1Status.value.label"
        >
          {{ status.n1Status.value.label }}
        </span>
      </template>
    </div>
    <div class="study-context-bar__question">{{ status.studyQuestion.value }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useGlobalStatus } from 'src/composables/useGlobalStatus';
import { useNetworkSwitch } from 'src/composables/useNetworkSwitch';
import { useNetworkStore } from 'src/stores/network';
import { networkTierLabel } from 'src/utils/solverPresets';

const status = useGlobalStatus();
const route = useRoute();
const networkStore = useNetworkStore();
const { switchNetwork } = useNetworkSwitch();

const showN1 = computed(
  () => route.name === 'contingency' || status.n1Status.value.status !== 'n/a',
);

function networkCaption(id: string): string {
  const info = networkStore.networkInfo(id);
  if (!info) {
    return 'Jeu de données';
  }
  const demo = info.recommended_demo ? ' ★' : '';
  return `${networkTierLabel(info.tier)} · ${info.node_count} nœuds${demo}`;
}

async function onPickNetwork(id: string): Promise<void> {
  await switchNetwork(id);
}
</script>

<style scoped>
.study-context-bar {
  padding: 6px 16px 8px;
  background: var(--scada-panel, #11161c);
  border-bottom: 1px solid var(--scada-border, #1f2a33);
  min-height: 52px;
}

.study-context-bar__kicker {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8aa4b0;
  line-height: 1.2;
}

.study-context-bar__trail {
  gap: 2px;
  min-width: 0;
  margin-top: 2px;
}

.study-step {
  font-size: 13px;
  font-weight: 600;
  color: #d8edf3;
  max-width: 28vw;
  flex-shrink: 1;
}

.study-step--holding {
  max-width: 36vw;
}

/* Le sélecteur de réseau est ancré dans le header, hors de tout conteneur scrollé :
   le menu se positionne donc sans être clippé par les overlays de la carte. */
.study-step--network {
  padding: 0 2px 0 4px;
  min-height: 0;
}

.study-step--network :deep(.q-btn__content) {
  flex-wrap: nowrap;
  overflow: hidden;
  gap: 2px;
}

.study-step__caret {
  color: #5d7a86;
  flex-shrink: 0;
}

.network-menu :deep(.q-item) {
  min-height: 36px;
}

.study-step--success {
  color: #81c784;
}

.study-step--warning {
  color: #ffb74d;
}

.study-step--danger {
  color: #ef9a9a;
}

.study-sep {
  color: #5d7a86;
  flex-shrink: 0;
}

.study-context-bar__question {
  margin-top: 2px;
  font-size: 12px;
  color: #9bb8c4;
  line-height: 1.35;
}

@media (max-width: 599px) {
  .study-step {
    max-width: 34vw;
    font-size: 12px;
  }
}
</style>
