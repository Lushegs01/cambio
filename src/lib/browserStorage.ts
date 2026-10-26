/** Some wallet SDKs read localStorage during module initialisation, before React can handle errors. */
export function ensureBrowserStorage(): boolean {
  try {
    const storage = window.localStorage;
    storage.getItem('cambio.storage.probe');
    const key = `cambio.storage.probe.${crypto.randomUUID()}`;
    storage.setItem(key, '1'); storage.removeItem(key);
    return true;
  } catch {
    const values = new Map<string, string>();
    const memory: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(String(key)) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(String(key)); },
      setItem: (key, value) => { values.set(String(key), String(value)); },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memory });
    return false;
  }
}
