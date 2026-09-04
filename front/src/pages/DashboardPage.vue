<template>
  <q-page class="q-pa-md dashboard-page dark">
    <header class="dashboard-header q-mb-lg">
      <div class="text-h4 text-white">Étude</div>
      <div class="text-subtitle2 text-grey-5">
        {{ headerSubtitle }}
      </div>
    </header>

    <section v-if="showStartCta" class="q-mb-md">
      <q-banner rounded class="cta-banner">
        <template #avatar>
          <q-icon name="rocket_launch" color="primary" size="md" />
        </template>
        <div class="text-body2 text-grey-4">
          Lancez la démo (un contrat, un verdict) ou chargez un réseau.
        </div>
        <template #action>
          <div class="row q-gutter-sm">
            <q-btn
              no-caps
              color="primary"
              unelevated
              icon="verified"
              label="Démo nomination"
              :loading="isLoadingDemo"
              :disable="isLoadingDemo"
              @click="onLaunchNominationDemo"
            />
            <q-btn
              no-caps
              color="secondary"
              outline
              icon="upload_file"
              label="Charger un réseau"
              @click="router.push({ name: 'import' })"
            />
          </div>
        </template>
      </q-banner>
    </section>

    <q-banner
      v-if="demoError"
      dense
      rounded
      class="bg-negative text-white q-mb-md"
    >
      {{ demoError }}
    </q-banner>

    <section v-if="showNovaFollowup" class="q-mb-md">
      <VerdictCard @focus-deficits="goToMap" />
      <div class="row q-gutter-sm q-mt-md">
        <q-btn
          no-caps
          color="primary"
          unelevated
          icon="map"
          label="Voir sur la carte"
          @click="router.push({ name: 'map' })"
        />
      </div>
    </section>

    <section v-else-if="showValidateCta" class="q-mb-md">
      <q-banner rounded class="cta-banner">
        <template #avatar>
          <q-icon name="verified" color="primary" size="md" />
        </template>
        <div class="text-body2 text-grey-4">
          Lancez la démo ou ouvrez la tenue pression.
        </div>
        <template #action>
          <div class="row q-gutter-sm">
            <q-btn
              no-caps
              color="primary"
              unelevated
              icon="verified"
              label="Démo nomination"
              :loading="isLoadingDemo"
              :disable="isLoadingDemo"
              @click="onLaunchNominationDemo"
            />
            <q-btn
              no-caps
              color="secondary"
              outline
              icon="map"
              label="Tenue pression"
              @click="router.push({ name: 'map' })"
            />
          </div>
        </template>
      </q-banner>
    </section>

    <section v-else-if="showWorkspaceCta" class="q-mb-md">
      <div class="text-subtitle1 text-white q-mb-sm">Suite de l'étude</div>
      <div class="row q-gutter-sm">
        <q-btn
          color="primary"
          unelevated
          icon="analytics"
          label="Espace d'analyse"
          @click="router.push({ name: 'workspace' })"
        />
      </div>
    </section>

    <div
      v-if="(hasResult && !showNovaFollowup) || recentNetworks.length > 0"
      class="row q-col-gutter-md q-mb-lg"
    >
      <div v-if="hasResult && !showNovaFollowup" class="col-12 col-lg-7">
        <q-card flat bordered class="section-card">
          <q-card-section class="row items-center q-pb-sm">
            <div class="text-h6">Centre d'alertes</div>
            <q-space />
            <q-chip
              dense
              :color="alerts.length > 0 ? 'red-5' : 'green-5'"
              text-color="white"
            >
              {{ alerts.length }}
            </q-chip>
          </q-card-section>
          <q-separator dark />
          <q-card-section class="q-pa-none">
            <q-banner
              v-if="alerts.length === 0"
              dense
              rounded
              class="bg-green-9 text-white q-ma-md"
            >
              <template #avatar>
                <q-icon name="check_circle" />
              </template>
              Aucune alerte active.
            </q-banner>
            <q-list v-else separator dark class="alert-list">
              <q-item
                v-for="alert in alerts"
                :key="alert.id"
                class="alert-item"
                :class="`alert-item--${alert.tone}`"
              >
                <q-item-section avatar>
                  <q-icon :name="alertIcon(alert.tone)" :color="alertToneColor(alert.tone)" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-medium">{{ alert.title }}</q-item-label>
                  <q-item-label caption>{{ alert.body }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </div>

      <div v-if="recentNetworks.length > 0" class="col-12 col-lg-5">
        <q-card flat bordered class="section-card">
          <q-card-section class="q-pb-sm">
            <div class="text-h6">Réseaux récents</div>
          </q-card-section>
          <q-separator dark />
          <q-card-section class="q-pa-none">
            <q-list separator dark>
              <q-item
                v-for="network in recentNetworks"
                :key="network"
                clickable
                v-ripple
                :disable="networkStore.switching"
                :aria-label="`Ouvrir le réseau ${network}`"
                @click="openNetwork(network)"
              >
                <q-item-section avatar>
                  <q-icon name="folder" color="primary" />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ network }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    dense
                    flat
                    round
                    icon="close"
                    color="grey-5"
                    :aria-label="`Retirer ${network} des récents`"
                    @click.stop="removeRecentNetwork(network)"
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useNetworkStore } from 'src/stores/network';
import { useSimulateStore } from 'src/stores/simulate';
import { useAlertCenter, type AlertTone } from 'src/composables/useAlertCenter';
import { useDemo } from 'src/composables/useDemo';
import { useGlobalStatus } from 'src/composables/useGlobalStatus';
import { useNetworkSwitch } from 'src/composables/useNetworkSwitch';
import { useRecentNetworks } from 'src/composables/useRecentNetworks';
import VerdictCard from 'src/components/VerdictCard.vue';

const router = useRouter();
const route = useRoute();
const networkStore = useNetworkStore();
const simulateStore = useSimulateStore();

const { alerts } = useAlertCenter();
const { recentNetworks, removeRecent: removeRecentNetwork } = useRecentNetworks();
const { switchNetwork } = useNetworkSwitch();
const { isLoadingDemo, demoError, launchDemo } = useDemo();
const { studyQuestion } = useGlobalStatus();
function alertToneColor(tone: AlertTone): string {
  switch (tone) {
    case 'danger':
      return 'red-5';
    case 'warning':
      return 'orange-5';
    default:
      return 'blue-grey-4';
  }
}

function alertIcon(tone: AlertTone): string {
  switch (tone) {
    case 'danger':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

const showStartCta = computed(() => networkStore.nodes.length === 0);
const showValidateCta = computed(
  () => networkStore.nodes.length > 0 && simulateStore.result === null,
);
const hasResult = computed(() => simulateStore.result !== null);
const showNovaFollowup = computed(
  () => networkStore.nodes.length > 0 && simulateStore.result !== null && simulateStore.novaActive,
);
const showWorkspaceCta = computed(
  () => networkStore.nodes.length > 0 && simulateStore.result !== null && !simulateStore.novaActive,
);
const headerSubtitle = computed(() =>
  showNovaFollowup.value
    ? studyQuestion.value
    : 'Cette nomination tient-elle les bornes de livraison ?',
);

async function onLaunchNominationDemo(): Promise<void> {
  const raw = route.query.run;
  const fallbackRunId = typeof raw === 'string' ? raw : undefined;
  try {
    await launchDemo(fallbackRunId);
    await router.push({ name: 'map' });
  } catch {
    // Erreur déjà notifiée par useDemo.
  }
}

function goToMap(): void {
  void router.push({ name: 'map' });
}

async function openNetwork(networkId: string): Promise<void> {
  const outcome = await switchNetwork(networkId);
  if (outcome === 'switched' || outcome === 'already-active') {
    void router.push({ name: 'map' });
  }
  // 'cancelled' / 'busy' / 'failed' : on reste sur le tableau de bord, l'erreur est déjà portée
  // par networkStore.error.
}
</script>

<style scoped>
.dashboard-page {
  background: radial-gradient(circle at 15% 15%, #123040 0%, var(--scada-bg) 48%);
  color: var(--scada-text);
  min-height: 100%;
}

.dashboard-header {
  border-bottom: 1px solid var(--scada-border);
  padding-bottom: 12px;
}

.section-card {
  background: var(--scada-panel);
  border: 1px solid var(--scada-border);
  color: var(--scada-text);
  height: 100%;
}

.alert-list {
  max-height: 320px;
  overflow-y: auto;
}

.alert-item {
  border-left: 3px solid transparent;
}

.alert-item--danger {
  border-left-color: var(--q-negative);
}

.alert-item--warning {
  border-left-color: var(--q-warning);
}

.alert-item--info {
  border-left-color: #78909c;
}

.cta-banner {
  background: var(--scada-panel);
  border: 1px solid var(--scada-border);
}
</style>
