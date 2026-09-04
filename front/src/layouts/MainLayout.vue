<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-dark app-header" ref="appHeader">
      <q-toolbar class="app-toolbar">
        <q-btn
          flat
          dense
          round
          icon="menu"
          class="lt-md"
          aria-label="Ouvrir le menu"
          @click="leftDrawer = !leftDrawer"
        />

        <q-toolbar-title shrink class="text-weight-bold nav-title">
          <router-link
            :to="{ name: 'dashboard' }"
            class="nav-brand"
            aria-label="Retour à l'accueil"
          >
            <q-icon name="gas_meter" size="sm" class="q-mr-xs" />
            GazFlow
            <q-tooltip>Accueil</q-tooltip>
          </router-link>
        </q-toolbar-title>

        <nav class="gt-sm row items-center no-wrap nav-desktop" aria-label="Navigation principale">
          <q-btn flat no-caps label="Tableau de bord" :to="{ name: 'dashboard' }" exact active-class="nav-active" />
          <q-btn flat no-caps label="Tenue pression" :to="{ name: 'map' }" active-class="nav-active">
            <q-tooltip>Valider une nomination</q-tooltip>
          </q-btn>

          <q-separator vertical dark class="nav-sep" />

          <q-btn-dropdown
            flat
            no-caps
            label="Outils"
            icon="handyman"
            auto-close
            content-class="bg-dark"
          >
            <q-list dark dense>
              <q-item
                v-for="item in toolLinks"
                :key="item.name"
                :to="{ name: item.name }"
                clickable
                v-close-popup
                active-class="text-primary"
              >
                <q-item-section avatar><q-icon :name="item.icon" /></q-item-section>
                <q-item-section>{{ item.label }}</q-item-section>
              </q-item>
            </q-list>
          </q-btn-dropdown>
        </nav>

        <q-space />

        <q-btn
          flat
          round
          icon="refresh"
          aria-label="Relancer la dernière validation"
          :disable="refreshDisabled"
          @click="simulateStore.rerunLastSimulation()"
        >
          <q-tooltip>{{ refreshTooltip }}</q-tooltip>
        </q-btn>
        <q-btn flat round icon="info" aria-label="À propos de GazFlow" @click="showInfo = true">
          <q-tooltip>À propos</q-tooltip>
        </q-btn>
      </q-toolbar>

      <StudyContextBar />
    </q-header>

    <q-drawer
      v-model="leftDrawer"
      bordered
      overlay
      behavior="mobile"
      class="bg-dark text-grey-2"
      :width="280"
    >
      <q-list padding>
        <q-item-label header class="text-grey-5">Étude</q-item-label>
        <q-item
          v-for="item in studyLinks"
          :key="item.name"
          :to="{ name: item.name }"
          clickable
          v-ripple
          :exact="item.name === 'dashboard'"
          active-class="nav-drawer-active"
          @click="leftDrawer = false"
        >
          <q-item-section avatar>
            <q-icon :name="item.icon" />
          </q-item-section>
          <q-item-section>{{ item.label }}</q-item-section>
        </q-item>

        <q-separator dark class="q-my-sm" />
        <q-item-label header class="text-grey-5">Outils</q-item-label>
        <q-item
          v-for="item in toolLinks"
          :key="item.name"
          :to="{ name: item.name }"
          clickable
          v-ripple
          active-class="nav-drawer-active"
          @click="leftDrawer = false"
        >
          <q-item-section avatar>
            <q-icon :name="item.icon" />
          </q-item-section>
          <q-item-section>{{ item.label }}</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>

    <q-dialog v-model="showInfo">
      <q-card class="bg-white text-grey-10 about-card">
        <q-card-section>
          <div class="text-h6 text-grey-10">GazFlow</div>
          <div class="text-caption text-grey-7 q-mt-xs">
            Outil d'étude comparative - non certifié pour l'exploitation temps réel
          </div>
        </q-card-section>
        <q-card-section class="text-body2 text-grey-9 q-gutter-sm">
          <p class="q-ma-none">
            Simulateur d'écoulement de gaz en réseau pour exploitants et ingénieurs d'étude :
            import multi-format, régime permanent, séries horaires, analyse N-1, calage SCADA,
            transitoire et exports.
          </p>
          <p class="text-subtitle2 text-grey-8 q-mb-xs q-mt-md">Licence</p>
          <p class="q-ma-none text-caption text-grey-8">
            Gratuit pour particuliers et recherche académique. Toute entreprise ou
            organisme doit souscrire une licence commerciale Improba (voir LICENSING.md).
          </p>
          <p class="text-subtitle2 text-grey-8 q-mb-xs q-mt-md">Périmètre et limites</p>
          <ul class="about-limits q-ma-none q-pl-md">
            <li>Régime permanent et quasi-stationnaire horaire. Transitoire dynamique (arbres, cycles, organes) ; repli pas à pas si le calcul dynamique ne tient pas.</li>
            <li>Hypothèse isotherme. EOS Papay, PR-78 ou mélange selon H₂. Modèle d'organes simplifié.</li>
            <li>Calage indicatif sur mesures importées : ne remplace pas une validation terrain certifiée.</li>
            <li>Décisions sécurité, contractuelles ou conduite en temps réel : vérification complémentaire obligatoire.</li>
          </ul>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Fermer" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Notify } from 'quasar';
import { useNetworkStore } from 'src/stores/network';
import { useNominationStore } from 'src/stores/nomination';
import { useContingencyStore } from 'src/stores/contingency';
import { useSimulateStore } from 'src/stores/simulate';
import StudyContextBar from 'src/components/StudyContextBar.vue';

const showInfo = ref(false);
const leftDrawer = ref(false);
const appHeader = ref<{ $el?: HTMLElement } | HTMLElement | null>(null);
const route = useRoute();
const simulateStore = useSimulateStore();
const networkStore = useNetworkStore();
const nominationStore = useNominationStore();
const contingencyStore = useContingencyStore();

const isTransientRoute = computed(() => route.name === 'transient');
const refreshDisabled = computed(
  () =>
    isTransientRoute.value
    || simulateStore.loading
    || networkStore.nodes.length === 0
    || !simulateStore.hasLastRun,
);
const refreshTooltip = computed(() =>
  isTransientRoute.value
    ? 'Cette action relance la dernière validation (régime permanent), pas le transitoire.'
    : 'Relancer la dernière validation (mêmes paramètres)',
);

const studyLinks = [
  { name: 'dashboard', label: 'Tableau de bord', icon: 'dashboard' },
  { name: 'map', label: 'Tenue pression', icon: 'verified' },
] as const;

const toolLinks = [
  { name: 'contingency', label: 'Analyser N-1', icon: 'shield' },
  { name: 'calibration', label: 'Caler sur SCADA', icon: 'tune' },
  { name: 'transient', label: 'Transitoire', icon: 'timeline' },
  { name: 'workspace', label: "Espace d'analyse", icon: 'analytics' },
  { name: 'import', label: 'Importer un réseau', icon: 'upload' },
  { name: 'exports', label: 'Exports', icon: 'download' },
  { name: 'batch', label: 'Lot (batch)', icon: 'dynamic_feed' },
] as const;

let headerObserver: ResizeObserver | null = null;

watch(
  () => nominationStore.activeId,
  (id, previous) => {
    if (id === previous) {
      return;
    }
    simulateStore.clearDemandOverrides();
    contingencyStore.reset();
  },
);

function resolveHeaderEl(): HTMLElement | null {
  const value = appHeader.value;
  if (!value) {
    return null;
  }
  if (value instanceof HTMLElement) {
    return value;
  }
  return value.$el instanceof HTMLElement ? value.$el : null;
}

function syncHeaderHeight(): void {
  const el = resolveHeaderEl();
  if (!el) {
    return;
  }
  const height = Math.ceil(el.getBoundingClientRect().height);
  if (height > 0) {
    document.documentElement.style.setProperty('--map-app-header-height', `${height}px`);
  }
}

onMounted(() => {
  void (async () => {
    await networkStore.bootstrap();
    const raw = route.query.run;
    const runId = typeof raw === 'string' ? raw.trim() : '';
    if (!runId) {
      return;
    }
    try {
      await simulateStore.hydrateFromNovaRun(runId);
    } catch (err) {
      console.error(err);
      Notify.create({
        type: 'negative',
        message: 'Impossible de charger le run GazFlow demandé.',
      });
    }
  })();
  syncHeaderHeight();
  const el = resolveHeaderEl();
  if (el && typeof ResizeObserver !== 'undefined') {
    headerObserver = new ResizeObserver(() => {
      syncHeaderHeight();
    });
    headerObserver.observe(el);
  }
});

onBeforeUnmount(() => {
  headerObserver?.disconnect();
  headerObserver = null;
});
</script>

<style scoped>
.app-toolbar {
  min-height: 50px;
}

.nav-title {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-brand {
  display: inline-flex;
  align-items: center;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}

.nav-brand:hover {
  color: var(--q-primary);
}

.nav-desktop {
  gap: 2px;
}

.nav-active {
  color: var(--q-primary);
  border-bottom: 2px solid var(--q-primary);
}

.nav-drawer-active {
  color: var(--q-primary);
  background: rgba(84, 182, 206, 0.12);
}

.nav-sep {
  height: 20px;
  margin: 0 6px;
}

.about-card {
  min-width: min(420px, 92vw);
  max-width: 520px;
}

.about-limits {
  line-height: 1.45;
}
</style>
