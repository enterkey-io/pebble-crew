export type AppearanceMode = 'light' | 'dark' | 'system';

// This function is also emitted as a synchronous, same-origin startup script.
export function initializeAppearance(choice?: AppearanceMode): AppearanceMode {
  const key = 'pebble-crew.appearance';
  let saved: string | null = null;
  try {
    if (choice) localStorage.setItem(key, choice);
    saved = localStorage.getItem(key);
  } catch {
    // The selected appearance still works when browser storage is unavailable.
  }
  const mode = choice ?? (saved === 'light' || saved === 'dark' ? saved : 'system');
  const dark =
    mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.appearance = mode;
  root.style.colorScheme = dark ? 'dark' : 'light';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0c0c0e' : '#faf9f6');
  return mode;
}
