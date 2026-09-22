import {
  amneziaConfigFileName,
  attachmentDisposition,
} from 'src/client/subscription-name';

describe('subscription name for AmneziaWG', () => {
  it('использует безопасное имя подписки и расширение conf', () => {
    expect(amneziaConfigFileName('Моя / подписка', 0, 1)).toBe(
      'Моя - подписка.conf',
    );
    expect(amneziaConfigFileName('Работа', 1, 2)).toBe('Работа-2.conf');
    expect(amneziaConfigFileName('🔐'.repeat(100), 0, 1)).toBe(
      `${'🔐'.repeat(80)}.conf`,
    );
  });

  it('передаёт unicode-имя через Content-Disposition', () => {
    expect(attachmentDisposition('Моя подписка.conf')).toBe(
      'attachment; filename="amneziawg.conf"; filename*=UTF-8\'\'%D0%9C%D0%BE%D1%8F%20%D0%BF%D0%BE%D0%B4%D0%BF%D0%B8%D1%81%D0%BA%D0%B0.conf',
    );
  });
});
