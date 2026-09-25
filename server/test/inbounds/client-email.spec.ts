import { formatClientEmail } from 'src/inbounds/client-email';

describe('formatClientEmail', () => {
  const uuid = '0939535c-1f2c-4ffb-93e6-cb86d20a37b3';

  it('формирует имя вида <SubName>-<shortHash> для простого латинского имени', () => {
    expect(formatClientEmail('Sai', uuid)).toBe('Sai-0939535c');
  });

  it('заменяет пробелы на дефисы', () => {
    expect(formatClientEmail('Sai Home', uuid)).toBe('Sai-Home-0939535c');
  });

  it('корректно обрабатывает кириллические имена', () => {
    expect(formatClientEmail('Моя Подписка', uuid)).toBe(
      'Моя-Подписка-0939535c',
    );
  });

  it('заменяет спецсимволы и склеивает повторяющиеся дефисы', () => {
    expect(formatClientEmail('Sai / VIP & Test @ 2026', uuid)).toBe(
      'Sai-VIP-Test-2026-0939535c',
    );
  });

  it('удаляет начальные и конечные дефисы в имени', () => {
    expect(formatClientEmail('---Sai---', uuid)).toBe('Sai-0939535c');
  });

  it('ограничивает длину префикса 32 символами', () => {
    const longName = 'VeryLongSubscriptionNameExceedingThirtyTwoChars';
    const result = formatClientEmail(longName, uuid);
    expect(result).toBe(`${longName.slice(0, 32)}-0939535c`);
  });

  it('возвращает только короткий хэш, если имя пустое, состоит из пробелов или null/undefined', () => {
    expect(formatClientEmail('', uuid)).toBe('0939535c');
    expect(formatClientEmail('   ', uuid)).toBe('0939535c');
    expect(formatClientEmail(null, uuid)).toBe('0939535c');
    expect(formatClientEmail(undefined, uuid)).toBe('0939535c');
  });

  it('возвращает только короткий хэш, если имя состоит только из недопустимых спецсимволов', () => {
    expect(formatClientEmail('///@@@***', uuid)).toBe('0939535c');
  });

  it('корректно извлекает первые 8 символов, если uuid не содержит дефисов', () => {
    const rawUuid = '0939535c1f2c4ffb93e6cb86d20a37b3';
    expect(formatClientEmail('Sai', rawUuid)).toBe('Sai-0939535c');
    expect(formatClientEmail('', rawUuid)).toBe('0939535c');
  });
});
