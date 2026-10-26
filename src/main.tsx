import { ensureBrowserStorage } from './lib/browserStorage';

// Initialise optional storage before loading SDKs that access it at module scope.
const persistent = ensureBrowserStorage();
document.documentElement.dataset.storagePersistent = String(persistent);
import('./appEntry').catch(() => {
  const root = document.getElementById('root');
  if (root) root.textContent = 'Cambio could not start. Reload the page or try another browser.';
});
