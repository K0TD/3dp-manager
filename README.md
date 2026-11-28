[English](/README_EN.md) | [中文](/README_CN.md) | [فارسی](/README_IR.md) | [Türkmençe](/README_TK.md)

![Version](https://img.shields.io/badge/version-2.2.0-blue.svg) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0)

# 3DP-MANAGER · K0TD fork

Веб-панель для автогенерации инбаундов в [3x-ui](https://github.com/MHSanaei/3x-ui) через её API. Собирает подключения с нескольких нод в одну подписку с постоянным URL и периодически ротирует их, чтобы трафик не выглядел однообразно.

Форк проекта [denpiligrim/3dp-manager](https://github.com/denpiligrim/3dp-manager), GPL-3.0.

## Возможности

- **Ноды** — несколько панелей 3x-ui (логин/пароль или токен, CSRF), автоопределение IP/страны, проверка версий 3x-ui и Xray.
- **Подписки** — постоянный URL `/bus/<UUID>`, выбор ноды, relay, порта, SNI, флага и порядка для каждого подключения.
- **Ротация** — независимая по нодам: сбой одной ноды не трогает остальные, рабочее поколение сохраняется до успешной замены, очистка старых — в фоне.
- **Протоколы** — VLESS (Reality / TLS / WS / XHTTP / gRPC / XHTTP GET), VMess, Trojan, Shadowsocks, Hysteria2, MTProto FakeTLS, WireGuard, AmneziaWG, HTTP/SOCKS/mixed, внешние ссылки.
- **Профили подключений** — Self-SNI, HTTPS Fallback (прямой TLS или Nginx/Caddy), SNI-профили с fingerprint, проверка через xray-core, canary-ротация с автооткатом.
- **Маршрутизация** — пресеты для нод (блок RU-доменов/IP, сервисов определения IP, Google через IPv4) и клиентские профили Happ / INCY.
- **Relay** — промежуточные серверы с установкой перенаправления по SSH из интерфейса.
- **Прочее** — метаданные подписки (примечание, поддержка, сайт), API-токены для автоматизации, перенос панели одним архивом, безопасное/отложенное/принудительное удаление нод.

## Требования

- Ubuntu 20.04+ или Debian 12+, root-доступ.
- 3x-ui v2.9.4+ на нодах (часть протоколов требует более новых версий 3x-ui/Xray).
- Docker и Docker Compose — установщик поставит их сам.
- Для HTTPS — домен и сертификат (опционально).

## Установка

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

Скрипт развернёт `postgres`, `backend`, `frontend` в `/opt/3dp-manager`, предложит режим Web UI (Let's Encrypt / свой сертификат / self-signed / HTTP), сгенерирует порт, логин и пароль. Смените пароль после первого входа.

Посмотреть доступы повторно:

```bash
grep -E "ADMIN_LOGIN|ADMIN_PASSWORD" /opt/3dp-manager/docker-compose.yml | sed 's/^[ \t]*//; s/^- //'
```

Если включён `ufw`, открываются порты `443`, `8443`, `10000-60000` (TCP/UDP).

## Обновление

Та же команда, что и для установки. Работает и поверх установки из репозитория `denpiligrim`: делает резервную копию БД в `/opt/3dp-manager/backups/`, переключает образы на K0TD и применяет миграции.

## Перенос на другой сервер

1. **Настройки → Перенос панели** — скачать `.3dp-backup` (можно с парольной фразой).
2. На новом сервере без установленного 3DP-MANAGER:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh) --restore /root/panel.3dp-backup
```

Сохраняются UUID подписок, настройки, ноды и relay.

## Удаление

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/delete.sh)
```

## Быстрый старт

1. **Ноды** — добавьте URL панели 3x-ui и авторизацию. Основная нода используется по умолчанию.
2. **Relay серверы** — при необходимости добавьте промежуточный сервер и установите перенаправление.
3. **Домены** — настройте список SNI для Reality.
4. **Подписки** — создайте подписку, выберите подключения, сохраните и скопируйте URL в клиент.

Рекомендации: подписка по HTTPS, интервал ротации ≥ 10 минут (оптимально — раз в сутки), автообновление в клиенте — чаще (например, раз в час).

## Перенаправление (relay) вручную

На промежуточном сервере (`IP_ADDRESS` — IP ноды):

```bash
sudo ORIGIN_IP="IP_ADDRESS" bash -c "$(curl -sSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_install.sh)"
```

Удаление (после — `ufw reload` и `reboot`):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_delete.sh)
```

## Сбор доменов для whitelist

Укажите ссылку на мульти-подписку в `get_domains.js` и запустите `node get_domains.js` (нужен Node.js). Общий список доменов работает не у всех провайдеров — лучше собрать свой.

## Документация

- [api.md](api.md) — REST API, типы подключений, профили маршрутизации, метаданные подписки.
- [CONTRIBUTING.md](CONTRIBUTING.md) — как предложить изменения.

## Обратная связь

[Issues](https://github.com/k0td/3dp-manager/issues)

## Лицензия и авторы

[GNU GPL v3](LICENSE). Исходный проект — [@DenPiligrim](https://github.com/denpiligrim), форк поддерживает [@K0TD](https://github.com/k0td).

Благодарности: [@zangetsuka](https://github.com/zangetsuka) (Happ routing), [@xFalconMH](https://github.com/xFalconMH) (порядок ротации), [@PavelArs](https://github.com/PavelArs) (`tgId`), [@n1xsi](https://github.com/n1xsi) (совместимость 3x-ui, CSRF, probe), [@iqubik](https://github.com/iqubik), [@lunal1ght](https://github.com/lunal1ght), [@keidos57](https://github.com/keidos57) и всем [участникам](https://github.com/k0td/3dp-manager/graphs/contributors).
