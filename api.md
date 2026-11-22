# API документация 3dp-manager

**Версия API:** v1  
**Базовый URL:** `http://<host>:3100/api`  
**Префикс:** Все endpoints начинаются с `/api`, кроме публичных подписок (`/bus/:uuid`)

---

## Содержание

1. [Аутентификация](#аутентификация)
2. [Подписки](#подписки)
3. [Домены](#домены)
4. [Туннели (перенаправление)](#туннели-перенаправление)
5. [Настройки](#настройки)
6. [Ротация](#ротация)
7. [Клиентские endpoints (публичные)](#клиентские-endpoints-публичные)

---

## Аутентификация

Все endpoints требуют JWT-аутентификации, кроме помеченных как **Public**.

### POST `/api/auth/login`

Получение JWT-токена.

**Body:**
```json
{
  "login": "admin",
  "password": "your_password"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### POST `/api/auth/change-password`

Смена пароля администратора.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "password": "newSecurePassword"
}
```

**Response:**
```json
{
  "success": true
}
```

---

### POST `/api/auth/update-profile`

Обновление профиля администратора (логин + опционально пароль).

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "login": "newAdmin",
  "password": "newPassword" 
}
```

**Response:**
```json
{
  "success": true
}
```

---

## Подписки

### GET `/api/subscriptions`

Получить все подписки.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
[
  {
    "id": "b93b98f6-7d55-4d32-b0dd-497680715a31",
    "uuid": "abc-123-def",
    "name": "My Subscription",
    "isEnabled": true,
    "isAutoRotationEnabled": true,
    "inbounds": [...],
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

---

### POST `/api/subscriptions`

Создать новую подписку.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "name": "My Subscription",
  "note": "Поддержка по ссылке",
  "supportUrl": "tg://resolve?domain=support",
  "websiteUrl": "https://example.com",
  "inboundsConfig": [
    {
      "configId": "8d1f6bf3-47f0-4f56-9ed4-8f9d89e10616",
      "type": "vless-tcp-tls",
      "port": 443,
      "certificateMode": "node",
      "tlsServerName": "node.example.com"
    },
    {
      "configId": "ee34c44c-6735-49ae-92ab-38843f5c9276",
      "type": "vless-ws-tls",
      "port": 8443,
      "certificateMode": "custom",
      "tlsServerName": "edge.example.com",
      "certificateFile": "/etc/letsencrypt/live/edge.example.com/fullchain.pem",
      "keyFile": "/etc/letsencrypt/live/edge.example.com/privkey.pem"
    }
  ],
  "isAutoRotationEnabled": true
}
```

В конфигурацию можно включить до 20 подключений; элементы `happ-routing` и `incy-routing` в этот лимит не входят. Для routing передайте `routingProfile`: JSON-объект в строке, base64 или ссылку Happ/INCY. INCY также принимает HTTP(S) URL профиля. Профили проверяются при создании и обновлении, не создают inbound в панели и выдаются первыми в `/bus`. `vless-xhttp-get` создаёт XHTTP `packet-up` с uplink GET, без TLS/SNI; дополнительные настройки XHTTP попадают в параметр ссылки `extra`.

`note` — не более 200 символов; `supportUrl` принимает HTTP, HTTPS или TG, `websiteUrl` — HTTP или HTTPS (до 2048 символов). Для очистки поля передайте пустую строку.

Пример конфигураций routing и XHTTP GET:

```json
{
  "name": "Routing example",
  "inboundsConfig": [
    { "type": "happ-routing", "routingProfile": "{\"Name\":\"My rules\"}" },
    { "type": "incy-routing", "routingProfile": "https://example.com/rules.json" },
    { "type": "vless-xhttp-get", "port": 8443, "nodeId": "c474f7d3-99c6-4c38-aa9b-144e180e4212" }
  ]
}
```

**Response:**
```json
{
  "id": "b93b98f6-7d55-4d32-b0dd-497680715a31",
  "uuid": "abc-123-def",
  "name": "My Subscription",
  ...
}
```

---

### PUT `/api/subscriptions/:id`

Обновить подписку.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "name": "Updated Name",
  "note": "",
  "isAutoRotationEnabled": true
}
```

**Response:**
```json
{
  "id": "b93b98f6-7d55-4d32-b0dd-497680715a31",
  "name": "Updated Name",
  ...
}
```

---

### PUT `/api/subscriptions/bulk-auto-rotation`

Массовое включение/отключение авто-ротации.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "subscriptionIds": ["1", "2", "3"],
  "enabled": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Обновлено 3 подписок",
  "updatedCount": 3,
  "notFound": []
}
```

---

### DELETE `/api/subscriptions/:id`

Обычное удаление сначала удаляет inbound подписки из 3x-ui. Если панель вернула отказ или возникла ошибка связи, операция прекращается с HTTP 400:

```json
{
  "statusCode": 400,
  "code": "INBOUND_DELETE_FAILED",
  "message": "Не удалось удалить инбаунд 101 (vless) на ноде «Node» из 3x-ui. Можно удалить подписку принудительно.",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "path": "/api/subscriptions/b93b98f6-7d55-4d32-b0dd-497680715a31"
}
```

`DELETE /api/subscriptions/:id?force=true` продолжает удаление подписки при ошибке панели. Часть inbound может остаться в 3x-ui; проверьте и удалите их вручную. Удаление выполняется последовательно: если ошибка произошла не на первом inbound, некоторые уже могли быть удалены. При успехе возвращается удалённая сущность подписки; если подписка не найдена, тело может отсутствовать.

**Headers:** `Authorization: Bearer <token>`

---

## Домены

### GET `/api/domains/all`

Получить все домены без пагинации.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
[
  { "id": 1, "name": "ya.ru" },
  { "id": 2, "name": "vk.com" }
]
```

---

### GET `/api/domains?page=1&limit=10`

Получить домены с пагинацией.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 10)

**Response:**
```json
{
  "data": [
    { "id": 1, "name": "ya.ru" }
  ],
  "total": 100
}
```

---

### GET `/api/domains/:id`

Получить домен по ID.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "id": 1,
  "name": "ya.ru"
}
```

---

### POST `/api/domains`

Создать один домен.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "name": "example.com"
}
```

**Response:**
```json
{
  "id": 1,
  "name": "example.com"
}
```

---

### POST `/api/domains/upload`

Загрузить несколько доменов сразу.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "domains": ["ya.ru", "vk.com", "example.com"]
}
```

**Response:**
```json
{
  "count": 3
}
```

---

### DELETE `/api/domains/:id`

Удалить домен по ID.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true
}
```

---

### DELETE `/api/domains/all`

Удалить все домены.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true
}
```

---

### GET `/api/domains/scan/capabilities`

Получить возможности сканера доменов (наличие бинарника, timeout).

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "scannerAvailable": true,
  "scannerPath": "/usr/bin/RealiTLScanner-linux-64",
  "timeoutAvailable": true,
  "timeoutPath": "/usr/bin/timeout"
}
```

---

### GET `/api/domains/scan/status`

Получить статус текущего сканирования.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "running": false,
  "runId": null,
  "lastRunId": "scan-123"
}
```

---

### GET `/api/domains/scan/last-result`

Получить результат последнего сканирования.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "runId": "scan-123",
  "foundCount": 10,
  "domains": ["ya.ru", "vk.com", ...]
}
```

---

### POST `/api/domains/scan/start`

Запустить сканирование IP на наличие SNI.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "addr": "192.168.1.1",
  "scanSeconds": 60,
  "thread": 100,
  "timeout": 30
}
```

**Response:**
```json
{
  "success": true,
  "runId": "scan-456"
}
```

---

## Туннели (перенаправление)

### GET `/api/tunnels`

Получить все туннели.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
[
  {
    "id": 1,
    "name": "Relay Server 1",
    "ip": "192.168.1.100",
    "sshPort": 22,
    "username": "root",
    "domain": "relay.example.com",
    "isInstalled": true
  }
]
```

---

### POST `/api/tunnels`

Создать новый туннель.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "name": "Relay Server 1",
  "ip": "192.168.1.100",
  "sshPort": 22,
  "username": "root",
  "password": "ssh_password",
  "domain": "relay.example.com"
}
```

**Response:**
```json
{
  "id": 1,
  "name": "Relay Server 1",
  ...
}
```

---

### POST `/api/tunnels/:id/install`

Установить скрипт перенаправления на удалённый сервер.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "script": "#!/bin/bash ...",
  "message": "Скрипт сгенерирован. Выполните его на целевом сервере."
}
```

---

### DELETE `/api/tunnels/:id`

Удалить туннель.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true
}
```

---

## Настройки

### GET `/api/settings`

Получить все настройки.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "xui_url": "http://192.168.1.1:54321",
  "xui_login": "admin",
  "rotationIntervalMinutes": "1440",
  "xui_geo_country": "Germany",
  "xui_geo_flag": "🇩🇪"
}
```

---

### POST `/api/settings`

Обновить настройки.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "xui_url": "http://192.168.1.1:54321",
  "xui_login": "admin",
  "xui_password": "password",
  "rotationIntervalMinutes": "1440"
}
```

**Response:**
```json
{
  "success": true
}
```

*Автоматически извлекает host, IP, определяет страну по GeoIP.*

---

### POST `/api/settings/check`

Проверить подключение к 3x-ui панели.

**Headers:** `Authorization: Bearer <token>`

**Body:**
```json
{
  "xui_url": "http://192.168.1.1:54321",
  "xui_login": "admin",
  "xui_password": "password"
}
```

**Response:**
```json
{
  "success": true
}
```

---

## Ротация

### POST `/api/rotation/rotate-all`

Поставить ротацию всех подписок в фоновую очередь. Возвращает HTTP `202`.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "id": "b93b98f6-7d55-4d32-b0dd-497680715a31",
  "status": "queued",
  "results": []
}
```

---

### POST `/api/rotation/rotate-one/:id`

Поставить ротацию одной подписки в фоновую очередь. Возвращает HTTP `202`.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "id": "b93b98f6-7d55-4d32-b0dd-497680715a31",
  "status": "queued",
  "subscriptionIds": ["subscription-uuid"]
}
```

---

### GET `/api/rotation/operations`

Последние фоновые операции и результат по каждой ноде.

В операции сохраняется прежнее поле `error`, в результатах нод — `results[].message`. Новые ошибки дополнительно содержат `errorDetails` на уровне операции и соответствующего результата:

```json
{
  "title": "Нода «Node» недоступна: соединение отклонено (ECONNREFUSED)",
  "hint": "Проверьте, запущена ли 3x-ui и верен ли порт панели.",
  "code": "ECONNREFUSED",
  "stage": "create",
  "node": "Node",
  "inboundType": "vless-xhttp-reality",
  "port": 443,
  "raw": "Node is unreachable (ECONNREFUSED)"
}
```

`title` и `hint` предназначены для пользователя, `code` — машинный код; возможные этапы: `login`, `create`, `delete`, `cleanup`, `preflight`, `verify`, `ssh`, `rotation`. `node`, `inboundType` и `port` присутствуют только при известном контексте. `raw` ограничен 2048 символами; секреты, ссылки и UUID клиентов редактируются. Старые записи могут не содержать `errorDetails`.

Поле `results[].details` отдельно содержит прежнюю диагностику: `phase`, `inbounds` и, если найден, `blockingInbound`. Ответ `/operations/:id` имеет ту же структуру.

### GET `/api/rotation/operations/:id`

Состояние отдельной операции: `queued`, `running`, `succeeded`, `partial` или `failed`.

### GET `/api/rotation/cleanup`

Inbounds старых поколений, ожидающие удаления с нод.

### POST `/api/rotation/cleanup/:id/retry`

Поставить задачу очистки на ближайшую попытку.

### DELETE `/api/nodes/:id?mode=safe|deferred|force`

`safe` используется по умолчанию: сначала удаляются inbound в панели, и при ошибке удаление ноды прерывается. `deferred` сразу скрывает ноду и помечает inbound для фоновой очистки. `force` удаляет ноду и её inbound из базы, не обращаясь к панели; оставшиеся в 3x-ui подключения нужно проверить вручную. Подписки сохраняются, ссылки на ноду и связанные relay очищаются. В `deferred`/`force` затронутые конфигурации отключаются и могут автоматически активироваться при следующей ротации, если нода доступна.

---

## Клиентские endpoints (публичные)

Эти endpoints **не требуют аутентификации**.

### GET `/bus/:uuid`

Получить подписку в формате Base64 или HTML-страницу с QR-кодом.

**Public** — без токена.

**URL:**
```
GET /bus/abc-123-def
```

**Headers:**
- `User-Agent: Mozilla/...` → возвращает HTML с QR
- `User-Agent: v2rayN/...` → возвращает plain text Base64

**Query Parameters:**
- `format` (опционально): `wireguard` | `amneziawg` для скачивания конфигурации; обычные Base64 или HTML выбираются по User-Agent.
- `index`: номер конфигурации выбранного формата с нуля (для `wireguard`/`amneziawg`).

Для обоих `/bus` эндпоинтов заголовок `profile-title` содержит `base64:` + имя в UTF-8/base64; при наличии `note` таким же образом отдаётся `announce`, а `supportUrl` и `websiteUrl` передаются в `support-url` и `profile-web-page-url`. В Base64-содержимом включённые Happ/INCY routing-линии предшествуют ссылкам подключений; при использовании relay эти линии не переписываются.

`format=wireguard&index=0` скачивает первый профиль WireGuard `.conf`. HTML показывает QR-коды и настройки HTTP/SOCKS/mixed. Эти подключения исключены из обычной Base64-выдачи. Ответы подписки используют `Cache-Control: no-store`.

**Response (декодированное Base64-содержимое):**
```
happ://routing/add/e30=
vless://abc123...
vmess://xyz789...
...
```

**Response (HTML):**
```html
<!DOCTYPE html>
<html>
  <body>
    <h1>Subscription: My Subscription</h1>
    <img src="data:image/png;base64,..." />
    <a href="/bus/abc-123-def">Скачать подписку</a>
  </body>
</html>
```

---

### GET `/bus/:uuid/:tunnelId`

Получить подписку с заменой хоста на релей-сервер.

**Public** — без токена.

**Query Parameters:**
- `format` (опционально): `wireguard` | `amneziawg` для скачивания конфигурации; обычные Base64 или HTML выбираются по User-Agent.
- `index` (опционально): номер конфигурации с нуля для `wireguard`/`amneziawg`

**URL:**
```
GET /bus/abc-123-def/1
```

**Response:**
- Автоматически заменяет IP/домен в ссылках на `tunnel.domain` или `tunnel.ip`
- Возвращает Base64 или HTML с QR

---

## Сущности

### Subscription
```typescript
{
  id: string;
  uuid: string;
  name: string;
  note?: string;
  supportUrl?: string;
  websiteUrl?: string;
  isEnabled: boolean;
  isAutoRotationEnabled: boolean;
  inboundsConfig: Array<{
    configId: string;
    type: 'vless-tcp-reality' | 'vless-xhttp-reality' | 'vless-xhttp-get' | 'vless-grpc-reality' |
      'vless-ws' | 'vless-tcp-tls' | 'vless-ws-tls' | 'vless-xhttp-tls' | 'hysteria2-udp' |
      'vmess-tcp' | 'shadowsocks-tcp' | 'trojan-tcp-reality' | 'mtproto-faketls' |
      'amneziawg' | 'wireguard' | 'mixed' | 'http' | 'socks' | 'custom' |
      'happ-routing' | 'incy-routing';
    port?: number | 'random';
    sni?: string;
    routingProfile?: string;
  }>;
  inbounds: Inbound[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Inbound
```typescript
{
  id: number;
  type: 'vless' | 'vmess' | 'shadowsocks' | 'hysteria2' | 'trojan' |
    'mtproto' | 'amneziawg' | 'wireguard' | 'mixed' | 'http' | 'socks' | 'custom';
  port: number | string;
  sni?: string;
  link: string;
  configId?: string;
  position: number;
  transport?: 'tcp' | 'websocket' | 'grpc' | 'xhttp';
  connection?: { type: 'mixed' | 'http' | 'socks'; host: string; port: number; username: string; password: string };
  wireguardConfig?: string;
}
```

### Domain
```typescript
{
  id: number;
  name: string;
}
```

### Tunnel
```typescript
{
  id: number;
  name: string;
  ip: string;
  sshPort: number;
  username: string;
  domain?: string;
  isInstalled: boolean;
}
```

### Setting
```typescript
{
  key: string;
  value: string;
}
```

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| 200 | Успех |
| 400 | Неверный запрос |
| 401 | Неавторизован (нет токена или неверный) |
| 403 | Доступ запрещён |
| 404 | Ресурс не найден |
| 500 | Внутренняя ошибка сервера |

---

## Примеры использования

### JavaScript (Fetch API)

```javascript
// Логин
const loginResponse = await fetch('http://localhost:3100/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: 'admin', password: 'admin' })
});
const { access_token } = await loginResponse.json();

// Получить все подписки
const subsResponse = await fetch('http://localhost:3100/api/subscriptions', {
  headers: { 'Authorization': `Bearer ${access_token}` }
});
const subscriptions = await subsResponse.json();

// Создать подписку
const createResponse = await fetch('http://localhost:3100/api/subscriptions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${access_token}`
  },
  body: JSON.stringify({
    name: 'My Subscription',
    inboundsConfig: [
      { type: 'vless', port: 443, sni: 'example.com' }
    ],
    isAutoRotationEnabled: true
  })
});
const subscription = await createResponse.json();
```

### Python (requests)

```python
import requests

# Логин
response = requests.post('http://localhost:3100/api/auth/login', json={
    'login': 'admin',
    'password': 'admin'
})
token = response.json()['access_token']

# Получить все домены
headers = {'Authorization': f'Bearer {token}'}
response = requests.get('http://localhost:3100/api/domains/all', headers=headers)
domains = response.json()

# Запустить сканирование
response = requests.post('http://localhost:3100/api/domains/scan/start', 
    headers=headers,
    json={
        'addr': '192.168.1.1',
        'scanSeconds': 60,
        'thread': 100,
        'timeout': 30
    }
)
```

### cURL

```bash
# Логин
curl -X POST http://localhost:3100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin"}'

# Получить подписку (Base64)
curl http://localhost:3100/bus/abc-123-def

# Получить подписку (HTML с QR)
curl -H "User-Agent: Mozilla/5.0" \
  http://localhost:3100/bus/abc-123-def
```

---

## Интеграция

### Ссылка на подписку в клиенте

Формат:
```
http://<host>:<port>/bus/<uuid>
```

Пример для v2rayN, Clash, Surge:
```
http://192.168.1.100:3100/bus/abc-123-def
```

### QR-код

Откройте в браузере:
```
http://<host>:<port>/bus/<uuid>
```

Сканируйте QR-код приложением.

---

## Примечания

- **JWT-токен** передаётся в заголовке `Authorization: Bearer <token>`
- **Публичные endpoints** (`/bus/*`) не требуют токена
- **Base64-кодировка** используется для подписок (стандарт v2ray)
- **Полный клиентский Xray JSON** доступен по `GET /bus/:uuid?format=xray-json` и `GET /bus/:uuid/:tunnelId?format=xray-json` (без приватных ключей сервера)
- **Авто-ротация** выполняется по интервалу из настроек (`rotationIntervalMinutes`)
- **Scanner** (RealiTLScanner) — Go-бинарник, встраивается в backend-контейнер

---

## Управляемые профили подключений (`ConnectionProfile`)

Единая модель профилей (`xhttp-stable`, `self-sni`, `https-fallback`) с разделением серверной конфигурации 3x-ui и клиентских параметров (VLESS URI + Xray JSON). Активны все три профиля: `xhttp-stable` (`VLESS + XHTTP + REALITY`), `self-sni` (`VLESS + RAW + REALITY + Vision`) и `https-fallback` (`VLESS + XHTTP + TLS`).

- `GET /api/profiles/catalog` — каталог профилей, минимальных версий Xray и значений по умолчанию
- `GET /api/profiles` / `GET /api/profiles/:id` — список и карточка профиля (без приватных ключей)
- `POST /api/profiles` / `PUT /api/profiles/:id` / `DELETE /api/profiles/:id` — CRUD профиля с инкрементом ревизии и сохранением снимка предыдущей конфигурации (`previousSnapshot`)
- `POST /api/profiles/preview` — предпросмотр серверного inbound (с скрытым `privateKey`), клиентской VLESS-ссылки, полного Xray JSON, отчёта совместимости и готового конфига веб-сервера (`webServerConfig` для Nginx/Caddy на `self-sni` с командами бэкапа, `nginx -t`/`caddy validate`, reload и rollback). При `"liveCheck": true` дополнительно выполняет проверку DNS, TLS 1.3, ALPN, сертификата, локального HTTPS-сайта и занятых портов 3x-ui (`tlsProbe`)
- `POST /api/profiles/:id/check` — live-проверка совместимости Xray/3x-ui, занятости порта на ноде, ресурсов ноды (CPU/RAM/Disk), DNS, TLS 1.3, сертификата и доступности локального HTTPS-сайта
- `POST /api/profiles/:id/probe` — проверка реального клиентского подключения (`ClientProbeService`: эфемерный `xray-core` SOCKS5 + HTTP-проба через клиентский JSON, с graceful TCP/TLS fallback)
- `POST /api/profiles/:id/rollback` — откат профиля к предыдущей сохранённой ревизии (`previousSnapshot`)
- `GET /api/profiles/:id/export` — экспорт клиентской VLESS-ссылки и полного Xray JSON для активного inbound или предпросмотра

В `inboundsConfig` подписки поддерживаются:
- `type: "xhttp-stable"` с `profileSettings` (`mode: "auto" | "stream-one" | "packet-up"`, `path`, `host`, `fingerprint`, `spiderX`, `rotationPolicy`, клиентский `xmux`).
- `type: "self-sni"` с `profileSettings` (`domain` — обязательный собственный домен, `webServer: "nginx" | "caddy" | "none"`, `localHttpsPort`, `destPort`, `xver: 0 | 1 | 2`, `fingerprint`, `spiderX`, `rotationPolicy`, опциональные пути `certificateFile`/`keyFile` для шаблона веб-сервера). Ротация никогда не подменяет собственный домен случайным.
- `type: "https-fallback"` с `profileSettings` (`domain` — обязательный домен TLS-сертификата, `path` — выделенный endpoint вроде `/api/v2/stream`, `mode`, `fingerprint`, `reverseProxy: "none" | "nginx" | "caddy"`, `publicPort`, `rotationPolicy`). При `reverseProxy: "none"` TLS терминируется в Xray; при `nginx`/`caddy` Xray слушает `127.0.0.1`, а клиент подключается по TLS на `domain:publicPort`. Независим от REALITY-профилей и сохраняет домен/сертификат при ротации.

При ротации управляемых профилей:
- Неизменившиеся постоянные профили (`preserve_all` или фиксированный порт при `fixed_domain`) сохраняются без пересоздания (`preserved` в результате операции), а их порты и локальные порты Nginx/Caddy (`localHttpsPort` / `publicPort`) резервируются от коллизий с соседними ротируемыми инбаундами.
- Для новых staged-инбаундов перед переключением поколения выполняется canary-проверка (`ClientProbeService`); при сбое staged-поколение автоматически откатывается (`status: "preserved"`, `rolledBack: true`, `canaryResults`), а рабочие инбаунды остаются нетронутыми. Отключить canary-пробу можно переменной `DISABLE_CANARY_PROBE=true`.

---

## Контакты

- Telegram: [@denpiligrim_web](https://t.me/denpiligrim_web)
- YouTube: [DenPiligrim](https://www.youtube.com/@denpiligrim)
- GitHub: [k0td/3dp-manager](https://github.com/k0td/3dp-manager)
- Исходный проект: [denpiligrim/3dp-manager](https://github.com/denpiligrim/3dp-manager)
