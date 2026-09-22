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
    "id": 1,
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

**Response:**
```json
{
  "id": 1,
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
  "isEnabled": false,
  "isAutoRotationEnabled": true
}
```

**Response:**
```json
{
  "id": 1,
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

Удалить подписку.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true
}
```

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

### GET `/api/rotation/operations/:id`

Состояние отдельной операции: `queued`, `running`, `succeeded`, `partial` или `failed`.

### GET `/api/rotation/cleanup`

Inbounds старых поколений, ожидающие удаления с нод.

### POST `/api/rotation/cleanup/:id/retry`

Поставить задачу очистки на ближайшую попытку.

### DELETE `/api/nodes/:id?mode=deferred`

Принудительно скрыть недоступную ноду. Её реквизиты сохраняются до завершения фоновой очистки.

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

**Response (Base64):**
```
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
- `format` (опционально): `base64` | `html`

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
  id: number;
  uuid: string;
  name: string;
  isEnabled: boolean;
  isAutoRotationEnabled: boolean;
  inboundsConfig: Array<{
    configId: string;
    type: 'vless-tcp-reality' | 'vless-xhttp-reality' | 'vless-grpc-reality' |
      'vless-ws' | 'vless-tcp-tls' | 'vless-ws-tls' | 'hysteria2-udp' |
      'vmess-tcp' | 'shadowsocks-tcp' | 'trojan-tcp-reality' | 'amneziawg' | 'custom';
    port?: number | 'random';
    sni?: string;
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
  type: 'vless' | 'vmess' | 'shadowsocks' | 'hysteria2' | 'trojan' | 'custom';
  port: number | string;
  sni?: string;
  link: string;
  configId?: string;
  position: number;
  transport?: 'tcp' | 'websocket' | 'grpc' | 'xhttp';
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
- **Авто-ротация** выполняется по интервалу из настроек (`rotationIntervalMinutes`)
- **Scanner** (RealiTLScanner) — Go-бинарник, встраивается в backend-контейнер

---

## Контакты

- Telegram: [@denpiligrim_web](https://t.me/denpiligrim_web)
- YouTube: [DenPiligrim](https://www.youtube.com/@denpiligrim)
- GitHub: [k0td/3dp-manager](https://github.com/k0td/3dp-manager)
- Исходный проект: [denpiligrim/3dp-manager](https://github.com/denpiligrim/3dp-manager)
