import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

/** Stands in for Safari's built-in speech recognition. */
async function fakeSpeech(page: Page, vendor: string) {
  await page.addInitScript((vendor) => {
    Object.defineProperty(navigator, 'vendor', { value: vendor });
    type Fake = {
      onstart: (() => void) | null;
      onresult: ((event: unknown) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onend: (() => void) | null;
      running: boolean;
    };
    const sessions: Fake[] = [];
    class Recognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      running = false;
      start() {
        this.running = true;
        sessions.push(this);
        setTimeout(() => this.onstart?.(), 0);
      }
      abort() {
        this.running = false;
      }
    }
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition'])
      Object.defineProperty(window, name, { value: Recognition, configurable: true });
    const current = () => sessions.at(-1)!;
    Reflect.set(window, '__speech', {
      count: () => sessions.length,
      running: () => sessions.filter((session) => session.running).length,
      hear: (parts: [string, boolean][]) =>
        current().onresult?.({
          results: parts.map(([transcript, final]) =>
            Object.assign([{ transcript }], { isFinal: final }),
          ),
        }),
      end: () => {
        current().running = false;
        current().onend?.();
      },
    });
  }, vendor);
}

const speech = (page: Page, action: string, ...args: unknown[]) =>
  page.evaluate(
    ([action, args]) => Reflect.get(Reflect.get(window, '__speech'), action as string)(...args),
    [action, args] as const,
  );

test('dictation shows words as they are heard, sends on a pause and keeps listening', async ({
  page,
  context,
}, info) => {
  await installFixture(context, { voice: true, atmee: true });
  await fakeSpeech(page, 'Apple Computer, Inc.');
  const sends: string[] = [];
  let tokens = 0;
  await context.route('**/v1/rpc', async (route) => {
    const { operation, params } = route.request().postDataJSON();
    if (operation.startsWith('voice.')) tokens++;
    if (operation === 'chat.send') sends.push(params.text);
    await route.fallback();
  });
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  const dictate = page.getByRole('button', { name: 'Dictate', exact: true });
  await expect(input).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Start video call' })).toHaveCount(0);
  await expect(dictate).toBeVisible();
  await input.fill('Typing');
  await expect(dictate).toHaveCount(0);
  await input.clear();

  await input.focus();
  await page.keyboard.press('ControlOrMeta+d');
  const stop = page.getByRole('button', { name: 'Stop dictation', exact: true });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('dictation-on.png'), animations: 'disabled' });

  // Words appear as they are heard; nothing is sent until they stop changing.
  await speech(page, 'hear', [['Add milk', false]]);
  await expect(input).toHaveValue('Add milk');
  await page.waitForTimeout(1000);
  await speech(page, 'hear', [['Add milk to the list', false]]);
  await expect(input).toHaveValue('Add milk to the list');
  await page.waitForTimeout(1000);
  expect(sends).toEqual([]);
  await expect.poll(() => sends).toEqual(['Add milk to the list']);
  await expect(input).toHaveValue('');
  await expect(stop).toBeVisible();

  // Safari finishing the sent words does not send them again.
  await speech(page, 'hear', [['Add milk to the list.', true]]);
  await speech(page, 'hear', [
    ['Add milk to the list.', true],
    [' And eggs', false],
  ]);
  await expect(input).toHaveValue('And eggs');
  await expect.poll(() => sends).toEqual(['Add milk to the list', 'And eggs']);

  // Typed text stays in front of dictated words and is sent with them.
  await input.fill('Note:');
  await expect(stop).toBeVisible();
  await speech(page, 'hear', [
    ['Add milk to the list.', true],
    [' And eggs.', true],
    [' call Sam', false],
  ]);
  await expect(input).toHaveValue('Note: call Sam');
  await expect.poll(() => sends.at(-1)).toBe('Note: call Sam');

  // Safari often ends a session at a short mid-sentence pause. The words wait
  // for the next session instead of being sent.
  await speech(page, 'hear', [
    ['Add milk to the list.', true],
    [' And eggs.', true],
    [' call Sam.', true],
    [' Also bread', false],
  ]);
  await expect(input).toHaveValue('Also bread');
  await speech(page, 'end');
  await expect.poll(() => speech(page, 'running')).toBe(1);
  await expect(stop).toBeVisible();
  await page.waitForTimeout(500);
  await speech(page, 'hear', [['and butter', false]]);
  await expect(input).toHaveValue('Also bread and butter');
  await page.waitForTimeout(2000);
  expect(sends.at(-1)).toBe('Note: call Sam');
  await expect.poll(() => sends.at(-1)).toBe('Also bread and butter');
  await expect(input).toHaveValue('');
  await speech(page, 'hear', [
    ['and butter.', true],
    [' Thanks', true],
  ]);
  await expect.poll(() => sends.at(-1)).toBe('Thanks');
  // Nothing goes to ElevenLabs.
  expect(tokens).toBe(0);
  await page.screenshot({ path: info.outputPath('dictation-sent.png'), animations: 'disabled' });

  await page.keyboard.press('ControlOrMeta+d');
  await expect(dictate).toBeVisible();
  expect(await speech(page, 'running')).toBe(0);
});

test('dictation is not offered outside Safari', async ({ page, context }) => {
  await installFixture(context, { voice: true, atmee: true });
  await fakeSpeech(page, 'Google Inc.');
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true })).toHaveCount(0);
});
