[Русский](/README.md) | [English](/README_EN.md) | [中文](/README_CN.md) | [Türkmençe](/README_TK.md)

![Version](https://img.shields.io/badge/version-2.2.0-blue.svg) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0)

# 3DP-MANAGER · K0TD fork

یک پنل وب برای تولید خودکار inbound در [3x-ui](https://github.com/MHSanaei/3x-ui) از طریق API آن. این پنل اتصال‌های چندین نود را در یک اشتراک با URL ثابت جمع می‌کند و آن‌ها را به‌صورت دوره‌ای چرخش می‌دهد تا ترافیک یکنواخت به نظر نرسد.

فورکی از پروژه [denpiligrim/3dp-manager](https://github.com/denpiligrim/3dp-manager)، با مجوز GPL-3.0.

## قابلیت‌ها

- **نودها** (**Ноды**) — چندین پنل 3x-ui (نام کاربری/رمز عبور یا توکن، CSRF)، تشخیص خودکار IP/کشور، بررسی نسخه‌های 3x-ui و Xray، افزودن خودکار دامنه نود به فهرست SNI.
- **اشتراک‌ها** (**Подписки**) — URL ثابت `/bus/<UUID>`، انتخاب نود، relay، پورت، SNI، پرچم و ترتیب برای هر اتصال؛ اتصال اختیاری کلاینت 3x-ui 3.x با ارائه آمار ترافیک و انقضا (`subscription-userinfo`).
- **چرخش** — مستقل برای هر نود: خرابی یک نود روی بقیه اثری ندارد، نسل فعال تا جایگزینی موفق حفظ می‌شود و پاک‌سازی نسل‌های قدیمی در پس‌زمینه انجام می‌شود.
- **پروتکل‌ها** — VLESS (Reality / TLS / WS / XHTTP / gRPC / XHTTP GET)، VMess، Trojan، Shadowsocks، Hysteria2، MTProto FakeTLS، WireGuard، AmneziaWG، HTTP/SOCKS/mixed، لینک‌های خارجی.
- **پروفایل‌های اتصال** — Self-SNI، HTTPS Fallback (TLS مستقیم یا Nginx/Caddy)، پروفایل‌های SNI با fingerprint، بررسی از طریق xray-core، چرخش canary با بازگشت خودکار.
- **مسیریابی** — پیش‌تنظیم‌ها برای نودها (مسدودسازی دامنه‌ها/IPهای روسیه، سرویس‌های تشخیص IP، Google از طریق IPv4) و پروفایل‌های کلاینت Happ / INCY.
- **Relay** — سرورهای واسط با نصب فوروارد از طریق SSH مستقیماً از رابط کاربری، پورت‌های قابل تنظیم TCP/UDP و افزودن خودکار دامنه relay به فهرست SNI.
- **سایر موارد** — فراداده‌های اشتراک (یادداشت، پشتیبانی، وب‌سایت)، توکن‌های API برای خودکارسازی، انتقال پنل با یک آرشیو، حذف امن/معوق/اجباری نودها.

## پیش‌نیازها

- Ubuntu 20.04+ یا Debian 12+، دسترسی root.
- 3x-ui v2.9.4+ روی نودها (برخی پروتکل‌ها به نسخه‌های جدیدتر 3x-ui/Xray نیاز دارند).
- Docker و Docker Compose — اسکریپت نصب خودش آن‌ها را نصب می‌کند.
- برای HTTPS — دامنه و گواهی (اختیاری).

## نصب

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

اسکریپت سرویس‌های `postgres`، `backend` و `frontend` را در `/opt/3dp-manager` راه‌اندازی می‌کند، حالت Web UI را پیشنهاد می‌دهد (Let's Encrypt / گواهی شخصی / self-signed / HTTP) و پورت، نام کاربری و رمز عبور تولید می‌کند. پس از اولین ورود رمز عبور را تغییر دهید.

مشاهده دوباره اطلاعات ورود:

```bash
grep -E "ADMIN_LOGIN|ADMIN_PASSWORD" /opt/3dp-manager/docker-compose.yml | sed 's/^[ \t]*//; s/^- //'
```

اگر `ufw` فعال باشد، پورت‌های `443`، `8443` و `10000-60000` (TCP/UDP) باز می‌شوند.

## به‌روزرسانی

همان دستور نصب. روی نصب‌های انجام‌شده از مخزن `denpiligrim` نیز کار می‌کند: از پایگاه داده در `/opt/3dp-manager/backups/` نسخه پشتیبان می‌گیرد، ایمیج‌ها را به K0TD تغییر می‌دهد و مهاجرت‌ها را اعمال می‌کند.

## انتقال به سرور دیگر

1. **تنظیمات ← انتقال پنل** (**Настройки → Перенос панели**) — فایل `.3dp-backup` را دانلود کنید (امکان تعیین عبارت عبور وجود دارد).
2. روی سرور جدید که 3DP-MANAGER روی آن نصب نیست:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh) --restore /root/panel.3dp-backup
```

UUID اشتراک‌ها، تنظیمات، نودها و relayها حفظ می‌شوند.

## حذف

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/delete.sh)
```

## شروع سریع

1. **نودها** — URL پنل 3x-ui و اطلاعات احراز هویت را اضافه کنید. نود اصلی به‌طور پیش‌فرض استفاده می‌شود.
2. **سرورهای Relay** (**Relay серверы**) — در صورت نیاز سرور واسط اضافه کنید و فوروارد را نصب کنید.
3. **دامنه‌ها** (**Домены**) — فهرست SNI برای Reality را تنظیم کنید.
4. **اشتراک‌ها** — یک اشتراک بسازید، اتصال‌ها را انتخاب کنید، ذخیره کنید و URL را در کلاینت کپی کنید.

توصیه‌ها: اشتراک از طریق HTTPS، بازه چرخش ≥ ۱۰ دقیقه (بهینه — یک بار در روز)، به‌روزرسانی خودکار در کلاینت — با تناوب بیشتر (مثلاً هر یک ساعت).

## فوروارد (relay) به‌صورت دستی

روی سرور واسط (`IP_ADDRESS` — IP نود):

```bash
sudo ORIGIN_IP="IP_ADDRESS" bash -c "$(curl -sSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_install.sh)"
```

در صورت نیاز می‌توانید `FORWARDING_TCP_PORTS` و `FORWARDING_UDP_PORTS` را تنظیم کنید (مقدار پیش‌فرض `443,8443,10000:60000`؛ مقدار خالی پروتکل مربوطه را غیرفعال می‌کند).

حذف (پس از آن — `ufw reload` و `reboot`):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_delete.sh)
```

## جمع‌آوری دامنه‌ها برای whitelist

لینک مولتی‌اشتراک را در `get_domains.js` وارد کنید و `node get_domains.js` را اجرا کنید (Node.js لازم است). فهرست عمومی دامنه‌ها برای همه ارائه‌دهندگان کار نمی‌کند — بهتر است فهرست خودتان را جمع‌آوری کنید.

## مستندات

- [api.md](api.md) — REST API، انواع اتصال، پروفایل‌های مسیریابی، فراداده‌های اشتراک.
- [CONTRIBUTING.md](CONTRIBUTING.md) — نحوه پیشنهاد تغییرات.

## بازخورد

[Issues](https://github.com/k0td/3dp-manager/issues)

## مجوز و نویسندگان

[GNU GPL v3](LICENSE). پروژه اصلی — [@DenPiligrim](https://github.com/denpiligrim)، فورک توسط [@K0TD](https://github.com/k0td) نگهداری می‌شود.

سپاسگزاری: [@zangetsuka](https://github.com/zangetsuka) (مسیریابی Happ)، [@xFalconMH](https://github.com/xFalconMH) (ترتیب چرخش)، [@PavelArs](https://github.com/PavelArs) (`tgId`)، [@n1xsi](https://github.com/n1xsi) (سازگاری با 3x-ui، CSRF، probe)، [@iqubik](https://github.com/iqubik)، [@lunal1ght](https://github.com/lunal1ght)، [@keidos57](https://github.com/keidos57) و همه [مشارکت‌کنندگان](https://github.com/k0td/3dp-manager/graphs/contributors).
