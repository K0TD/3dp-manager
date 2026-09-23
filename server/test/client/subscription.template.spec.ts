import {
  generateErrorHtml,
  generateSubscriptionHtmlWithQr,
} from 'src/client/templates/subscription.template';

describe('subscription template', () => {
  const baseData = {
    currentUrl: 'https://example.com/bus/test',
    qrDataUrl: 'data:image/png;base64,qr',
    subscriptionName: 'Моя подписка',
    subscriptionLinks: ['vless://regular'],
    amneziaLinks: [] as string[],
    telegramProxyLinks: [] as string[],
  };

  it('показывает инструкции только для присутствующих специальных подключений', () => {
    const html = generateSubscriptionHtmlWithQr({
      ...baseData,
      amneziaLinks: ['vpn://config'],
    });

    expect(html).toContain('AmneziaWG');
    expect(html).toContain('Копировать ключ');
    expect(html).toContain('download="Моя подписка.conf"');
    expect(html).toContain('Импорт туннелей из файла');
    expect(html).toContain('data-copy="vpn://config"');
    expect(html).not.toContain('href="vpn://');
    expect(html).not.toContain('<h2>Telegram Proxy</h2>');
  });

  it('предлагает conf-файл для отдельного приложения AmneziaWG', () => {
    const config = '[Interface]\nPrivateKey = key\n\n[Peer]\nPublicKey = key';
    const html = generateSubscriptionHtmlWithQr({
      ...baseData,
      amneziaLinks: [
        `vpn://${Buffer.from(config, 'utf8').toString('base64url')}`,
      ],
    });

    expect(html).toContain('download="Моя подписка.conf"');
    expect(html).toContain('format=amneziawg&amp;index=0');
    expect(html).toContain('data-copy-message="Настройки скопированы"');
  });

  it('показывает отдельное действие для Telegram Proxy', () => {
    const html = generateSubscriptionHtmlWithQr({
      ...baseData,
      telegramProxyLinks: [
        'tg://proxy?server=example.com&port=443&secret=eeaa',
      ],
    });

    expect(html).toContain('Telegram Proxy');
    expect(html).toContain('Добавить в Telegram');
    expect(html).toContain(
      'https://t.me/proxy?server=example.com&amp;port=443&amp;secret=eeaa',
    );
    expect(html).not.toContain('href="tg://proxy');
  });

  it('не показывает QR и ссылку импорта в пустой подписке', () => {
    const html = generateSubscriptionHtmlWithQr({
      ...baseData,
      subscriptionLinks: [],
    });
    expect(html).not.toContain('<img ');
    expect(html).not.toContain('class="subscription-box"');
    expect(html).toContain('Активных подключений пока нет');
    expect(html).toContain('Ожидаем подключения');
    expect(html).not.toContain('Маршрут готов');
  });

  it('показывает общий QR для обычных подключений', () => {
    const html = generateSubscriptionHtmlWithQr(baseData);
    expect(html).toContain('<aside class="qr-panel">');
    expect(html).toContain('src="data:image/png;base64,qr"');
    expect(html).toContain('class="subscription-box"');
  });

  it('показывает QR и ключи Amnezia без QR пустой общей подписки', () => {
    const html = generateSubscriptionHtmlWithQr({
      ...baseData,
      subscriptionLinks: [],
      amneziaLinks: ['vpn://first', 'vpn://second'],
      amneziaQrDataUrls: [
        'data:image/png;base64,first',
        'data:image/png;base64,second',
      ],
    });
    expect(html).not.toContain('<aside class="qr-panel">');
    expect(html).not.toContain('src="data:image/png;base64,qr"');
    expect(html).toContain('src="data:image/png;base64,first"');
    expect(html).toContain('src="data:image/png;base64,second"');
    expect(html).toContain(
      'readonly spellcheck="false">vpn://first</textarea>',
    );
    expect(html).toContain(
      'readonly spellcheck="false">vpn://second</textarea>',
    );
    expect(html).toContain('format=amneziawg&amp;index=1');
  });

  it('оставляет ручной импорт доступным, если QR ключа недоступен', () => {
    const html = generateSubscriptionHtmlWithQr({
      ...baseData,
      subscriptionLinks: [],
      amneziaLinks: ['vpn://config'],
      amneziaQrDataUrls: [''],
    });
    expect(html).not.toContain('<img ');
    expect(html).toContain('QR-код недоступен');
    expect(html).toContain('data-copy="vpn://config"');
    expect(html).toContain(
      'readonly spellcheck="false">vpn://config</textarea>',
    );
  });

  it('не показывает общий QR для подписки только с Telegram', () => {
    const html = generateSubscriptionHtmlWithQr({
      ...baseData,
      subscriptionLinks: [],
      telegramProxyLinks: [
        'tg://proxy?server=example.com&port=443&secret=eeaa',
      ],
    });
    expect(html).not.toContain('<img ');
    expect(html).toContain('Добавить в Telegram');
  });

  it('экранирует ключ Amnezia при ручном импорте', () => {
    const html = generateSubscriptionHtmlWithQr({
      ...baseData,
      amneziaLinks: ['vpn://</textarea><script>alert(1)</script>'],
    });
    expect(html).not.toContain('</textarea><script>');
    expect(html).toContain(
      'vpn://&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('ограничивает QR шириной мобильного контейнера', () => {
    const html = generateSubscriptionHtmlWithQr(baseData);

    expect(html).toContain(
      '.qr-frame { width: min(230px,100%); max-width: 100%',
    );
    expect(html).toContain('.qr-panel > div { min-width: 0; width: 100%');
    expect(html).toContain('@media (max-width: 420px)');
  });

  it('экранирует данные подписки в HTML-контексте', () => {
    const html = generateSubscriptionHtmlWithQr({
      ...baseData,
      subscriptionName: '<img src=x onerror=alert(1)>',
      currentUrl: 'https://example.com/" onmouseover="alert(1)',
    });

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot; onmouseover=&quot;alert(1)');
  });

  it('экранирует текст страницы ошибки', () => {
    const html = generateErrorHtml('<script>alert(1)</script>', '<b>fail</b>');

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;fail&lt;/b&gt;');
  });
});
