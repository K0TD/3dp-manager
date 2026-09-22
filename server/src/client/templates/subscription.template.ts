export interface SubscriptionPreviewData {
  currentUrl: string;
  qrDataUrl: string;
  subscriptionName: string;
  subscriptionLinks: string[];
  amneziaLinks: string[];
  telegramProxyLinks: string[];
}

function escapeHtml(rawText: string): string {
  return rawText
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function connectionWord(count: number): string {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return 'подключений';
  if (lastDigit === 1) return 'подключение';
  if (lastDigit >= 2 && lastDigit <= 4) return 'подключения';
  return 'подключений';
}

function telegramWebLink(link: string): string {
  const telegramLink = new URL(link);
  const webLink = new URL('https://t.me/proxy');
  for (const parameter of ['server', 'port', 'secret']) {
    const parameterValue = telegramLink.searchParams.get(parameter);
    if (parameterValue) webLink.searchParams.set(parameter, parameterValue);
  }
  return webLink.toString();
}

function renderTelegramActions(links: string[]): string {
  return links
    .map((link, index) => {
      const safeLink = escapeHtml(telegramWebLink(link));
      const suffix = links.length > 1 ? ` ${index + 1}` : '';
      return `
        <div class="connection-action">
          <span class="connection-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
          <a class="button button--primary" href="${safeLink}" target="_blank" rel="noopener">Добавить в Telegram${suffix}</a>
          <button class="button button--ghost copy-special" type="button" data-copy="${safeLink}">Копировать ссылку</button>
        </div>`;
    })
    .join('');
}

function renderAmneziaActions(
  links: string[],
  subscriptionUrl: string,
): string {
  return links
    .map((link, index) => {
      const vpnConfig = Buffer.from(
        link.slice('vpn://'.length),
        'base64url',
      ).toString('utf8');
      const downloadUrl = new URL(subscriptionUrl);
      downloadUrl.searchParams.set('format', 'amneziawg');
      downloadUrl.searchParams.set('index', String(index));
      const safeDownloadUrl = escapeHtml(downloadUrl.toString());
      const safeConfig = escapeHtml(vpnConfig);
      const suffix = links.length > 1 ? ` ${index + 1}` : '';

      return `
        <div class="connection-action">
          <span class="connection-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
          <a class="button button--primary" href="${safeDownloadUrl}" download="amneziawg-${index + 1}.conf">Скачать профиль .conf${suffix}</a>
          <button class="button button--ghost copy-special" type="button" data-copy="${safeConfig}">Копировать настройки</button>
        </div>`;
    })
    .join('');
}

function renderAmneziaGuide(links: string[], subscriptionUrl: string): string {
  if (links.length === 0) return '';
  return `
    <article class="guide guide--amnezia">
      <header class="guide-header">
        <div><p class="eyebrow">Отдельный импорт</p><h2>AmneziaWG</h2></div>
        <span class="count-badge">${links.length} ${connectionWord(links.length)}</span>
      </header>
      <p class="guide-lead">Этот тип подключается через профиль <code>.conf</code>, а не через общую ссылку подписки.</p>
      <ol class="steps">
        <li><span>1</span><p>Скачайте профиль на устройство, где установлен <strong>AmneziaWG</strong>.</p></li>
        <li><span>2</span><p>На телефоне откройте скачанный файл через меню <strong>«Поделиться» → AmneziaWG</strong>.</p></li>
        <li><span>3</span><p>Либо в AmneziaWG выберите <strong>«Импорт туннелей из файла»</strong> и укажите профиль.</p></li>
      </ol>
      <div class="connection-list">${renderAmneziaActions(links, subscriptionUrl)}</div>
    </article>`;
}

function renderTelegramGuide(links: string[]): string {
  if (links.length === 0) return '';
  return `
    <article class="guide guide--telegram">
      <header class="guide-header">
        <div><p class="eyebrow">Отдельное подключение</p><h2>Telegram Proxy</h2></div>
        <span class="count-badge">${links.length} ${connectionWord(links.length)}</span>
      </header>
      <p class="guide-lead">TGProxy подключается внутри Telegram и не импортируется VPN-клиентами из общей подписки.</p>
      <ol class="steps">
        <li><span>1</span><p>Убедитесь, что Telegram установлен на этом устройстве.</p></li>
        <li><span>2</span><p>Нажмите <strong>«Добавить в Telegram»</strong> и подтвердите открытие приложения.</p></li>
        <li><span>3</span><p>В Telegram проверьте адрес и включите предложенный прокси.</p></li>
      </ol>
      <div class="connection-list">${renderTelegramActions(links)}</div>
    </article>`;
}

/** Генерирует публичное превью подписки и инструкции для специальных подключений. */
export function generateSubscriptionHtmlWithQr(
  preview: SubscriptionPreviewData,
): string {
  const safeName = escapeHtml(preview.subscriptionName || 'Ваша подписка');
  const safeUrl = escapeHtml(preview.currentUrl);
  const safeQrDataUrl = escapeHtml(preview.qrDataUrl);
  const regularCount = preview.subscriptionLinks.length;
  const specialCount =
    preview.amneziaLinks.length + preview.telegramProxyLinks.length;
  const hasRegularConnections = regularCount > 0;
  const heroMessage = hasRegularConnections
    ? specialCount > 0
      ? 'Добавьте основные подключения одной ссылкой. AmneziaWG и Telegram Proxy подключаются отдельно — инструкции уже ниже.'
      : 'Отсканируйте QR-код в VPN-клиенте или скопируйте обновляемую ссылку подписки.'
    : specialCount > 0
      ? 'В этой подписке есть специальные подключения. Откройте её на нужном устройстве и следуйте инструкциям ниже.'
      : 'Активных подключений пока нет. Вернитесь к этой странице после генерации подписки.';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark light">
  <title>${safeName} · 3DP Manager</title>
  <style>
    :root {
      --bg: #e9f0f2; --paper: #f8fbfc; --raised: #fff; --ink: #10252d; --muted: #58717a;
      --line: #c9d7db; --cyan: #006f91; --cyan-soft: #d7edf3; --green: #167b50;
      --amber: #9b5c00; --shadow: 0 24px 70px rgba(23,54,64,.12); --radius: 18px;
    }
    [data-theme="dark"] {
      --bg: #071014; --paper: #0d191e; --raised: #122229; --ink: #edf8fa; --muted: #9bb0b7;
      --line: #294049; --cyan: #53d8ff; --cyan-soft: #12333e; --green: #56d69a;
      --amber: #ffc45e; --shadow: 0 28px 80px rgba(0,0,0,.34);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0; min-width: 320px; min-height: 100vh; color: var(--ink);
      background: radial-gradient(circle at 88% 2%, color-mix(in srgb,var(--cyan) 13%,transparent), transparent 32rem),
        linear-gradient(120deg,transparent 0 49.8%,color-mix(in srgb,var(--line) 45%,transparent) 50%,transparent 50.2%), var(--bg);
      font-family: "IBM Plex Sans", "Aptos", sans-serif; transition: color .2s ease, background-color .2s ease;
    }
    button, a { font: inherit; }
    button:focus-visible, a:focus-visible { outline: 3px solid color-mix(in srgb,var(--cyan) 55%,transparent); outline-offset: 3px; }
    .shell { width: min(1120px,calc(100% - 32px)); margin: 0 auto; padding: 28px 0 72px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .brand-mark { width: 30px; height: 30px; display: grid; place-items: center; color: var(--cyan); border: 1px solid var(--cyan); border-radius: 8px 2px; }
    .theme-toggle { width: 42px; height: 42px; display: grid; place-items: center; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
    .theme-toggle:hover { border-color: var(--cyan); }
    .theme-toggle svg { width: 20px; height: 20px; }
    .hero { position: relative; display: grid; grid-template-columns: minmax(0,1.25fr) minmax(270px,.75fr); overflow: hidden; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
    .hero::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 5px; background: var(--cyan); }
    .hero-copy { min-width: 0; padding: clamp(28px,5vw,58px); align-self: center; }
    .eyebrow { margin: 0 0 10px; color: var(--cyan); font-size: .72rem; font-weight: 800; letter-spacing: .15em; text-transform: uppercase; }
    h1, h2 { font-family: "Unbounded", "IBM Plex Sans", sans-serif; }
    h1 { max-width: 720px; margin: 0; font-size: clamp(2rem,5vw,4.8rem); line-height: 1.02; letter-spacing: -.055em; overflow-wrap: anywhere; }
    h2 { margin: 0; font-size: clamp(1.25rem,2.6vw,2rem); letter-spacing: -.035em; }
    .hero-lead { max-width: 600px; margin: 22px 0 0; color: var(--muted); font-size: clamp(1rem,1.8vw,1.15rem); line-height: 1.65; }
    .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
    .stat { padding: 7px 11px; color: var(--muted); background: var(--raised); border: 1px solid var(--line); border-radius: 999px; font-size: .82rem; }
    .stat strong { color: var(--ink); }
    .qr-panel { position: relative; min-width: 0; display: grid; place-items: center; overflow: hidden; padding: 40px clamp(16px,4vw,32px); background: var(--cyan-soft); border-left: 1px solid var(--line); text-align: center; }
    .qr-panel > div { min-width: 0; width: 100%; display: grid; justify-items: center; }
    .qr-panel::after { content: "SCAN / OPEN"; position: absolute; right: -33px; top: 74px; color: var(--cyan); font-size: .64rem; font-weight: 800; letter-spacing: .2em; transform: rotate(90deg); }
    .qr-frame { width: min(230px,100%); max-width: 100%; aspect-ratio: 1; padding: 13px; background: #fff; border: 1px solid rgba(0,0,0,.12); border-radius: 13px; box-shadow: 0 14px 35px rgba(0,0,0,.12); }
    .qr-frame img { display: block; width: 100%; max-width: 100%; height: auto; aspect-ratio: 1; }
    .qr-title { margin: 20px 0 5px; font-weight: 800; }
    .qr-note { max-width: 250px; margin: 0; color: var(--muted); font-size: .86rem; line-height: 1.45; }
    .subscription-box { margin-top: 18px; padding: 16px; background: var(--raised); border: 1px solid var(--line); border-radius: 12px; }
    .url { overflow: hidden; margin: 0 0 12px; color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: .78rem; text-overflow: ellipsis; white-space: nowrap; }
    .button-row { display: flex; flex-wrap: wrap; gap: 10px; }
    .button { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 10px 15px; border: 1px solid transparent; border-radius: 8px; font-weight: 800; text-decoration: none; cursor: pointer; transition: transform .15s ease,border-color .15s ease; }
    .button:hover { transform: translateY(-1px); }
    .button--primary { color: #041216; background: var(--cyan); }
    [data-theme="light"] .button--primary { color: #fff; }
    .button--ghost { color: var(--ink); background: transparent; border-color: var(--line); }
    .button--ghost:hover { border-color: var(--cyan); }
    .guides { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 20px; margin-top: 20px; }
    .guide { --guide-accent: var(--cyan); position: relative; overflow: hidden; padding: clamp(24px,4vw,38px); background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 18px 48px rgba(23,54,64,.08); }
    .guide::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: var(--guide-accent); }
    .guide--amnezia { --guide-accent: var(--amber); }
    .guide-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
    .count-badge { flex: 0 0 auto; padding: 6px 9px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; font-size: .75rem; font-weight: 700; }
    .guide-lead { margin: 18px 0 26px; color: var(--muted); line-height: 1.6; }
    .steps { display: grid; gap: 16px; margin: 0; padding: 0; list-style: none; }
    .steps li { display: grid; grid-template-columns: 30px 1fr; gap: 12px; align-items: start; }
    .steps li > span { width: 30px; height: 30px; display: grid; place-items: center; color: var(--guide-accent); border: 1px solid var(--guide-accent); border-radius: 50%; font: 800 .74rem "IBM Plex Mono",monospace; }
    .steps p { margin: 3px 0 0; color: var(--muted); line-height: 1.5; }
    .steps strong { color: var(--ink); }
    .connection-list { display: grid; gap: 10px; margin-top: 26px; padding-top: 22px; border-top: 1px solid var(--line); }
    .connection-action { display: grid; grid-template-columns: 34px minmax(0,1fr); gap: 8px; }
    .connection-action .button--ghost { grid-column: 2; }
    .connection-action .button { min-width: 0; width: 100%; white-space: normal; overflow-wrap: anywhere; }
    .connection-index { grid-row: 1 / span 2; display: flex; align-items: center; justify-content: center; color: var(--muted); font: .7rem "IBM Plex Mono",monospace; border-right: 1px solid var(--line); }
    .empty-note { margin: 20px 0 0; padding: 14px 16px; color: var(--muted); background: var(--raised); border-left: 3px solid var(--amber); line-height: 1.5; }
    .footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 28px; color: var(--muted); font-size: .78rem; }
    .toast { position: fixed; left: 50%; bottom: 24px; z-index: 10; padding: 11px 16px; color: #041216; background: var(--green); border-radius: 8px; font-weight: 800; transform: translate(-50%,20px); opacity: 0; pointer-events: none; transition: .2s ease; }
    .toast.is-visible { transform: translate(-50%,0); opacity: 1; }
    @media (max-width: 780px) {
      .shell { width: min(100% - 16px,620px); padding-top: 12px; }
      .hero, .guides { grid-template-columns: 1fr; }
      .hero-copy { padding: 34px 25px 30px; }
      .qr-panel { width: 100%; padding: 30px 20px 34px; border-top: 1px solid var(--line); border-left: 0; }
      .qr-panel::after { display: none; }
      .guide { padding: 26px 22px; }
      .footer { flex-direction: column; }
    }
    @media (max-width: 420px) {
      .topbar { margin-bottom: 14px; }
      .hero-copy { padding: 28px 20px 24px; }
      .guide { padding: 24px 18px; }
      .guide-header { flex-direction: column; gap: 10px; }
      .connection-action { grid-template-columns: 26px minmax(0,1fr); }
      .button { padding-inline: 12px; }
    }
    @media (prefers-reduced-motion: reduce) { *,*::before,*::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
  </style>
</head>
<body>
  <main class="shell">
    <nav class="topbar" aria-label="Панель страницы">
      <div class="brand"><span class="brand-mark">3D</span><span>3DP Manager</span></div>
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Переключить тему">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 3v2m0 14v2M3 12h2m14 0h2m-3.34-6.66-1.42 1.42M7.76 16.24l-1.42 1.42m0-12.32 1.42 1.42m8.48 9.48 1.42 1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"/></svg>
      </button>
    </nav>
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Маршрут готов</p>
        <h1>${safeName}</h1>
        <p class="hero-lead">${heroMessage}</p>
        <div class="stats"><span class="stat"><strong>${regularCount}</strong> в общей подписке</span><span class="stat"><strong>${specialCount}</strong> отдельных</span></div>
        ${
          hasRegularConnections
            ? `<div class="subscription-box">
          <p class="url" title="${safeUrl}">${safeUrl}</p>
          <div class="button-row">
            <button class="button button--primary copy-special" type="button" data-copy="${safeUrl}">Копировать ссылку</button>
          </div>
        </div>`
            : '<p class="empty-note">Обычных VPN-конфигураций нет: общую ссылку импортировать в VPN-клиент не нужно.</p>'
        }
      </div>
      <aside class="qr-panel"><div>
        <div class="qr-frame"><img src="${safeQrDataUrl}" width="204" height="204" alt="QR-код страницы подписки"></div>
        <p class="qr-title">${hasRegularConnections ? 'Сканируйте в VPN-клиенте' : 'Откройте на телефоне'}</p>
        <p class="qr-note">${hasRegularConnections ? 'QR содержит обновляемую ссылку подписки.' : 'QR откроет эту страницу с кнопками подключения.'}</p>
      </div></aside>
    </section>
    <section class="guides" aria-label="Инструкции по специальным подключениям">
      ${renderAmneziaGuide(preview.amneziaLinks, preview.currentUrl)}
      ${renderTelegramGuide(preview.telegramProxyLinks)}
    </section>
    <footer class="footer"><span>Ссылки обновляются автоматически вместе с подпиской.</span><span>Не передавайте эту страницу посторонним.</span></footer>
  </main>
  <div class="toast" id="toast" role="status" aria-live="polite">Скопировано</div>
  <script>
    (function () {
      var root = document.documentElement;
      var toggle = document.getElementById('theme-toggle');
      var toast = document.getElementById('toast');
      var toastTimer;
      function preferredTheme() {
        var stored = localStorage.getItem('themeMode');
        if (stored === 'light' || stored === 'dark') return stored;
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
      function applyTheme(theme) { root.setAttribute('data-theme', theme); }
      function showToast(message) {
        toast.textContent = message; toast.classList.add('is-visible'); window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () { toast.classList.remove('is-visible'); }, 1800);
      }
      function fallbackCopy(textToCopy) {
        var textarea = document.createElement('textarea'); textarea.value = textToCopy; textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select();
        var copied = document.execCommand('copy'); textarea.remove(); return copied;
      }
      function copy(textToCopy, button) {
        var promise = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(textToCopy).then(function () { return true; }) : Promise.resolve(fallbackCopy(textToCopy));
        promise.then(function (copied) {
          if (!copied) throw new Error('copy failed');
          var original = button.textContent; button.textContent = 'Скопировано'; showToast('Ссылка скопирована');
          window.setTimeout(function () { button.textContent = original; }, 1600);
        }).catch(function () { showToast('Не удалось скопировать'); });
      }
      applyTheme(preferredTheme());
      toggle.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        localStorage.setItem('themeMode', next); applyTheme(next);
      });
      document.addEventListener('click', function (event) {
        var button = event.target.closest('.copy-special'); if (!button) return;
        copy(button.dataset.copy || '', button);
      });
    })();
  </script>
</body>
</html>`;
}

/** Генерирует HTML-страницу с безопасно экранированной ошибкой. */
export function generateErrorHtml(
  title = 'Ошибка',
  message = 'Произошла ошибка',
): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${safeTitle} · 3DP Manager</title><style>
  :root { color-scheme: dark; --bg:#071014; --paper:#0d191e; --ink:#edf8fa; --muted:#9bb0b7; --line:#294049; --red:#ff7b7b; }
  * { box-sizing:border-box; } body { min-height:100vh; display:grid; place-items:center; margin:0; padding:20px; color:var(--ink); background:radial-gradient(circle at 75% 5%,#26171a,transparent 36rem),var(--bg); font-family:"IBM Plex Sans","Aptos",sans-serif; }
  .card { width:min(480px,100%); padding:38px; background:var(--paper); border:1px solid var(--line); border-top:4px solid var(--red); border-radius:16px; box-shadow:0 25px 70px rgba(0,0,0,.35); }
  .code { color:var(--red); font:800 .74rem "IBM Plex Mono",monospace; letter-spacing:.14em; text-transform:uppercase; }
  h1 { margin:10px 0 14px; font:700 clamp(1.7rem,7vw,2.7rem)/1.08 "Unbounded",sans-serif; letter-spacing:-.04em; overflow-wrap:anywhere; }
  p { margin:0; color:var(--muted); line-height:1.6; } a { display:inline-flex; margin-top:26px; padding:11px 16px; color:#071014; background:var(--red); border-radius:8px; font-weight:800; text-decoration:none; }
  a:focus-visible { outline:3px solid rgba(255,123,123,.45); outline-offset:3px; }
</style></head><body><main class="card"><div class="code">Subscription unavailable</div><h1>${safeTitle}</h1><p>${safeMessage}</p><a href="/">Вернуться в панель</a></main></body></html>`;
}
