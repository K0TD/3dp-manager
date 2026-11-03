[Русский](/README.md) | [English](/README_EN.md) | [中文](/README_CN.md) | [Türkmençe](/README_TK.md)

<p><img src="https://denpiligrim.ru/storage/images/3dp-manager.png" alt="3dp-manager preview"></p>

![Version](https://img.shields.io/badge/version-2.2.0-blue.svg) ![Downloads](https://img.shields.io/badge/downloads-5.1k-blue) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0) [![Telegram](https://img.shields.io/badge/Telegram-26A5E4?style=flat&logo=telegram&logoColor=white)](https://t.me/denpiligrim_web) [![YouTube Channel Subscribers](https://img.shields.io/youtube/channel/subscribers/UCOv2tFFYDY4mXOM60PVz8zw)](https://www.youtube.com/@denpiligrim)

# 3DP-MANAGER · K0TD fork

ابزاری برای تولید خودکار inbound برای پنل [3x-ui](https://github.com/MHSanaei/3x-ui)، ساخت اشتراک‌های یکپارچه، مدیریت چندین نود 3x-ui و پیکربندی relay forwarding از سرورهای واسط به سرورهای اصلی. از نسخه 2.0.0 به بعد، پروژه دارای رابط گرافیکی و تنظیمات ساده کاربری است.

**حمایت از پروژه**

- انتقال بانکی:
  - :credit_card: کارت MIR: `2204320436318077`
  - :credit_card: کارت MasterCard: `5395452209474530`
- کیف پول الکترونیکی:
  - :moneybag: YooMoney: `4100116897060652`
  - :moneybag: PayPal: `vasiljevdenisx@gmail.com`
- رمزارز:
  - :coin: USDT | ETH (ERC20 | BEP20): `0x6fe140040f6Cdc1E1Ff2136cd1d60C0165809463`
  - :coin: USDT | TRX (TRC20): `TEWxXmJxvkAmhshp7E61XJGHB3VyM9hNAb`
  - :coin: Bitcoin: `bc1qctntwncsv2yn02x2vgnkrqm00c4h04c0afkgpl`
  - :coin: TON: `UQCZ3MiwyYHXftPItMMzJRYRiKHugr16jFMq2nfOQOOoemLy`
  - :coin: Bybit ID: `165292278`

## توضیحات

هدف اصلی ابزار این است که ترافیک شما یکسان به نظر نرسد. 3DP-MANAGER در بازه زمانی تعیین‌شده، مجموعه‌ای از اتصال‌ها با پارامترهای متفاوت تولید می‌کند:

- پروتکل‌ها: `vless`, `vmess`, `shadowsocks`, `hysteria2`, `trojan`;
- پورت‌ها: `443` و `8443` به‌صورت ثابت، و پورت‌های تصادفی از بازه `10000-60000`;
- transport: `tcp`, `websocket`, `grpc`, `xhttp`;
- SNI از whitelist دامنه‌ها انتخاب می‌شود یا به‌صورت دستی تنظیم می‌گردد؛
- نود، relay server، پورت و پرچم را می‌توان برای هر inbound جداگانه تنظیم کرد.

همه اتصال‌ها در یک اشتراک با URL ثابت ترکیب می‌شوند. 3DP-MANAGER با پنل `3x-ui` از طریق API عمومی آن کار می‌کند و مستقیماً در بخش داخلی پنل دخالت نمی‌کند.

هدف دوم پایداری اتصال است: کلاینت چند گزینه اتصال دریافت می‌کند و می‌تواند هرکدام را انتخاب کند. در یک اشتراک می‌توان inboundهای مربوط به نودهای مختلف، relay serverها و لینک‌های خارجی آماده را به‌عنوان اتصال custom قرار داد.

همچنین 3DP-MANAGER را می‌توان در سناریوی زنجیره‌ای استفاده کرد. سرویس forwarding، هدایت اشتراک و ترافیک را به نود انتخاب‌شده پیکربندی می‌کند.

توصیه‌ها:

- برای اشتراک از HTTPS استفاده کنید (دامنه + گواهی SSL).
- فاصله تولید را حداقل 10 دقیقه تنظیم کنید؛ برای پایداری، یک‌بار در روز (1440 دقیقه) توصیه می‌شود.
- در کلاینت، به‌روزرسانی خودکار را دفعات بیشتری تنظیم کنید، مثلاً هر ساعت، تا با سرور همگام بماند.

## قابلیت‌ها

- تولید اتصال‌های متنوع برای یک یا چند اشتراک
- ساخت اشتراک یکپارچه با URL ثابت
- مدیریت چندین نود `3x-ui`
- پشتیبانی از احراز هویت نود با login/password یا token
- تشخیص خودکار IP، کشور و پرچم نود از URL پنل
- انتخاب نود، relay server، پرچم، SNI و پورت برای هر inbound
- پشتیبانی از پورت ثابت یا مقدار `random`
- پشتیبانی از اتصال‌های custom: افزودن لینک خارجی آماده به اشتراک
- امکان تعیین مسیرهای جداگانه `fullchain.pem` و `privkey.pem` برای Hysteria2 UDP
- پشتیبانی از `whitelist` دامنه سفارشی
- تنظیم خودکار relay forwarding به‌صورت اختیاری
- نصب Web UI از طریق HTTP یا HTTPS: Let's Encrypt، self-signed یا گواهی‌های خودتان

## قابلیت‌ها و پیکربندی فورک

1. یک نود 3x-ui و اطلاعات احراز هویت آن را اضافه کنید؛ نود اصلی پیش‌فرض است. در صورت نیاز relay و forwarding را تنظیم کنید، فهرست دامنه‌های SNI را بسازید و اشتراک را ایجاد کنید. نشانی `/bus/<UUID>` در روتیشن ثابت می‌ماند.
2. اتصال‌های VLESS TCP/XHTTP/gRPC Reality، VLESS WS، VLESS TCP/WS/XHTTP TLS، VMess، Shadowsocks، Trojan Reality، Hysteria2، MTProto FakeTLS، AmneziaWG، WireGuard، HTTP/SOCKS/mixed و لینک سفارشی پشتیبانی می‌شوند. پشتیبانی به نسخه پنل و Xray بستگی دارد؛ AmneziaWG به 3x-ui نسخه 3.7 یا جدیدتر نیاز دارد و MTProto از پل داخلی پنل به Xray استفاده می‌کند.
3. پروفایل‌های SNI برای Reality بر اساس دامنه fingerprint، `spiderX`، مسیر و padding مربوط به XHTTP را انتخاب می‌کنند؛ مقدار پیش‌فرض `chrome` است. اتصال TLS از مسیر گواهی نود یا مسیر و نام TLS مشخص‌شده استفاده می‌کند.
4. روتیشن نودها مستقل است؛ در خطا آخرین نسل سالم حفظ می‌شود و inboundهای قدیمی برای پاک‌سازی قرار می‌گیرند. AmneziaWG، WireGuard و HTTP/SOCKS/mixed هنگام ذخیره ساخته می‌شوند و در روتیشن کلید و پورت ثابت دارند؛ برای تغییر نوع، نود، relay یا پورت، ابتدا حذف و ذخیره کنید و سپس اتصال جدید را اضافه کنید.
5. حذف نود: `safe` ابتدا inboundهای پنل را پاک می‌کند و در خطا متوقف می‌شود، اما مواردی که قبلاً حذف شده‌اند بازگردانده نمی‌شوند؛ `deferred` نود را پنهان و پاک‌سازی را به تعویق می‌اندازد؛ `force` بدون تماس با پنل رکوردهای محلی را حذف می‌کند و ممکن است پاک‌سازی دستی پنل لازم باشد. اشتراک‌ها می‌مانند؛ در دو حالت آخر تنظیمات مرتبط غیرفعال می‌شوند و با نود در دسترس ممکن است در روتیشن بعدی خودکار فعال شوند.
6. presetهای نود می‌توانند دامنه/IPهای روسیه یا سرویس‌های تشخیص IP را مسدود کنند و ترافیک Google را از IPv4 بفرستند. این تنظیمات برای Xray سمت سرور و وابسته به geodata هستند و با پروفایل مسیریابی کلاینت تفاوت دارند.
7. API سرور از `happ-routing` و `incy-routing`، فیلدهای `note`، `supportUrl` و `websiteUrl` و نوع `vless-xhttp-get` (حالت XHTTP packet-up، روش GET، بدون TLS/SNI) پشتیبانی می‌کند. خطوط مسیریابی پیش از لینک‌ها قرار دارند و جزو سقف ۲۰ اتصال نیستند. در فرم اشتراک نوع **Happ routing** یا **INCY routing** را انتخاب و پروفایل را در فیلد چندخطی وارد کنید؛ فیلدهای **یادداشت**، **لینک پشتیبانی**، **وب‌سایت** و نوع اتصال **VLESS XHTTP GET** نیز در فرم هستند. صفحه اصلی خطاهای عملیات را با متن روشن و راهنما نشان می‌دهد و جزئیات فنی به‌صورت بسته نمایش داده می‌شوند. [api.md](api.md) را ببینید.
8. حذف عادی اشتراک در صورت خطای پاک‌سازی 3x-ui متوقف می‌شود. `force=true` حذف را ادامه می‌دهد؛ inboundهای باقی‌مانده را در پنل بررسی و دستی حذف کنید.

از تنظیمات بخش انتقال پنل می‌توان نسخه پشتیبان گرفت و در سرور جدید نصب‌کننده فورک را با `--restore /root/panel.3dp-backup` اجرا کرد. فایل می‌تواند گذرواژه مستقل داشته باشد و UUID اشتراک‌ها، نودها، تنظیمات و اطلاعات relay را نگه می‌دارد. بازیابی فقط روی سروری بدون 3DP-MANAGER انجام می‌شود: اگر `/opt/3dp-manager/docker-compose.yml` وجود داشته باشد، نصب‌کننده به‌روزرسانی عادی انجام داده و فایل پشتیبان را نادیده می‌گیرد؛ ابتدا نصب قبلی را حذف کنید.

## نیازمندی‌ها

- Ubuntu 20.04 یا جدیدتر، Debian 12.11 یا جدیدتر
- پنل `3x-ui` نسخه v2.9.4 یا جدیدتر
- دسترسی root روی سرور
- Docker و Docker Compose؛ اگر نصب نباشند، اسکریپت نصب تلاش می‌کند آن‌ها را خودکار نصب کند
- دامنه + گواهی SSL (اختیاری)

---

## نصب

پنل مدیریتی `3x-ui` باید از قبل نصب شده باشد. می‌توانید آن را با این دستور نصب کنید: `bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)`

پروژه را روی سرور نصب کنید:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

در زمان نصب، اسکریپت:

- سیستم‌عامل، دسترسی root، Docker و Docker Compose را بررسی می‌کند؛
- اگر RAM کم باشد و swap وجود نداشته باشد، یک فایل swap با حجم 2 GB می‌سازد؛
- حالت دسترسی Web UI را می‌پرسد:
  - HTTPS با Let's Encrypt؛
  - HTTPS با گواهی self-signed؛
  - HTTPS با گواهی‌های خودتان؛
  - HTTP بدون رمزنگاری؛
- یک پورت تصادفی برای Web UI ایجاد می‌کند؛
- login و password مدیر را ایجاد می‌کند؛
- کانتینرهای `postgres`, `backend` و `frontend` را اجرا می‌کند.

پس از پایان نصب، URL، login و password در ترمینال نمایش داده می‌شود. بلافاصله password را در تنظیمات 3DP-MANAGER تغییر دهید.

<sup>توضیح کوتاه: اسکریپت نصب تعاملی را اجرا می‌کند، محیط را آماده می‌سازد و کانتینرهای پروژه را راه‌اندازی می‌کند.</sup>

## به‌روزرسانی

به‌روزرسانی به آخرین نسخه:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

همین دستور نصب موجود (از جمله نصب از مخزن `denpiligrim`) را تشخیص می‌دهد، از PostgreSQL در `/opt/3dp-manager/backups/` نسخه پشتیبان می‌گیرد، ایمیج‌ها را به K0TD تغییر می‌دهد و مهاجرت‌ها را بدون حذف Docker volume اجرا می‌کند. اگر پس از به‌روزرسانی تعداد نودها کم شود، به‌روزرسانی متوقف شده و مسیر نسخه پشتیبان نمایش داده می‌شود.

<sup>توضیح کوتاه: آخرین تغییرات را دریافت می‌کند، اصلاحات سازگار پیکربندی را اعمال می‌کند، کانتینرها را به‌روزرسانی کرده و سرویس را راه‌اندازی مجدد می‌کند.</sup>

## حذف

حذف کامل سرویس:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/delete.sh)
```

<sup>توضیح کوتاه: کانتینرها و فایل‌های پیکربندی را حذف می‌کند و سیستم را به وضعیت پیش از نصب بازمی‌گرداند.</sup>

---

## اولین ورود

login و password مدیر در پایان نصب نمایش داده می‌شود. برای مشاهده دوباره:

```bash
grep -E "ADMIN_LOGIN|ADMIN_PASSWORD" /opt/3dp-manager/docker-compose.yml | sed 's/^[ \t]*//; s/^- //'
```

Web UI در آدرسی که نصب‌کننده نمایش داده قابل دسترسی است، برای مثال:

- `https://example.com:PORT` برای HTTPS؛
- `http://SERVER_IP:PORT` برای HTTP.

اگر `ufw` فعال باشد، نصب‌کننده بازه‌های پورت کاری inbound را برای TCP/UDP باز می‌کند: `443`, `8443` و `10000-60000`.

---

## نودها

بخش **نودها** امکان اتصال یک یا چند پنل `3x-ui` را فراهم می‌کند.

برای هر نود مشخص می‌شود:

- نام؛
- URL پنل `3x-ui`؛
- IP نود؛
- پرچم/کشور؛
- نوع احراز هویت: `password` یا `token`؛
- اینکه نود اصلی است یا خیر.

پس از وارد کردن URL، برنامه تلاش می‌کند IP و کشور نود را خودکار تشخیص دهد. پرچم در نام اتصال‌ها داخل اشتراک استفاده می‌شود تا تشخیص سرورها در کلاینت ساده‌تر باشد.

> [!NOTE]
> نود اصلی به‌عنوان مقدار پیش‌فرض برای اشتراک‌ها، inboundها و relay serverها استفاده می‌شود.

---

## اشتراک‌ها

بخش **اشتراک‌ها** URLهای ثابت اشتراک و ترکیب inboundها را مدیریت می‌کند.

برای هر inbound می‌توانید تنظیم کنید:

- نوع اتصال؛
- نود؛
- relay server؛
- پرچم؛
- پورت: عدد مشخص از `1-65535` یا `random`؛
- SNI: دامنه مشخص یا `random`؛
- لینک خارجی آماده برای نوع `custom`.

برای `hysteria2-udp` می‌توانید مسیرهای جداگانه گواهی و کلید را مشخص کنید:

- حالت `node` مسیرهای گواهی پنل را از `getWebCertFiles` در 3x-ui دریافت می‌کند؛
- حالت `custom` به TLS server name و مسیر صریح گواهی/کلید روی نود نیاز دارد.

اگر پورت یا SNI برابر `random` باشد، مقدار هنگام روتیشن از بازه موجود یا whitelist دامنه‌ها انتخاب می‌شود.

---

## نصب سرویس forwarding

> [!WARNING]
> سرویس forwarding روی سرور واسط اجرا می‌شود

سرویس forwarding پورت‌های ورودی سرور واسط را به نود انتخاب‌شده proxy می‌کند. در Web UI این سرورها در بخش **Relay serverها** تنظیم می‌شوند و می‌توانند به یک نود مشخص متصل شوند.

Relay server را می‌توان با IP یا دامنه اضافه کرد. اگر دامنه وارد شود، backend تلاش می‌کند IP آن را خودکار resolve کند.

برای نصب دستی forwarding روی سرور واسط، `IP_ADDRESS` را با IP نود اصلی جایگزین کنید:

```bash
sudo ORIGIN_IP="IP_ADDRESS" bash -c "$(curl -sSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_install.sh)"
```

<sup>توضیح کوتاه: قوانین forwarding را اضافه می‌کند.</sup>

## حذف forwarding

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_delete.sh)
```

<sup>توضیح کوتاه: قوانین forwarding را حذف می‌کند. پس از حذف، برای اعمال تغییرات firewall را با `ufw reload` بارگذاری مجدد کنید و سیستم را با `reboot` ری‌استارت کنید.</sup>

---

## جمع‌آوری دامنه‌ها از چند اشتراک

این ابزار دامنه‌ها را از اشتراک‌ها استخراج می‌کند و برای generator یک `whitelist` می‌سازد.

```bash
node get_domains.js
```

<sup>توضیح کوتاه: لینک چند اشتراک را در اسکریپت اضافه کنید و دستور را اجرا کنید. خروجی، فهرست دامنه‌ها خواهد بود. برای اجرای اسکریپت به `Node.js` نیاز است.</sup>

---

## نکات و محدودیت‌های فعلی

- فهرست عمومی دامنه‌ها با همه ارائه‌دهندگان کار نمی‌کند، بنابراین توصیه می‌شود whitelist خودتان را بسازید و استفاده کنید.

---

## مشارکت

از هرگونه مشارکت در توسعه پروژه استقبال می‌شود! روند ساده برای مشارکت‌کنندگان:

1. مخزن را در GitHub fork کنید.
2. شاخه‌ای با نام معنادار بسازید، مثل `feature/add-README` یا `fix/whitelist-load`.
3. تغییرات را اعمال کنید و توضیح کوتاهی در commit بنویسید.
4. در صورت وجود، بررسی‌های محلی را اجرا کنید.
5. شاخه را به fork خود push کنید و در مخزن اصلی Pull Request بسازید.

<sup>نکته: تغییرات، هدف و مراحل تست را در PR توضیح دهید. اگر تغییرات بزرگ هستند، آن‌ها را به commitهای کوچک تقسیم کنید.</sup>

---

## گفتگو

- تلگرام: [@denpiligrim_web](https://t.me/denpiligrim_web)
- بخش Issues در همین مخزن

## نویسندگان و قدردانی

پروژه اصلی را [@DenPiligrim](https://github.com/denpiligrim) ساخته و فورک را [@K0TD](https://github.com/k0td) نگهداری می‌کند. از مشارکت‌کنندگان سپاسگزاریم:

- [@zangetsuka](https://github.com/zangetsuka) — Happ routing، [PR #53](https://github.com/denpiligrim/3dp-manager/pull/53). پشتیبانی Happ به فورک منتقل و با INCY تکمیل شده است؛ امضای commitهای اصلی `root` بود.
- [@xFalconMH](https://github.com/xFalconMH) — روتیشن با ساخت پیش از حذف و پاک‌سازی، [PR #59](https://github.com/denpiligrim/3dp-manager/pull/59). ایده با نگهداری نسل سالم و پاک‌سازی فورک سازگار شده است.
- [@PavelArs](https://github.com/PavelArs) — سازگاری ساختار کلاینت 3x-ui، [PR #62](https://github.com/denpiligrim/3dp-manager/pull/62). سازگاری `tgId` در فورک منتقل شده است.
- [@n1xsi](https://github.com/n1xsi) — سازگاری 3x-ui، CSRF، عیب‌یابی، آدرس Trojan و probe، [PR #63](https://github.com/denpiligrim/3dp-manager/pull/63). فورک از اصلاحات مربوط و probe عیب‌یابی استفاده می‌کند.
- [@K0TD](https://github.com/k0td) — عملیات اجباری و پس‌زمینه ورود، [PR #64](https://github.com/denpiligrim/3dp-manager/pull/64). فورک حذف اجباری و حالت‌های اختصاصی حذف نود را پشتیبانی می‌کند.
- [@lunal1ght](https://github.com/lunal1ght) — گزارش مسیر گواهی در [issue #52](https://github.com/denpiligrim/3dp-manager/issues/52). فورک از گواهی نود و مسیر سفارشی پشتیبانی می‌کند.
- [@keidos57](https://github.com/keidos57) — تأیید مشکل تولید در [issue #61](https://github.com/denpiligrim/3dp-manager/issues/61) مرتبط با سازگاری `tgId` که در فورک اصلاح شده است.
- [@iqubik](https://github.com/iqubik) — مشارکت در نصب، رابط، تست و مستندات از جمله [PR #39](https://github.com/denpiligrim/3dp-manager/pull/39). از Jules (`google-labs-jules[bot]`) و دیگر مشارکت‌کنندگان نیز سپاسگزاریم.

فهرست کامل در تاریخچه Git و صفحه مشارکت‌کنندگان [فورک](https://github.com/k0td/3dp-manager/graphs/contributors) و [پروژه اصلی](https://github.com/denpiligrim/3dp-manager/graphs/contributors) است. مجوز: [GPL-3.0](LICENSE).
