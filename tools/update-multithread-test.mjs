#!/usr/bin/env node
/**
 * 多线程下载线程数：共享偏好模块 + 设置页持久化 + 更新下载传参 + 原生分段接口静态契约。
 * 纯静态 / 假 IPC，不下载、不触碰真实安装包。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log('✓ ' + label); };

/* ── ① 共享偏好模块（真正执行 lib/downloadPrefs.ts） ── */
const prefsSource = readFileSync('apps/desktop/src/lib/downloadPrefs.ts', 'utf8');
const prefsJs = ts.transpileModule(prefsSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const prefs = await import('data:text/javascript;base64,' + Buffer.from(prefsJs).toString('base64'));

check(prefs.DOWNLOAD_THREADS_KEY === 'onethu.download.threads', 'preference key is stable for future download reuse');
check(prefs.DEFAULT_DOWNLOAD_THREADS === 8, 'default thread count is 8');
check(JSON.stringify(prefs.DOWNLOAD_THREAD_OPTIONS) === JSON.stringify([1, 2, 4, 6, 8, 12, 16]), 'selector offers 1/2/4/6/8/12/16');
check(prefs.normalizeDownloadThreads(undefined) === 8 && prefs.normalizeDownloadThreads('') === 8 && prefs.normalizeDownloadThreads('abc') === 8, 'missing/invalid values fall back to the default');
check(prefs.normalizeDownloadThreads(0) === 1 && prefs.normalizeDownloadThreads(-3) === 1, 'values below the range clamp to 1');
check(prefs.normalizeDownloadThreads(99) === 16 && prefs.normalizeDownloadThreads('64') === 16, 'values above the range clamp to 16');
check(prefs.normalizeDownloadThreads(6) === 6 && prefs.normalizeDownloadThreads('12') === 12, 'numeric and string inputs normalize');

const store = new Map();
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};
check(prefs.readDownloadThreads() === 8, 'empty storage reads the default');
check(prefs.writeDownloadThreads(12) === 12 && store.get(prefs.DOWNLOAD_THREADS_KEY) === '12', 'writing persists the normalized thread count');
check(prefs.readDownloadThreads() === 12, 'reading returns the persisted thread count');
prefs.writeDownloadThreads('0');
check(store.get(prefs.DOWNLOAD_THREADS_KEY) === '1' && prefs.readDownloadThreads() === 1, 'persistence also normalizes out-of-range values');
store.set(prefs.DOWNLOAD_THREADS_KEY, 'not-a-number');
check(prefs.readDownloadThreads() === 8, 'corrupt storage falls back safely');
store.clear();

/* ── ② 更新下载把线程数传给原生（真正执行 downloadUpdate） ── */
const updaterSource = readFileSync('apps/desktop/src/lib/updater.ts', 'utf8');
const ast = ts.createSourceFile('updater.ts', updaterSource, ts.ScriptTarget.Latest, true);
const code = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
let invokeCalls = [];
globalThis.__multithreadFixture = {
  i18n: (key, params) => key + JSON.stringify(params ?? {}),
  i18nMsg: key => ({ kind: 'i18n', key }),
  resolveMessage: value => (typeof value === 'string' ? value : value.key),
  currentVersion: () => '0.11.4-fix-1',
  isNewer: () => false,
  isAndroidNavigator: () => false,
  logLine: async () => undefined,
  universalFetch: async () => new Response('{}'),
  invoke: async (command, args) => {
    invokeCalls.push({ command, args });
    if (command === 'updater_download') return { path: '/tmp/OneTHU.apk', dir: '/tmp', size: 3, sha256: 'a'.repeat(64), verified: true };
    return null;
  },
  normalizeDownloadThreads: prefs.normalizeDownloadThreads,
};
const prelude = 'const {i18n,i18nMsg,resolveMessage,currentVersion,isNewer,isAndroidNavigator,logLine,universalFetch,invoke,normalizeDownloadThreads}=globalThis.__multithreadFixture;\n';
const updaterJs = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const updater = await import('data:text/javascript;base64,' + Buffer.from(prelude + updaterJs).toString('base64'));

const download = async threads => {
  invokeCalls = [];
  const result = await updater.downloadUpdate({ url: 'https://example.test/OneTHU.apk', fileName: 'OneTHU.apk', ...(threads === undefined ? {} : { threads }) });
  const call = invokeCalls.find(entry => entry.command === 'updater_download');
  assert.ok(call, 'updater_download must be invoked');
  assert.equal(result.ok, true);
  return call.args;
};
check((await download(16)).threads === 16, 'explicit 16 threads reach the native command');
check((await download(12)).threads === 12, 'explicit 12 threads reach the native command');
check((await download(0)).threads === 1, 'out-of-range thread counts are clamped before the IPC call');
check((await download(undefined)).threads === 8, 'omitted threads default to 8 at the IPC boundary');
check((await download(16)).expectSha256 === null && (await download(16)).expectSize === null, 'existing null size/hash IPC contract is unchanged');

/* ── ③ 设置页 / 更新 UI 的接线（静态契约） ── */
const settings = readFileSync('apps/desktop/src/pages/Settings.tsx', 'utf8');
check(settings.includes('readDownloadThreads') && settings.includes('writeDownloadThreads') && settings.includes('downloadThreadChoices'), 'settings download page reuses the shared preference module');
check(settings.includes('pages.settings.f28df1344b6a') && settings.includes('pages.settings.803fd2fd23f1'), 'thread-count row is localized with dedicated labels');
check(/<Select[^>]*value=\{String\(threads\)\}/.test(settings), 'thread count is edited through the OneGUI Select');
check(settings.includes('onChange={(value) => setThreads(writeDownloadThreads(value))}'), 'changing the selector persists the choice');

const updateUi = readFileSync('apps/desktop/src/components/SoftwareUpdateSection.tsx', 'utf8');
check(updateUi.includes('readDownloadThreads') && updateUi.includes('threads: readDownloadThreads()'), 'update download passes the persisted thread count');

/* ── ④ 原生分段下载接口契约（Rust 源码静态检查） ── */
const rustDownload = readFileSync('apps/desktop/src-tauri/src/update_download.rs', 'utf8');
const rustCommand = readFileSync('apps/desktop/src-tauri/src/updater.rs', 'utf8');
check(rustCommand.includes('threads: Option<u32>'), 'updater_download accepts an optional threads parameter');
check(rustCommand.includes('download::download(&dir, &url, &file_name, expect_size, expect_sha256.as_deref(), threads'), 'native command forwards threads into the transport');
check(rustDownload.includes('pub const DEFAULT_THREADS: u32 = 8') && rustDownload.includes('pub const MAX_THREADS: u32 = 16'), 'native defaults 8 and caps at 16');
check(rustDownload.includes('fn normalize_threads') && rustDownload.includes('clamp(1, MAX_THREADS)'), 'native clamps thread counts into 1..=16');
check(rustDownload.includes('"Range"') && rustDownload.includes('parse_content_range'), 'transport probes Range/Content-Range before splitting');
check(rustDownload.includes('format!("download.part.{index}")') && rustDownload.includes('merge_segments'), 'segments are written to temporary shards and merged in order');
check(rustDownload.includes('StatusCode::OK') && rustDownload.includes('StatusCode::PARTIAL_CONTENT'), 'both probe outcomes are handled explicitly');
check(rustDownload.includes('回落单流'), 'unsupported/failed range probing falls back to a single stream');
check(rustDownload.includes('SHA-256 校验不通过') && rustDownload.includes('std::fs::rename'), 'hash verification and atomic rename are preserved');
check(rustDownload.includes('CompletedDownloads') && rustDownload.includes('MAX_DOWNLOAD'), 'completed-download validation and the 1 GiB cap are preserved');
check(rustDownload.includes('"已取消下载"'), 'cancellation semantics are preserved');

const rustTests = readFileSync('apps/desktop/src-tauri/src/update_download_tests.rs', 'utf8');
for (const fixture of ['segmented_download_probes_ranges_merges_shards_and_verifies_hash', 'probe_falls_back_to_single_stream_when_server_ignores_range', 'partial_content_without_total_falls_back_to_single_stream', 'segmented_download_honours_cancel_and_cleans_staging']) {
  check(rustTests.includes(fixture), `mock Range fixture covers ${fixture}`);
}

console.log(`update multithread: ${checks} checks passed; no download or installer launched.`);
