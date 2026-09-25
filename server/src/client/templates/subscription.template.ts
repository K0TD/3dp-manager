import { subscriptionStyles } from './subscription.styles';
import { amneziaConfigFileName } from '../subscription-name';
import { amneziaConfigFromLink } from '../../inbounds/amnezia-vpn-link';
import { amneziaVpnIcon, amneziaWgIcon } from './amnezia-icons';

export interface SubscriptionPreviewData {
  currentUrl: string;
  qrDataUrl: string;
  subscriptionName: string;
  subscriptionLinks: string[];
  amneziaLinks: string[];
  amneziaQrDataUrls?: string[];
  amneziaWgQrDataUrls?: string[];
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

function actionIcon(
  name:
    | 'copy'
    | 'download'
    | 'arrow'
    | 'qr'
    | 'shield'
    | 'globe'
    | 'telegram'
    | 'sun'
    | 'lock'
    | 'help',
): string {
  const paths = {
    shield:
      '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
    telegram:
      '<path d="m21 3-4 18-6-6-4 3v-6L3 9l18-6ZM7 12 21 3M11 15l10-12"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2m0 3h.01"/>',
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

function renderAmneziaVpnActions(
  links: string[],
  subscriptionName: string,
  qrDataUrls: string[],
): string {
  return links
    .map((link, index) => {
      const safeVpnLink = escapeHtml(link);
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
        </div>`;
    })
    .join('');
}

function renderAmneziaWgActions(
  links: string[],
  subscriptionUrl: string,
  subscriptionName: string,
  wgQrDataUrls: string[],
): string {
  return links
    .map((link, index) => {
      const vpnConfig = amneziaConfigFromLink(link) ?? '';
      const downloadUrl = new URL(subscriptionUrl);
      downloadUrl.searchParams.set('format', 'amneziawg');
      downloadUrl.searchParams.set('index', String(index));
      const safeDownloadUrl = escapeHtml(downloadUrl.toString());
      const safeConfig = escapeHtml(vpnConfig);
      const fileName = amneziaConfigFileName(
        subscriptionName,
        index,
        links.length,
      );
      const safeFileName = escapeHtml(fileName);
      const safeSubscriptionName = escapeHtml(subscriptionName);
      const qrDataUrl = wgQrDataUrls[index];

      return `
        <div class="connection-action">
          <div class="connection-heading"><span class="connection-index">${String(index + 1).padStart(2, '0')}</span><div><strong>${safeSubscriptionName}</strong><span class="connection-caption">Файл и настройки для AmneziaWG</span></div></div>
          <div class="connection-secondary connection-secondary--top">
            <a class="button button--connect" href="${safeDownloadUrl}" download="${safeFileName}">${actionIcon('download')}<span>Скачать .conf</span></a>
            ${vpnConfig ? `<button class="button button--ghost copy-special" type="button" data-copy="${safeConfig}" data-copy-message="Настройки скопированы">${actionIcon('copy')}<span data-copy-label>Настройки</span></button>` : ''}
          </div>
          <details class="import-details">
            <summary>${actionIcon('qr')}<span>QR-код для AmneziaWG</span><span class="details-chevron" aria-hidden="true">⌄</span></summary>
            <div class="import-content">
              ${qrDataUrl ? `<div class="qr-frame"><img src="${escapeHtml(qrDataUrl)}" width="240" height="240" alt="QR-код AmneziaWG ${safeSubscriptionName}" loading="lazy"></div><p class="import-note">В приложении AmneziaWG нажмите «+» → «Сканировать QR-код».</p>` : '<p class="import-note">QR-код недоступен. Скачайте файл .conf или скопируйте настройки выше.</p>'}
            </div>
          </details>
        </div>`;
    })
    .join('');
}

function renderAmneziaGuide(
  links: string[],
  subscriptionUrl: string,
  subscriptionName: string,
  vpnQrDataUrls: string[],
  wgQrDataUrls: string[] = [],
): string {
  if (links.length === 0) return '';
  return `
    <article class="guide guide--amnezia" id="amnezia">
      <header class="guide-header">
        <span class="protocol-icon protocol-icon--amnezia-vpn"><img class="app-icon" src="${amneziaVpnIcon}" width="32" height="32" alt="AmneziaVPN"></span>
        <span class="count-badge">${links.length} ${connectionWord(links.length)}</span>
      </header>
      <p class="eyebrow">Подключение через Amnezia</p>
      <h3>AmneziaVPN и AmneziaWG</h3>

      <div class="amnezia-subblocks">
        <section class="amnezia-subblock amnezia-subblock--vpn">
          <div class="subblock-header">
            <span class="protocol-icon protocol-icon--amnezia-vpn"><img class="app-icon" src="${amneziaVpnIcon}" width="24" height="24" alt="AmneziaVPN"></span>
            <div>
              <h4>AmneziaVPN</h4>
              <p class="guide-lead">Официальное приложение AmneziaVPN. Для подключения используйте ключ или QR-код.</p>
            </div>
          </div>
          <div class="connection-list">${renderAmneziaVpnActions(links, subscriptionName, vpnQrDataUrls)}</div>
          <details class="guide-help">
            <summary>${actionIcon('help')}Как подключить AmneziaVPN<span class="details-chevron" aria-hidden="true">⌄</span></summary>
            <ol class="steps">
              <li><span>1</span><p>Нажмите <strong>«Копировать ключ»</strong> у нужного подключения.</p></li>
              <li><span>2</span><p>Откройте <strong>AmneziaVPN</strong>, нажмите «+» и вставьте ключ (или выберите «QR-код» и отсканируйте код с другого устройства).</p></li>
              <li><span>3</span><p>Подтвердите добавление и включите VPN в приложении.</p></li>
            </ol>
          </details>
        </section>

        <section class="amnezia-subblock amnezia-subblock--wg">
          <div class="protocol-callout">
            <span class="protocol-callout-icon"><img class="app-icon" src="${amneziaWgIcon}" width="32" height="32" alt="AmneziaWG"></span>
            <div>
              <strong>Хороший вариант, если AmneziaVPN недоступен</strong>
              <p>AmneziaWG — отдельное приложение. Подключение настраивается чуть иначе: скачайте файл <code>.conf</code> и импортируйте его в AmneziaWG.</p>
            </div>
          </div>
          <div class="connection-list">${renderAmneziaWgActions(links, subscriptionUrl, subscriptionName, wgQrDataUrls)}</div>
          <details class="guide-help">
            <summary>${actionIcon('help')}Как подключить AmneziaWG<span class="details-chevron" aria-hidden="true">⌄</span></summary>
            <ol class="steps">
              <li><span>1</span><p>Установите приложение <strong>AmneziaWG</strong>.</p></li>
              <li><span>2</span><p>Скачайте файл <strong>.conf</strong> (или в AmneziaWG нажмите «+» → «Сканировать QR-код»).</p></li>
              <li><span>3</span><p>Импортируйте туннель и включите подключение в приложении AmneziaWG.</p></li>
            </ol>
          </details>
        </section>
      </div>
    </article>`;
}

function renderTelegramGuide(links: string[]): string {
  if (links.length === 0) return '';
  return `
    <article class="guide guide--telegram" id="telegram">
      <header class="guide-header">
        <span class="protocol-icon">${actionIcon('telegram')}</span>
        <span class="count-badge">${links.length} ${connectionWord(links.length)}</span>
      </header>
      <p class="eyebrow">Для мессенджера</p>
      <h3>Telegram Proxy</h3>
      <p class="guide-lead">Откройте ссылку и включите прокси в Telegram. Подключение работает только внутри мессенджера.</p>
      <div class="connection-list">${renderTelegramActions(links)}</div>
      <details class="guide-help">
        <summary>${actionIcon('help')}Как подключить прокси<span class="details-chevron" aria-hidden="true">⌄</span></summary>
        <ol class="steps">
          <li><span>1</span><p>Установите <strong>Telegram</strong> на этом устройстве.</p></li>
          <li><span>2</span><p>Нажмите <strong>«Добавить в Telegram»</strong> и подтвердите открытие приложения.</p></li>
          <li><span>3</span><p>Проверьте адрес и включите предложенный прокси.</p></li>
        </ol>
      </details>
    </article>`;
}

function renderRegularConnections(preview: SubscriptionPreviewData): string {
  if (preview.subscriptionLinks.length === 0) return '';
  const safeUrl = escapeHtml(preview.currentUrl);
  return `
    <article class="subscription-card${preview.qrDataUrl ? '' : ' subscription-card--text'}" id="vpn">
      <div class="subscription-content">
        <div class="card-topline"><span class="protocol-icon">${actionIcon('globe')}</span><span class="count-badge">${preview.subscriptionLinks.length} ${connectionWord(preview.subscriptionLinks.length)}</span></div>
        <p class="eyebrow">Одна ссылка · все основные подключения</p>
        <h3>Добавьте подписку<br>в ваш VPN-клиент</h3>
        <p class="guide-lead">Скопируйте ссылку и выберите в приложении добавление подписки из буфера обмена.</p>
        <div class="subscription-box">
          <button class="button button--primary copy-special" type="button" data-copy="${safeUrl}">${actionIcon('copy')}<span data-copy-label>Копировать ссылку</span>${actionIcon('arrow')}</button>
          <label class="key-label" for="subscription-url">Ссылка для ручного импорта</label>
          <input class="subscription-url" id="subscription-url" type="text" value="${safeUrl}" readonly spellcheck="false">
        </div>
        <p class="card-note"><span class="status-dot" aria-hidden="true"></span>Список подключений обновляется по этой ссылке.</p>
      </div>
      ${
        preview.qrDataUrl
          ? `<aside class="qr-panel"><div>
        <span class="qr-kicker">На другом устройстве</span>
        <div class="qr-frame"><img src="${escapeHtml(preview.qrDataUrl)}" width="204" height="204" alt="QR-код подписки для VPN-клиента"></div>
        <p class="qr-title">Подключите через QR</p>
        <p class="qr-note">Откройте сканер в VPN-клиенте и наведите камеру на код.</p>
        <span class="qr-caption">${actionIcon('qr')}Сканируйте внутри приложения</span>
      </div></aside>`
          : ''
      }
    </article>`;
}

/** Генерирует публичное превью подписки и инструкции для специальных подключений. */
export function generateSubscriptionHtmlWithQr(
  preview: SubscriptionPreviewData,
): string {
  const safeName = escapeHtml(preview.subscriptionName || 'Ваша подписка');
  const regularCount = preview.subscriptionLinks.length;
  const amneziaCount = preview.amneziaLinks.length;
  const telegramCount = preview.telegramProxyLinks.length;
  const totalCount = regularCount + amneziaCount + telegramCount;
  const hasConnections = totalCount > 0;
  const heroMessage = hasConnections
    ? 'Ваши подключения собраны здесь. Выберите нужное приложение — мы подскажем, что делать дальше.'
    : 'Активных подключений пока нет. Они появятся здесь, когда подписка будет настроена.';
  const hasImportQr =
    (regularCount > 0 && Boolean(preview.qrDataUrl)) ||
    (amneziaCount > 0 &&
      ((preview.amneziaQrDataUrls?.some(Boolean) ?? false) ||
        (preview.amneziaWgQrDataUrls?.some(Boolean) ?? false)));
  const helpMessage =
    regularCount + amneziaCount > 0
      ? `На этом устройстве скопируйте ссылку или ключ и добавьте в нужное приложение.${hasImportQr ? ' На другом устройстве откройте сканер QR внутри приложения.' : ''}`
      : 'Нажмите «Добавить в Telegram» и подтвердите открытие приложения. Затем включите предложенный прокси в Telegram.';
  const connectionNavigation = [
    regularCount > 0
      ? `<a href="#vpn">${actionIcon('globe')}<span>VPN-подписка</span><strong>${regularCount}</strong>${actionIcon('arrow')}</a>`
      : '',
    amneziaCount > 0
      ? `<a href="#amnezia">${actionIcon('shield')}<span>Amnezia</span><strong>${amneziaCount}</strong>${actionIcon('arrow')}</a>`
      : '',
    telegramCount > 0
      ? `<a href="#telegram">${actionIcon('telegram')}<span>Telegram Proxy</span><strong>${telegramCount}</strong>${actionIcon('arrow')}</a>`
      : '',
  ].join('');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark light">
  <title>${safeName} · Подключение</title>
  <style>${subscriptionStyles}</style>
  <script>
    (function () {
      var theme;
      try { theme = localStorage.getItem('themeMode'); } catch (error) {}
      if (theme !== 'light' && theme !== 'dark') theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);
    })();
  </script>
</head>
<body>
  <a class="skip-link" href="#connections">К подключениям</a>
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">${actionIcon('shield')}</span><span>Ваш доступ<span class="brand-caption">ПОДКЛЮЧЕНИЯ</span></span></div>
      <div class="topbar-actions"><span class="private-label">${actionIcon('lock')}Личный доступ</span><button class="theme-toggle" id="theme-toggle" type="button" aria-label="Переключить тему">${actionIcon('sun')}</button></div>
    </header>
    <main>
      <section class="hero" aria-labelledby="subscription-name">
        <div class="hero-copy">
          <p class="eyebrow"><span class="eyebrow-line" aria-hidden="true"></span>Персональная подписка</p>
          <h1 id="subscription-name">${safeName}</h1>
          <p class="hero-lead">${heroMessage}</p>
          <span class="status-badge${hasConnections ? '' : ' status-badge--waiting'}"><span class="status-dot" aria-hidden="true"></span>${hasConnections ? 'Готово к подключению' : 'Ожидаем подключения'}</span>
        </div>
        <aside class="access-card" aria-label="Обзор подписки">
          <div class="access-topline"><span>ВАШ ДОСТУП</span>${actionIcon('shield')}</div>
          <div class="access-total"><strong>${String(totalCount).padStart(2, '0')}</strong><span>${connectionWord(totalCount)}<br>в подписке</span></div>
          ${hasConnections ? `<nav class="connection-nav" aria-label="Способы подключения">${connectionNavigation}</nav>` : '<p class="access-empty">Всё будет готово здесь.<br>Сохраните эту страницу.</p>'}
          <div class="access-bottom"><span class="access-line" aria-hidden="true"></span><span>ВАША ЛИЧНАЯ ПОДПИСКА</span></div>
        </aside>
      </section>
      <section class="connections" id="connections" aria-labelledby="connections-title">
        <header class="section-heading"><div><p class="eyebrow">${hasConnections ? 'Начните здесь' : 'Скоро здесь'}</p><h2 id="connections-title">${hasConnections ? 'Выберите подключение' : 'Подключения появятся здесь'}</h2></div>${hasConnections ? '<p>Каждая карточка — отдельный<br>способ оставаться на связи.</p>' : ''}</header>
        ${renderRegularConnections(preview)}
        ${amneziaCount + telegramCount > 0 ? `<div class="guides">${renderAmneziaGuide(preview.amneziaLinks, preview.currentUrl, preview.subscriptionName, preview.amneziaQrDataUrls ?? [], preview.amneziaWgQrDataUrls ?? [])}${renderTelegramGuide(preview.telegramProxyLinks)}</div>` : ''}
        ${hasConnections ? '' : `<div class="empty-state"><span class="empty-icon">${actionIcon('globe')}</span><h3>Немного терпения</h3><p>Когда появятся активные подключения, здесь будут ссылки и инструкции для настройки.</p><a class="button button--ghost" href="${escapeHtml(preview.currentUrl)}">Обновить страницу${actionIcon('arrow')}</a></div>`}
      </section>
      ${hasConnections ? `<aside class="help-strip"><span class="help-icon">${actionIcon('help')}</span><div><h2>Подключаетесь впервые?</h2><p>${helpMessage}</p></div></aside>` : ''}
    </main>
    <footer class="footer"><span>Подключения для ваших устройств</span><span>${actionIcon('lock')}Ваша личная ссылка. Не передавайте её посторонним.</span></footer>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite">Скопировано</div>
  <script>
    (function () {
      var root = document.documentElement;
      var toggle = document.getElementById('theme-toggle');
      var toast = document.getElementById('toast');
      var toastTimer;
      function applyTheme(theme) {
        root.setAttribute('data-theme', theme);
        toggle.setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
      }
      function showToast(message) {
        toast.textContent = message; toast.classList.add('is-visible'); window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () { toast.classList.remove('is-visible'); }, 3200);
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
      applyTheme(root.getAttribute('data-theme') || 'dark');
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
<title>${safeTitle} · Подключение</title><style>${subscriptionStyles}</style></head>
<body class="error-page"><main class="error-card"><span class="empty-icon">${actionIcon('lock')}</span><p class="eyebrow">Подписка недоступна</p><h1>${safeTitle}</h1><p>${safeMessage}</p></main></body></html>`;
}
