import { test, expect } from '@playwright/test';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('existing agent names keep accents while search accepts plain, accented and decomposed spelling', async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context);
  const agent = fixture.state.bots.find((b) => b.profile === 'existing-example')!;
  agent.profile = 'profile-87';
  agent.handle = 'profile-87';
  agent.name = 'Öykü';
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  if (info.project.use.isMobile)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New pebble', exact: true }).click();
  await page.getByRole('button', { name: 'Add existing Hermes agent', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search Hermes agents' });
  const choice = page.getByRole('button', { name: /Öykü.*@profile-87/ });
  for (const query of ['oyku', 'Öykü', 'OYKU', 'O\u0308yku\u0308', 'öyk']) {
    await search.fill(query);
    await expect(choice).toBeVisible();
    await expect(choice).toContainText('Öykü');
  }
  await search.fill('someone else');
  await expect(choice).toHaveCount(0);
  await expect(page.getByText('No matching agents.', { exact: true })).toBeVisible();
  await search.fill('oyku');
  await page.screenshot({
    path: info.outputPath('accent-preserved-search.png'),
    animations: 'disabled',
  });
  await choice.click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Öykü');
});
