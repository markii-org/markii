import { expect, test, type Page } from '@playwright/test';
import { DATA_PORT_A, DATA_PORT_B, ORIGIN_A } from './constants';

interface OpenOptions {
  text?: string;
  allow?: string[];
  timeoutMs?: number;
}

async function openNote(page: Page, options: OpenOptions = {}): Promise<void> {
  const params = new URLSearchParams();
  if (options.text !== undefined) params.set('text', options.text);
  if (options.allow) params.set('allow', options.allow.join(','));
  if (options.timeoutMs !== undefined) {
    params.set('timeout', String(options.timeoutMs));
  }
  await page.goto(`/?${params.toString()}`);
  await expect(page.getByTestId('doc')).toBeVisible();
}

const fetchNote = (port: number): string =>
  [
    'Result: :value[result]',
    '',
    '```lua {name=result permissions=127.0.0.1}',
    `local r = net.fetch_json("http://127.0.0.1:${String(port)}/data.json")`,
    'return r.msg',
    '```',
    '',
  ].join('\n');

test('a note renders its standard components', async ({ page }) => {
  await openNote(page);
  await expect(page.getByTestId('doc')).toContainText(
    'A standard component renders.',
  );
  await expect(page.locator('.mk-callout')).toBeVisible();
});

test('Run executes a Lua script in the Web Worker and the value appears', async ({
  page,
}) => {
  await openNote(page);
  await expect(page.locator('.mk-value')).not.toContainText('42');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run-marker')).toHaveAttribute(
    'data-state',
    'ok',
  );
  await expect(page.locator('.mk-value')).toContainText('42');
});

test('a runaway script is ended at the wall-clock limit and the page shows the failure marker', async ({
  page,
}) => {
  await openNote(page, {
    text: '```lua {name=loop}\nwhile true do end\n```\n\nLoop: :value[loop]\n',
    timeoutMs: 2000,
  });
  const started = Date.now();
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run-marker')).toHaveAttribute(
    'data-state',
    'failed',
  );
  // The watchdog (or the instruction limit) ends it; the page is not hung.
  expect(Date.now() - started).toBeLessThan(30_000);
  await expect(page.getByTestId('doc')).toBeVisible();
  // The failure also reached the diagnostics surface.
  await expect(page.getByTestId('diagnostics').locator('li')).not.toHaveCount(
    0,
  );
});

test('a request to an allowed origin succeeds after the grant prompt', async ({
  page,
}) => {
  await openNote(page, { text: fetchNote(DATA_PORT_A), allow: [ORIGIN_A] });
  await page.getByTestId('run').click();
  await expect(page.getByTestId('prompt-dialog')).toBeVisible();
  await page.getByTestId('prompt-allow').click();
  await expect(page.getByTestId('run-marker')).toHaveAttribute(
    'data-state',
    'ok',
  );
  await expect(page.locator('.mk-value')).toContainText('hello from allowed');
});

test('a granted host on a different origin is denied by the page-side allowlist', async ({
  page,
}) => {
  await openNote(page, { text: fetchNote(DATA_PORT_B), allow: [ORIGIN_A] });
  await page.getByTestId('run').click();
  await expect(page.getByTestId('prompt-dialog')).toBeVisible();
  await page.getByTestId('prompt-allow').click();
  await expect(page.getByTestId('run-marker')).toHaveAttribute(
    'data-state',
    'failed',
  );
  await expect(page.locator('.mk-value')).not.toContainText('hello from');
});

test('denying the grant prompt fails the run without any request', async ({
  page,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await openNote(page, { text: fetchNote(DATA_PORT_A), allow: [ORIGIN_A] });
  await page.getByTestId('run').click();
  await expect(page.getByTestId('prompt-dialog')).toBeVisible();
  await page.getByTestId('prompt-deny').click();
  await expect(page.getByTestId('run-marker')).toHaveAttribute(
    'data-state',
    'failed',
  );
  expect(requested.filter((url) => url.startsWith(ORIGIN_A))).toEqual([]);
});

test('the Lua engine never fetches its wasm from a CDN', async ({ page }) => {
  const external: string[] = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1')) {
      external.push(request.url());
    }
  });
  await openNote(page);
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run-marker')).toHaveAttribute(
    'data-state',
    'ok',
  );
  await expect(page.locator('.mk-value')).toContainText('42');
  expect(external).toEqual([]);
});

test('renderCode replaces a fenced block with the callback output', async ({
  page,
}) => {
  await openNote(page, {
    text: '```e2e-widget\nhello widget\n```\n\n```js\nplain();\n```\n',
  });
  await expect(page.getByTestId('custom-code')).toHaveText(
    'custom: hello widget',
  );
  await expect(page.locator('pre')).toContainText('plain();');
});

test('a prebuilt .mkp installed in the browser host renders its component', async ({
  page,
}) => {
  await openNote(page, { text: '::e2e_badge{label="from the pack"}\n' });
  await expect(page.getByTestId('doc')).toContainText('unknown component');
  await page.getByTestId('install-pack').click();
  await expect(page.getByTestId('prompt-dialog')).toBeVisible();
  await page.getByTestId('prompt-allow').click();
  await expect(page.getByTestId('packs')).toHaveText('e2e');
  await expect(page.getByTestId('pack-badge')).toHaveText(
    'pack says: from the pack',
  );
});
