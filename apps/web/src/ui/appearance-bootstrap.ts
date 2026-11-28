import type { AppearanceMode, ChatBubbleMode } from '@hermes-client/protocol';

export function initializeChatBubbles(choice?: ChatBubbleMode): ChatBubbleMode {
  const key = 'pebble-crew.chat-bubbles';
  let saved: string | null = null;
  try {
    if (choice) localStorage.setItem(key, choice);
    saved = localStorage.getItem(key);
  } catch {
    // Apply the choice even when the browser cannot save preferences.
  }
  const mode = choice ?? (saved === 'neutral' ? 'neutral' : 'pebble');
  document.documentElement.dataset.chatBubbles = mode;
  return mode;
}

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
    ?.setAttribute('content', dark ? '#111113' : '#faf9f6');
  return mode;
}

export function localAppearanceChoices(): {
  appearance?: AppearanceMode | undefined;
  chatBubbles?: ChatBubbleMode | undefined;
} {
  try {
    const appearance = localStorage.getItem('pebble-crew.appearance');
    const chatBubbles = localStorage.getItem('pebble-crew.chat-bubbles');
    return {
      appearance:
        appearance === 'light' || appearance === 'dark' || appearance === 'system'
          ? appearance
          : undefined,
      chatBubbles: chatBubbles === 'neutral' || chatBubbles === 'pebble' ? chatBubbles : undefined,
    };
  } catch {
    return {};
  }
}
