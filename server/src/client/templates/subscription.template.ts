import { amneziaConfigFileName } from '../subscription-name';
import { amneziaConfigFromLink } from '../../inbounds/amnezia-vpn-link';

export interface SubscriptionPreviewData {
  currentUrl: string;
  qrDataUrl: string;
  subscriptionName: string;
  subscriptionLinks: string[];
  amneziaLinks: string[];
  amneziaQrDataUrls?: string[];
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

function actionIcon(name: 'copy' | 'download' | 'arrow' | 'qr'): string {
  const paths = {
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    qr: '<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM21 12v3M12 12h3M12 18v3"/>',
  };
  return `<svg class="action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function renderTelegramActions(links: string[]): string {
  return links
    .map((link, index) => {
      const safeLink = escapeHtml(telegramWebLink(link));
      const safeServer = escapeHtml(
        new URL(link).searchParams.get('server') || 'Telegram Proxy',
      );
      return `
        <div class="connection-action">
          <div class="connection-heading"><span class="connection-index">${String(index + 1).padStart(2, '0')}</span><div><strong>Telegram Proxy</strong><span class="connection-caption">${safeServer}</span></div></div>
          <a class="button button--connect" href="${safeLink}" target="_blank" rel="noopener"><span>Добавить в Telegram</span>${actionIcon('arrow')}</a>
          <button class="button button--ghost copy-special" type="button" data-copy="${safeLink}">${actionIcon('copy')}<span data-copy-label>Копировать ссылку</span></button>
        </div>`;
    })
    .join('');
}

function renderAmneziaActions(
  links: string[],
  subscriptionUrl: string,
  subscriptionName: string,
  qrDataUrls: string[],
): string {
  return links
    .map((link, index) => {
      const vpnConfig = amneziaConfigFromLink(link) ?? '';
      const downloadUrl = new URL(subscriptionUrl);
      downloadUrl.searchParams.set('format', 'amneziawg');
      downloadUrl.searchParams.set('index', String(index));
      const safeDownloadUrl = escapeHtml(downloadUrl.toString());
      const safeVpnLink = escapeHtml(link);
      const safeConfig = escapeHtml(vpnConfig);
      const fileName = amneziaConfigFileName(
        subscriptionName,
        index,
        links.length,
      );
      const safeFileName = escapeHtml(fileName);
      const safeSubscriptionName = escapeHtml(subscriptionName);
      const qrDataUrl = qrDataUrls[index];

      return `
        <div class="connection-action">
          <div class="connection-heading"><span class="connection-index">${String(index + 1).padStart(2, '0')}</span><div><strong>${safeSubscriptionName}</strong><span class="connection-caption">Ключ для AmneziaVPN</span></div></div>
          <button class="button button--connect copy-special" type="button" data-copy="${safeVpnLink}" data-copy-message="Ключ скопирован — вставьте его в AmneziaVPN">${actionIcon('copy')}<span data-copy-label>Копировать ключ</span></button>
          <details class="import-details">
            <summary>${actionIcon('qr')}<span>QR-код и ключ подключения</span><span class="details-chevron" aria-hidden="true">⌄</span></summary>
            <div class="import-content">
              ${qrDataUrl ? `<div class="qr-frame"><img src="${escapeHtml(qrDataUrl)}" width="240" height="240" alt="QR-код подключения ${safeSubscriptionName} в AmneziaVPN" loading="lazy"></div><p class="import-note">В AmneziaVPN нажмите «+» → «QR-код» и отсканируйте код с другого устройства.</p>` : '<p class="import-note">QR-код недоступен. Скопируйте ключ ниже и вставьте его в AmneziaVPN.</p>'}
              <label class="key-label" for="amnezia-key-${index}">Ключ подключения · vpn://</label>
              <textarea class="connection-key" id="amnezia-key-${index}" rows="3" readonly spellcheck="false">${safeVpnLink}</textarea>
              <p class="import-note">На этом устройстве скопируйте ключ и добавьте его через «+» в AmneziaVPN.</p>
            </div>
          </details>
          <div class="config-download">
            <p class="connection-caption">Для отдельного приложения AmneziaWG</p>
            <div class="connection-secondary">
              <a class="button button--ghost" href="${safeDownloadUrl}" download="${safeFileName}">${actionIcon('download')}<span>Скачать .conf</span></a>
              ${vpnConfig ? `<button class="button button--ghost copy-special" type="button" data-copy="${safeConfig}" data-copy-message="Настройки скопированы">${actionIcon('copy')}<span data-copy-label>Настройки</span></button>` : ''}
            </div>
          </div>
        </div>`;
    })
    .join('');
}

function renderAmneziaGuide(
  links: string[],
  subscriptionUrl: string,
  subscriptionName: string,
  qrDataUrls: string[],
): string {
  if (links.length === 0) return '';
  return `
    <article class="guide guide--amnezia">
      <header class="guide-header">
        <div><p class="eyebrow">Отдельный импорт</p><h2>AmneziaWG</h2></div>
        <span class="count-badge">${links.length} ${connectionWord(links.length)}</span>
      </header>
      <p class="guide-lead">Добавьте ключ или отсканируйте QR-код в AmneziaVPN. Для отдельного приложения AmneziaWG скачайте профиль <code>.conf</code>.</p>
      <ol class="steps">
        <li><span>1</span><p>Нажмите <strong>«Копировать ключ»</strong> для нужного подключения.</p></li>
        <li><span>2</span><p>В <strong>AmneziaVPN</strong> нажмите «+», вставьте ключ и продолжите.</p></li>
        <li><span>3</span><p>Для <strong>AmneziaWG</strong> скачайте .conf и выберите <strong>«Импорт туннелей из файла»</strong>.</p></li>
      </ol>
      <div class="connection-list">${renderAmneziaActions(links, subscriptionUrl, subscriptionName, qrDataUrls)}</div>
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
      --amber: #9b5c00; --on-accent: #fff; --shadow: 0 24px 70px rgba(23,54,64,.12); --radius: 18px;
    }
    [data-theme="dark"] {
      --bg: #071014; --paper: #0d191e; --raised: #122229; --ink: #edf8fa; --muted: #9bb0b7;
      --line: #294049; --cyan: #53d8ff; --cyan-soft: #12333e; --green: #56d69a;
      --amber: #ffc45e; --on-accent: #041216; --shadow: 0 28px 80px rgba(0,0,0,.34);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0; min-width: 320px; min-height: 100vh; color: var(--ink);
      background: radial-gradient(circle at 88% 2%, color-mix(in srgb,var(--cyan) 13%,transparent), transparent 32rem),
        linear-gradient(120deg,transparent 0 49.8%,color-mix(in srgb,var(--line) 45%,transparent) 50%,transparent 50.2%), var(--bg);
      font-family: "IBM Plex Sans", "Aptos", sans-serif; transition: color .2s ease, background-color .2s ease;
    }
    button, a, textarea { font: inherit; }
    button:focus-visible, a:focus-visible, summary:focus-visible, textarea:focus-visible { outline: 3px solid color-mix(in srgb,var(--cyan) 55%,transparent); outline-offset: 3px; }
    .shell { width: min(1120px,calc(100% - 32px)); margin: 0 auto; padding: 28px 0 72px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .brand-mark { width: 30px; height: 30px; display: grid; place-items: center; color: var(--cyan); border: 1px solid var(--cyan); border-radius: 8px 2px; }
    .theme-toggle { width: 42px; height: 42px; display: grid; place-items: center; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
    .theme-toggle:hover { border-color: var(--cyan); }
    .theme-toggle svg { width: 20px; height: 20px; }
    .hero { position: relative; display: grid; grid-template-columns: minmax(0,1.25fr) minmax(270px,.75fr); overflow: hidden; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
    .hero--text { grid-template-columns: 1fr; }
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
    .button { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; gap: 9px; padding: 10px 15px; border: 1px solid transparent; border-radius: 8px; font-weight: 800; text-decoration: none; cursor: pointer; transition: transform .15s ease,border-color .15s ease; }
    .button:hover { transform: translateY(-1px); }
    .button--primary { color: var(--on-accent); background: var(--cyan); }
    .button--ghost { color: var(--ink); background: transparent; border-color: var(--line); }
    .button--ghost:hover { border-color: var(--cyan); }
    .guides { display: grid; align-items: start; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 20px; margin-top: 20px; }
    .guide:only-child { grid-column: 1 / -1; }
    .guide { min-width: 0; --guide-accent: var(--cyan); position: relative; overflow: hidden; padding: clamp(24px,4vw,38px); background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 18px 48px rgba(23,54,64,.08); }
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
    .connection-list { display: grid; gap: 16px; margin-top: 26px; }
    .connection-action { min-width: 0; display: grid; align-content: start; gap: 12px; padding: 18px; background: var(--raised); border: 1px solid var(--line); border-radius: 14px; }
    .connection-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
    .connection-heading > div { min-width: 0; }
    .connection-heading strong { display: block; font-size: .95rem; overflow-wrap: anywhere; }
    .connection-caption { display: block; margin: 4px 0 0; color: var(--muted); font-size: .78rem; line-height: 1.5; overflow-wrap: anywhere; }
    .connection-index { flex: 0 0 34px; height: 34px; display: grid; place-items: center; color: var(--guide-accent); background: color-mix(in srgb,var(--guide-accent) 10%,transparent); border: 1px solid color-mix(in srgb,var(--guide-accent) 25%,transparent); border-radius: 10px; font: 700 .75rem "IBM Plex Mono",monospace; }
    .connection-action .button { min-width: 0; width: 100%; border-radius: 10px; font-size: .85rem; line-height: 1.4; white-space: normal; overflow-wrap: anywhere; }
    .button--connect { color: var(--on-accent); background: var(--guide-accent); padding: 13px 16px; }
    .button--connect:hover { filter: brightness(1.08); }
    .connection-action .button--ghost:hover { border-color: var(--guide-accent); background: color-mix(in srgb,var(--guide-accent) 6%,transparent); }
    .action-icon { flex: 0 0 18px; width: 18px; height: 18px; }
    .config-download { padding-top: 14px; border-top: 1px solid var(--line); }
    .config-download > p { margin: 0 0 10px; }
    .connection-secondary { display: flex; flex-wrap: wrap; gap: 8px; }
    .connection-secondary .button { flex: 1 1 125px; }
    .import-details { min-width: 0; border: 1px solid var(--line); border-radius: 10px; }
    .import-details summary { min-height: 46px; display: flex; align-items: center; gap: 9px; padding: 11px 12px; border-radius: 10px; color: var(--ink); font-size: .83rem; font-weight: 700; cursor: pointer; list-style: none; }
    .import-details summary::-webkit-details-marker { display: none; }
    .import-details summary:hover { background: color-mix(in srgb,var(--guide-accent) 6%,transparent); }
    .details-chevron { margin-left: auto; color: var(--guide-accent); }
    .import-details[open] .details-chevron { transform: rotate(180deg); }
    .import-content { display: grid; gap: 12px; min-width: 0; padding: 16px; border-top: 1px solid var(--line); }
    .import-content .qr-frame { width: min(280px,100%); padding: 6px; justify-self: center; box-shadow: none; }
    .import-note { margin: 0; color: var(--muted); font-size: .8rem; line-height: 1.55; }
    .key-label { color: var(--ink); font-size: .78rem; font-weight: 700; }
    .connection-key { width: 100%; min-width: 0; padding: 10px; resize: vertical; color: var(--muted); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; font: .75rem/1.6 "IBM Plex Mono",monospace; overflow-wrap: anywhere; }
    .empty-note { margin: 20px 0 0; padding: 14px 16px; color: var(--muted); background: var(--raised); border-left: 3px solid var(--amber); line-height: 1.5; }
    .footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 28px; color: var(--muted); font-size: .78rem; }
    .toast { position: fixed; left: 50%; bottom: 24px; z-index: 10; width: max-content; max-width: calc(100% - 32px); padding: 11px 16px; color: var(--on-accent); background: var(--green); border-radius: 8px; font-weight: 800; transform: translate(-50%,20px); opacity: 0; pointer-events: none; transition: .2s ease; }
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
      .connection-action { padding: 14px; }
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
    <section class="hero${hasRegularConnections ? '' : ' hero--text'}">
      <div class="hero-copy">
        <p class="eyebrow">${regularCount + specialCount > 0 ? 'Маршрут готов' : 'Ожидаем подключения'}</p>
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
      ${
        hasRegularConnections && preview.qrDataUrl
          ? `<aside class="qr-panel"><div>
        <div class="qr-frame"><img src="${safeQrDataUrl}" width="204" height="204" alt="QR-код подписки для VPN-клиента"></div>
        <p class="qr-title">Сканируйте в VPN-клиенте</p>
        <p class="qr-note">QR содержит обновляемую ссылку подписки.</p>
      </div></aside>`
          : ''
      }
    </section>
    <section class="guides" aria-label="Инструкции по специальным подключениям">
      ${renderAmneziaGuide(preview.amneziaLinks, preview.currentUrl, preview.subscriptionName, preview.amneziaQrDataUrls ?? [])}
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
        var stored;
        try { stored = localStorage.getItem('themeMode'); } catch (error) {}
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
        if (button.dataset.copying) return;
        button.dataset.copying = 'true';
        Promise.resolve().then(function () {
          if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(textToCopy).then(function () { return true; }).catch(function () { return fallbackCopy(textToCopy); });
          }
          return fallbackCopy(textToCopy);
        }).then(function (copied) {
          if (!copied) throw new Error('copy failed');
          var label = button.querySelector('[data-copy-label]') || button;
          var original = label.textContent; label.textContent = 'Скопировано';
          showToast(button.dataset.copyMessage || 'Ссылка скопирована');
          window.setTimeout(function () { label.textContent = original; delete button.dataset.copying; }, 1600);
        }).catch(function () { delete button.dataset.copying; showToast('Не удалось скопировать. Попробуйте скопировать вручную.'); });
      }
      applyTheme(preferredTheme());
      toggle.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('themeMode', next); } catch (error) {}
        applyTheme(next);
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
