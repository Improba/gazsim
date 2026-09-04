import { ref } from 'vue';
import { Notify } from 'quasar';
import { runNominationDemo, DEMO_NETWORK_ID } from 'src/utils/demoCase';
import { formatApiError } from 'src/utils/importError';
import { useRecentNetworks } from 'src/composables/useRecentNetworks';

export function useDemo() {
  const isLoadingDemo = ref(false);
  const demoError = ref<string | null>(null);

  async function launchDemo(fallbackRunId?: string): Promise<void> {
    if (isLoadingDemo.value) {
      return;
    }
    isLoadingDemo.value = true;
    demoError.value = null;
    try {
      await runNominationDemo({ fallbackRunId });
      const { addRecent } = useRecentNetworks();
      addRecent(DEMO_NETWORK_ID);
    } catch (err) {
      demoError.value = formatApiError(err);
      Notify.create({
        type: 'negative',
        message: demoError.value,
        timeout: 5000,
      });
      throw err;
    } finally {
      isLoadingDemo.value = false;
    }
  }

  return {
    isLoadingDemo,
    demoError,
    launchDemo,
  };
}
