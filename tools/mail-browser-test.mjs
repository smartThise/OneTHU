/** MailPage and real mail.ts lifecycle with mock IPC/config only. All remote
 * URLs are blocked; no native mailbox, account or outgoing message is used. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.ONETHU_TEST_URL ?? 'http://127.0.0.1:5180';
const out = process.env.ONETHU_TEST_OUT ?? '/tmp/onethu-mail-lifecycle';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
let passed = 0;
const check = (value, label) => { assert.ok(value, label); passed++; };
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width === 390 });
    page.setDefaultTimeout(12000);
    await page.routeWebSocket(/(?:127\.0\.0\.1|localhost):5180/, () => {});
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
      if (url.pathname === '/src/state/mail.ts') {
        const response = await route.fetch();
        const source = (await response.text()).replace(/^import \{ invoke \} from .*;$/m, 'const invoke = (...args) => window.__mailIPC(...args);');
        assert.ok(source.includes('const invoke = (...args)'), 'actual mailbox only IPC dependency replaced');
        return route.fulfill({ response, body: source });
      }
      if (url.pathname === '/src/state/cloudCal.ts') {
        const response = await route.fetch();
        return route.fulfill({ response, body: (await response.text()) + '\nloaded=true;credentialsLoaded=true;mirrorReady=true;cfg={email:"a@example.invalid",authCode:"fixture-a"};window.__mailConfig=(next)=>{cfg=next;emitConfig();emit();};\n' });
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      localStorage.setItem('onethu.onboarded.phone', '1');
      localStorage.setItem('onethu.onboarded.flow3', '1');
      localStorage.setItem('onethu.onboarded.flow4', '1');
      localStorage.setItem('onethu.privacy.v1', JSON.stringify({ acknowledged: true, cloud: true, oh: true }));
      localStorage.setItem('onethu.experience.v1', 'full');
      localStorage.setItem('onethu.overlay.closed', '1');
      window.__mailPending = [];
      window.__mailCalls = [];
      window.__mailListFailure = false;
      const head = (uid, subject) => ({ uid, subject, from: 'fixture@example.invalid', dateMs: 1800000000000, seen: false });
      window.__mailIPC = async (cmd, args) => {
        window.__mailCalls.push({ cmd, folder: args.folder });
        if (cmd === 'mail_list') {
          if (window.__mailListFailure) throw new Error('示例连接失败');
          return { heads: [head(1, `${args.email.startsWith('b@') ? '乙账号' : '甲账号'}${args.folder === 'INBOX' ? '收件' : '已发送'}示例`), head(2, '读取失败示例')], total: 2, minSeq: 1 };
        }
        if (cmd === 'mail_read') {
          if (args.uid === 2) throw new Error('示例正文读取失败');
          return { subject: '甲账号正文', from: 'fixture@example.invalid', to: args.email, dateMs: 1800000000000, text: '独立测试正文', html: null };
        }
        if (cmd === 'mail_search' || cmd === 'mail_send') return new Promise((resolve, reject) => window.__mailPending.push({ cmd, resolve, reject }));
        if (cmd === 'mail_mark_seen') return;
        throw new Error(`Unexpected fixture command: ${cmd}`);
      };
    });
    await page.goto(base + '/?explorer-preview=onboarding');
    await page.locator('.explorer-shell').waitFor();
    await page.evaluate(async () => {
      const path = '/src/state/explorer.ts';
      const url = performance.getEntriesByType('resource').filter(e => new URL(e.name).pathname === path).at(-1)?.name ?? path;
      window.__mailExplorer = await import(url);
      window.__mailExplorer.openTab('mail');
    });
    const root = page.locator('[data-tab-page="mail"]:visible');
    await root.getByText('甲账号收件示例', { exact: true }).waitFor();
    check(await root.locator('.mail-row').count() === 2, `${width}: actual mailbox list loaded`);
    const click = async (locator) => width === 390 ? locator.tap() : locator.click();
    const search = root.getByPlaceholder('搜索邮件（回车全箱搜）');
    await search.fill('cancel fixture'); await search.press('Enter');
    await root.getByTitle('取消搜索').waitFor(); await click(root.getByTitle('取消搜索'));
    await page.evaluate(() => window.__mailPending.shift().resolve([{ uid: 20, subject: '过时搜索结果', from: 'fixture@example.invalid', dateMs: 0, seen: false }]));
    await page.waitForTimeout(80);
    check(await root.getByText('过时搜索结果', { exact: true }).count() === 0, `${width}: cancelled search response never replaces list`);
    check(await search.inputValue() === '', `${width}: cancel clears query`);
    await search.fill('folder fixture'); await search.press('Enter'); await root.getByTitle('取消搜索').waitFor();
    await click(root.locator('.mail-toolbar .segmented button').filter({ hasText: '已发送' }));
    await root.getByText('甲账号已发送示例', { exact: true }).waitFor();
    await page.evaluate(() => window.__mailPending.shift().resolve([{ uid: 21, subject: '旧文件夹搜索结果', from: 'fixture@example.invalid', dateMs: 0, seen: false }]));
    await page.waitForTimeout(80);
    check(await root.getByText('旧文件夹搜索结果', { exact: true }).count() === 0, `${width}: folder switch invalidates pending search`);
    await click(root.locator('.mail-toolbar .segmented button').filter({ hasText: '收件箱' }));
    await click(root.getByText('甲账号收件示例', { exact: true })); await root.getByText('独立测试正文', { exact: true }).waitFor();
    check(await root.locator('.mail-detail-text').textContent() === '独立测试正文', `${width}: real row opens actual detail`);
    await click(root.locator('.mail-detail').getByRole('button', { name: '返回', exact: true }));
    await click(root.getByText('读取失败示例', { exact: true })); await root.getByText('读取失败：示例正文读取失败', { exact: true }).waitFor();
    check(await root.getByText('独立测试正文', { exact: true }).count() === 0, `${width}: failed next UID does not retain previous body`);
    await click(root.locator('.mail-detail').getByRole('button', { name: '返回', exact: true }));
    await search.fill('account fixture'); await search.press('Enter'); await root.getByTitle('取消搜索').waitFor();
    await page.evaluate(() => window.__mailConfig({ email: 'b@example.invalid', authCode: 'fixture-b' }));
    await root.getByText('乙账号收件示例', { exact: true }).waitFor();
    await page.evaluate(() => window.__mailPending.shift().resolve([{ uid: 22, subject: '旧账号搜索结果', from: 'fixture@example.invalid', dateMs: 0, seen: false }]));
    await page.waitForTimeout(80);
    check(await root.getByText('旧账号搜索结果', { exact: true }).count() === 0, `${width}: account switch invalidates search`);
    check(await root.getByText('甲账号收件示例', { exact: true }).count() === 0, `${width}: account switch clears old header`);
    await click(root.getByRole('button', { name: '写信', exact: true }));
    const compose = page.getByRole('dialog', { name: '写信', exact: true });
    await compose.getByPlaceholder('user@mails.tsinghua.edu.cn（多个用逗号分隔）').fill('recipient@example.invalid');
    await compose.getByPlaceholder('邮件主题').fill('Fixture only');
    const send = compose.getByRole('button', { name: '发送', exact: true });
    await click(send);
    check(await compose.getByRole('button', { name: '发送中…', exact: true }).isDisabled(), `${width}: dispatched send cannot be double-submitted`);
    await page.evaluate(() => window.__mailPending.shift().reject(new Error('示例发送失败')));
    await compose.getByText('示例发送失败', { exact: true }).waitFor();
    check(await compose.getByPlaceholder('邮件主题').inputValue() === 'Fixture only', `${width}: send failure preserves draft`);
    check(await page.evaluate(() => window.__mailCalls.filter(c => c.cmd === 'mail_send').length) === 1, `${width}: failed send never automatically retries`);
    await page.screenshot({ path: `${out}/compose-${width}.png` });
    await click(compose.getByRole('button', { name: '取消', exact: true }));
    await page.waitForTimeout(300);
    check(await compose.count() === 0, `${width}: portal compose can be cancelled without toolbar interception`);
    check(await root.getByRole('button', { name: '写信', exact: true }).evaluate(el => document.activeElement === el), `${width}: closing compose restores focus to its actual launcher`);
    await page.screenshot({ path: `${out}/mail-${width}.png` });
    // Bug 4：文件夹 tab 必须复用全站统一的 SegmentedOverflow（深色选中胶囊 + 段轨），
    // 不能继续自建一套「浅灰选中」的分段条。用实际的信息页 tab 做同款对照。
    const mailTabs = await root.evaluate((el) => {
      const ov = el.querySelector('.mail-toolbar .seg-ov');
      const track = ov?.querySelector('.segmented.seg-track');
      const buttons = [...(track?.querySelectorAll('button[role="tab"]') ?? [])];
      const active = track?.querySelector('button.is-active');
      const cs = active ? getComputedStyle(active) : null;
      return {
        hasOverflow: !!ov,
        hasTrack: !!track,
        roles: buttons.map((b) => b.getAttribute('role')),
        selected: buttons.map((b) => b.getAttribute('aria-selected')),
        activeStyle: cs ? { bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius, h: cs.height, pad: cs.paddingInline } : null,
      };
    });
    check(mailTabs.hasOverflow && mailTabs.hasTrack && mailTabs.roles.length === 2 && mailTabs.roles.every((r) => r === 'tab'),
      `${width}: mail folder tabs reuse the shared SegmentedOverflow structure`);
    check(mailTabs.selected.filter((v) => v === 'true').length === 1, `${width}: exactly one folder tab is marked selected`);
    await page.evaluate(async () => {
      const path = '/src/state/explorer.ts';
      const url = performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path;
      (await import(url)).openTab('info');
    });
    const infoActive = await page.locator('[data-tab-page="info"]:visible .segmented button.is-active').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius, h: cs.height, pad: cs.paddingInline };
    });
    check(JSON.stringify(mailTabs.activeStyle) === JSON.stringify(infoActive),
      `${width}: mail folder tab active style matches the app-wide tab bar`);
    await page.evaluate(async () => {
      const path = '/src/state/explorer.ts';
      const url = performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === path).at(-1)?.name ?? path;
      (await import(url)).openTab('mail');
    });
    await page.locator('[data-tab-page="mail"]:visible .mail-row').first().waitFor();
    await page.evaluate(() => { window.__mailListFailure = true; window.__mailConfig({ email: 'c@example.invalid', authCode: 'fixture-c' }); });
    await root.getByText('示例连接失败', { exact: true }).waitFor();
    check(await root.getByText('没有邮件', { exact: true }).count() === 0, `${width}: connection failure is not falsely empty`);
    await page.evaluate(() => window.__mailConfig(null));
    await root.getByRole('heading', { name: '邮箱待配置' }).waitFor();
    check(await root.locator('.mail-row').count() === 0, `${width}: disconnect clears visible account data`);
    await page.close();
  }
  writeFileSync(`${out}/report.json`, JSON.stringify({ passed, viewports: [1280, 390], fixture: 'actual MailPage + mail state, isolated config and IPC; remote URLs blocked' }, null, 2));
  console.log(`Mailbox browser: ${passed} checks passed (desktop click + phone touch).`);
} finally { await browser.close(); }
