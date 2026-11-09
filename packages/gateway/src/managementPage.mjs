export const page = '<!doctype html>' + String.raw`
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OneTHU Gateway</title>
  <link rel="stylesheet" href="/style.css">
  <script src="/app.js" defer></script>
</head>
<body>
  <main>
    <header class="masthead">
      <span class="brand">OneTHU <span>Gateway</span></span>
      <span id="local" class="badge">本机控制台</span>
    </header>
    <section class="intro" aria-labelledby="title">
      <h1 id="title">站点路由</h1>
      <p id="description">选择哪些校园站点通过 OneTHU。关闭后，该站点按原有网络设置访问。</p>
    </section>
    <section class="card" aria-labelledby="sites-title">
      <div class="tools">
        <div><h2 id="sites-title">校园站点</h2><p id="count" aria-live="polite"></p></div>
        <div class="search-tools">
          <input id="search" type="search" aria-label="搜索站点" placeholder="搜索名称或域名" autocomplete="off">
          <button id="refresh" type="button">刷新</button>
        </div>
      </div>
      <ul id="sites"></ul>
      <p id="status" role="status">正在加载站点…</p>
    </section>
    <p id="hint" class="hint">关闭后使用原有网络和浏览器已有登录。退出账号请使用网站的退出登录。</p>
  </main>
</body>
</html>`;

export const style = String.raw`
:root {
  color-scheme: light dark;
  --canvas: #f6f6f4; --surface: #fff; --surface-soft: #f0f0ed;
  --ink: #212120; --secondary: #64645f; --line: #dededa;
  --accent: #212120; --thumb: #fff; --track: #74746e; --error: #b42332;
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --canvas: #1b1b1a; --surface: #252524; --surface-soft: #30302e;
    --ink: #f3f3f0; --secondary: #c2c2bc; --line: #41413f;
    --accent: #f3f3f0; --thumb: #212120; --track: #85857e; --error: #f49ca4;
  }
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--canvas); color: var(--ink); }
main { max-width: 820px; margin-inline: auto; padding: 0 clamp(16px, 4vw, 36px) 38px; }
.masthead { min-height: 65px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid var(--line); }
.brand { font-weight: 750; letter-spacing: -.025em; }
.brand span { font-weight: 500; color: var(--secondary); margin-inline-start: 6px; }
.badge { font-size: 12px; color: var(--secondary); background: var(--surface-soft); border: 1px solid var(--line); border-radius: 100px; padding: 3px 10px; }
.intro { padding: clamp(24px, 5vw, 42px) 0 22px; }
h1, h2, p { margin: 0; }
h1 { font-size: clamp(29px, 5vw, 40px); line-height: 1.2; letter-spacing: -.045em; }
.intro p { color: var(--secondary); margin-top: 10px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; }
.tools { display: flex; justify-content: space-between; gap: 14px; align-items: center; padding: 16px 20px; }
h2 { font-size: 16px; }
#count, .hint, #status { color: var(--secondary); font-size: 13px; }
#count { min-height: 1.55em; margin-top: 2px; }
input[type=search] { min-width: 0; width: 220px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-soft); color: var(--ink); font: inherit; }
input[type=search]::placeholder { color: var(--secondary); }
.search-tools { display: flex; align-items: center; gap: 8px; min-width: 0; }
#refresh { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); padding: 8px 12px; font: inherit; white-space: nowrap; cursor: pointer; }
#refresh:hover { background: var(--surface-soft); }
#refresh:disabled { opacity: .65; cursor: wait; }
ul { list-style: none; margin: 0; padding: 0; }
li { border-top: 1px solid var(--line); }
li label { min-height: 58px; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 9px 20px; cursor: pointer; }
li label:hover { background: var(--surface-soft); }
li:last-child label { border-radius: 0 0 19px 19px; }
.site { min-width: 0; display: grid; }
.site strong { font-weight: 630; overflow-wrap: anywhere; }
.host { color: var(--secondary); font: 12px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.control { display: flex; align-items: center; gap: 9px; flex-shrink: 0; color: var(--secondary); font-size: 12px; }
.switch { appearance: none; position: relative; margin: 0; width: 36px; height: 21px; border: 1px solid var(--line); border-radius: 100px; background: var(--track); cursor: pointer; transition: background .16s; }
.switch::after { content: ""; position: absolute; inset: 2px auto auto 2px; width: 15px; height: 15px; border-radius: 50%; background: #fff; transition: transform .16s; }
.switch:checked { background: var(--accent); }
.switch:checked::after { background: var(--thumb); transform: translateX(15px); }
.switch:disabled { opacity: .65; cursor: wait; }
input:focus-visible, button:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
#status:not(:empty) { border-top: 1px solid var(--line); padding: 14px 20px; }
#status[data-error=true] { color: var(--error); }
.hint { margin: 13px 4px 0; }
@media (max-width: 430px) {
  .tools { align-items: stretch; flex-direction: column; }
  input[type=search] { width: 100%; }
  li label { padding-inline: 13px; }
  .control { gap: 5px; }
}
@media (prefers-reduced-motion: reduce) { *, *::before { transition: none !important; } }
`;

/** Each attempt is bounded, including body reads. Setting a site is idempotent,
 * so a lost acknowledgement may be retried with exactly the same payload. */
export async function requestSites(init = {}, { fetchImpl = globalThis.fetch, timeoutMs = 8000,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let retry = true;
    try {
      const response = await fetchImpl('/api/sites', { ...init, cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        retry = response.status >= 500 || response.status === 408;
        await response.body?.cancel();
        throw new Error(String(response.status));
      }
      retry = false;
      const data = await response.json();
      if (!Array.isArray(data?.sites) || data.sites.some(site => typeof site.host !== 'string' || typeof site.enabled !== 'boolean')) {
        throw new Error('Invalid site response');
      }
      return data;
    } catch (error) {
      if (attempt || !retry && !controller.signal.aborted) throw error;
    } finally { clearTimeout(timer); }
    await wait(250);
  }
}

function mountManagementPage(load) {
  const zh = navigator.language.toLowerCase().startsWith('zh');
  const text = (cn, en) => zh ? cn : en;
  const byId = id => document.getElementById(id);
  const sites = byId('sites'), search = byId('search'), status = byId('status');
  const refreshButton = byId('refresh');
  const names = {
    'info.tsinghua.edu.cn': ['信息门户', 'Info Portal'],
    'learn.tsinghua.edu.cn': ['网络学堂', 'Learn'],
    'git.tsinghua.edu.cn': ['清华 GitLab', 'Tsinghua GitLab'],
    'stu.cs.tsinghua.edu.cn': ['计算机系学生平台', 'CS student platform'],
    'cloud.tsinghua.edu.cn': ['清华云盘', 'Tsinghua Cloud'],
    'card.tsinghua.edu.cn': ['校园卡', 'Campus Card'],
    'zhjw.cic.tsinghua.edu.cn': ['教务系统', 'Academic Affairs'],
    'zhjwxk.cic.tsinghua.edu.cn': ['选课系统', 'Course Selection'],
    'seat.lib.tsinghua.edu.cn': ['图书馆座位', 'Library Seats'],
    'cab.lib.tsinghua.edu.cn': ['图书馆研讨间', 'Library Rooms'],
    'newetds.lib.tsinghua.edu.cn': ['学位论文服务系统', 'Tsinghua Theses'],
    'usereg.tsinghua.edu.cn': ['校园网账户', 'Campus Network Account'],
    'madmodel.cs.tsinghua.edu.cn': ['MadModel', 'MadModel'],
  };
  const title = host => names[host] ? text(...names[host]) : host;
  document.documentElement.lang = text('zh-CN', 'en');
  byId('local').textContent = text('本机控制台', 'Local console');
  byId('title').textContent = text('站点路由', 'Site routing');
  byId('description').textContent = text('选择哪些校园站点通过 OneTHU。关闭后，该站点按原有网络设置访问。',
    'Choose which campus sites use OneTHU. A switched-off site uses your original network settings.');
  byId('sites-title').textContent = text('校园站点', 'Campus sites');
  search.placeholder = text('搜索名称或域名', 'Search name or domain');
  search.setAttribute('aria-label', search.placeholder);
  refreshButton.textContent = text('刷新', 'Refresh');
  byId('hint').textContent = text('关闭后使用原有网络和浏览器已有登录。退出账号请使用网站的退出登录。',
    'Switching off uses your original network and existing browser session. To sign out, use the website’s sign-out control.');
  function message(value, error = false) {
    status.textContent = value;
    status.dataset.error = String(error);
  }
  function filter() {
    const query = search.value.trim().toLowerCase();
    let found = false;
    for (const row of sites.children) {
      row.hidden = !row.dataset.search.includes(query);
      found ||= !row.hidden;
    }
    return found;
  }
  function labelRoute(route) {
    return route ? text('经 OneTHU', 'Via OneTHU') : text('原有网络', 'Original network');
  }
  let current = [], busy = false, refreshPromise = null, generation = 0;
  function render(data, focusHost) {
    current = data.sites;
    sites.replaceChildren();
    byId('count').textContent = text(current.filter(site => site.enabled).length + ' / ' + current.length + ' 经 OneTHU',
      current.filter(site => site.enabled).length + ' of ' + current.length + ' via OneTHU');
    for (const site of current) {
      const row = document.createElement('li'), label = document.createElement('label');
      const identity = document.createElement('span'), name = document.createElement('strong');
      identity.className = 'site';
      name.textContent = title(site.host);
      identity.append(name);
      if (name.textContent !== site.host) {
        const host = document.createElement('span');
        host.className = 'host'; host.textContent = site.host;
        identity.append(host);
      }
      row.dataset.search = (name.textContent + ' ' + site.host).toLowerCase();
      const control = document.createElement('span'), route = document.createElement('span');
      control.className = 'control';
      route.textContent = labelRoute(site.enabled);
      route.setAttribute('aria-hidden', 'true');
      const toggle = document.createElement('input');
      toggle.className = 'switch';
      toggle.dataset.host = site.host;
      toggle.type = 'checkbox';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', text('经 OneTHU 访问 ', 'Route via OneTHU: ') + name.textContent);
      toggle.checked = site.enabled;
      toggle.addEventListener('change', () => void change(site, toggle));
      control.append(route, toggle); label.append(identity, control); row.append(label); sites.append(row);
      if (site.host === focusHost) toggle.focus({ preventScroll: true });
    }
    showEmpty();
  }
  function showEmpty() {
    const found = filter();
    message(found ? '' : current.length ? text('没有匹配的站点。', 'No matching sites.') : text('暂无可管理站点。', 'No managed sites.'));
  }
  function refresh() {
    if (busy) return Promise.resolve();
    if (refreshPromise) return refreshPromise;
    const expected = generation;
    refreshButton.disabled = true;
    refreshPromise = load().then(data => {
      if (!busy && generation === expected) render(data, document.activeElement?.dataset.host);
    }).catch(() => {
      if (!busy && generation === expected) message(text('暂时无法连接网关，连接恢复后会自动更新。',
        'The gateway is temporarily unavailable. Settings will update when the connection returns.'), true);
    }).finally(() => {
      refreshPromise = null;
      refreshButton.disabled = busy;
    });
    return refreshPromise;
  }
  async function change(site, toggle) {
    if (busy) { toggle.checked = site.enabled; return; }
    busy = true;
    generation++;
    refreshButton.disabled = true;
    const enabled = toggle.checked;
    toggle.checked = site.enabled;
    for (const item of sites.querySelectorAll('input')) item.disabled = true;
    message(text('正在保存…', 'Saving…'));
    try {
      render(await load({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: site.host, enabled }) }), site.host);
    } catch {
      // The write may have completed even if the connection lost its reply.
      // Read back authority state before showing an old switch position.
      try {
        const data = await load();
        render(data, site.host);
        if (data.sites.find(item => item.host === site.host)?.enabled !== enabled) {
          message(text('这次设置未保存，请重试。', 'This change was not saved. Please try again.'), true);
        }
      } catch {
        message(text('暂时无法确认最新设置，连接恢复后会自动更新。',
          'The latest settings could not be confirmed. They will update when the connection returns.'), true);
      }
    } finally {
      busy = false;
      refreshButton.disabled = false;
      for (const item of sites.querySelectorAll('input')) item.disabled = false;
      if (document.activeElement === document.body) toggle.focus({ preventScroll: true });
    }
  }
  search.addEventListener('input', () => { if (!busy && current.length) showEmpty(); });
  refreshButton.addEventListener('click', () => void refresh());
  const refreshVisible = () => { if (!document.hidden) void refresh(); };
  window.addEventListener('focus', refreshVisible);
  window.addEventListener('pageshow', refreshVisible);
  window.addEventListener('online', refreshVisible);
  document.addEventListener('visibilitychange', refreshVisible);
  window.setInterval(refreshVisible, 15000);
  message(text('正在加载站点…', 'Loading sites…'));
  void refresh();
}

export const script = '(' + mountManagementPage.toString() + ')(' + requestSites.toString() + ');';
