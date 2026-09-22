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
    expect(html).toContain('Скачать профиль .conf');
    expect(html).toContain('Импорт туннелей из файла');
    expect(html).not.toContain('Открыть в AmneziaVPN');
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

    expect(html).toContain('download="amneziawg-1.conf"');
    expect(html).toContain('format=amneziawg&amp;index=0');
    expect(html).toContain('Копировать настройки');
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
