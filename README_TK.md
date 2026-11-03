[Русский](/README.md) | [English](/README_EN.md) | [中文](/README_CN.md) | [فارسی](/README_IR.md)

<p><img src="https://denpiligrim.ru/storage/images/3dp-manager.png" alt="3dp-manager preview"></p>

![Version](https://img.shields.io/badge/version-2.2.0-blue.svg) ![Downloads](https://img.shields.io/badge/downloads-5.1k-blue) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0) [![Telegram](https://img.shields.io/badge/Telegram-26A5E4?style=flat&logo=telegram&logoColor=white)](https://t.me/denpiligrim_web) [![YouTube Channel Subscribers](https://img.shields.io/youtube/channel/subscribers/UCOv2tFFYDY4mXOM60PVz8zw)](https://www.youtube.com/@denpiligrim)

# 3DP-MANAGER · K0TD fork

[3x-ui](https://github.com/MHSanaei/3x-ui) paneli üçin inbound-lary awtomatiki döretmäge, birleşdirilen abunalary düzmäge, birnäçe 3x-ui node-ny dolandyrmaga we aralyk serwerlerden esasy serwerlere relay forwarding sazlamaga niýetlenen gural. 2.0.0 wersiýadan bäri taslamada grafiki interfeýs we ýönekeý ulanyjy sazlamalary bar.

**Taslamany goldaň**

- Bank geçirimi:
  - :credit_card: MIR kart: `2204320436318077`
  - :credit_card: MasterCard: `5395452209474530`
- Elektron gapjyk:
  - :moneybag: YooMoney: `4100116897060652`
  - :moneybag: PayPal: `vasiljevdenisx@gmail.com`
- Kriptowalýuta:
  - :coin: USDT | ETH (ERC20 | BEP20): `0x6fe140040f6Cdc1E1Ff2136cd1d60C0165809463`
  - :coin: USDT | TRX (TRC20): `TEWxXmJxvkAmhshp7E61XJGHB3VyM9hNAb`
  - :coin: Bitcoin: `bc1qctntwncsv2yn02x2vgnkrqm00c4h04c0afkgpl`
  - :coin: TON: `UQCZ3MiwyYHXftPItMMzJRYRiKHugr16jFMq2nfOQOOoemLy`
  - :coin: Bybit ID: `165292278`

## Düşündiriş

Guralyň esasy maksady trafigiňiziň birmeňzeş görünmezligini gazanmakdyr. 3DP-MANAGER bellenen aralykda dürli parametrli baglanyşyklar toplumyny döredýär:

- protokollar: `vless`, `vmess`, `shadowsocks`, `hysteria2`, `trojan`;
- portlar: hemişelik `443`, `8443` we `10000-60000` aralygyndaky tötänleýin portlar;
- transport: `tcp`, `websocket`, `grpc`, `xhttp`;
- SNI domen whitelist-den alynýar ýa-da el bilen berilýär;
- her inbound üçin node, relay serwer, port we baýdak aýratyn sazlanýar.

Ähli baglanyşyklar statik URL-li bir abuna birleşdirilýär. 3DP-MANAGER `3x-ui` paneli bilen onuň açyk API-si arkaly işleýär we paneliň içki işine göni gatyşmaýar.

Ikinji maksat baglanyşygyň durnuklylygydyr: müşderi birnäçe baglanyşyk wariantyny alýar we islänini saýlap bilýär. Bir abuna dürli node-lardan inbound-lary, relay serwerleri we custom baglanyşyk hökmünde taýýar daşarky linkleri goşup bolýar.

Mundan başga-da, 3DP-MANAGER kaskadly shemada ulanylyp bilner. Forwarding hyzmaty abunany we trafigi saýlanan node-a ugrukdyrmagy sazlaýar.

Maslahatlar:

- Abuna üçin HTTPS ulanyň (domen + SSL şahadatnamasy).
- Döretmek aralygyny azyndan 10 minut goýuň; durnuklylyk üçin günde bir gezek (1440 minut) maslahat berilýär.
- Müşderide awtomatiki täzelenmäni ýygy goýuň, meselem her sagat, serwer bilen sazlaşyk saklansyn.

## Mümkinçilikler

- Bir ýa-da birnäçe abuna üçin dürli baglanyşyklar döredýär
- Statik URL bilen birleşdirilen abuna döredýär
- Birnäçe `3x-ui` node-ny dolandyrýar
- Node autentifikasiýasyny login/password ýa-da token arkaly goldaýar
- Panel URL-den node IP-sini, ýurduny we baýdagyny awtomatiki kesgitleýär
- Her inbound üçin node, relay serwer, baýdak, SNI we port saýlamaga mümkinçilik berýär
- Hemişelik porty ýa-da `random` bahasyny goldaýar
- Custom baglanyşyklary goldaýar: taýýar daşarky linki abuna goşup bolýar
- Hysteria2 UDP üçin `fullchain.pem` we `privkey.pem` ýollaryny aýratyn görkezmäge mümkinçilik berýär
- Öz domen `whitelist` sanawyňyzy goldaýar
- Relay forwarding-i awtomatiki sazlamak mümkinçiligi bar
- Web UI HTTP ýa-da HTTPS arkaly gurnalýar: Let's Encrypt, self-signed ýa-da öz şahadatnamalaryňyz

## Fork mümkinçilikleri we sazlama

1. 3x-ui node-syny we giriş maglumatlaryny goşuň; esasy node deslapky saýlawdyr. Gerek bolsa relay we forwarding guruň, SNI domenlerini düzüň we abuna dörediň. Rotasiýada `/bus/<UUID>` salgysy üýtgemeýär.
2. VLESS TCP/XHTTP/gRPC Reality, VLESS WS, VLESS TCP/WS/XHTTP TLS, VMess, Shadowsocks, Trojan Reality, Hysteria2, MTProto FakeTLS, AmneziaWG, WireGuard, HTTP/SOCKS/mixed we custom linkler goldanýar. Elýeterlilik paneliň we Xray-yň wersiýasyna bagly; AmneziaWG üçin 3x-ui 3.7 ýa-da täze gerek. MTProto paneliň Xray köprüsini ulanýar.
3. Reality üçin SNI profilleri domene görä fingerprint, `spiderX`, XHTTP ýoly we padding saýlaýar; gabat gelmese `chrome` ulanylýar. TLS üçin node-nyň şahadatnama ýollary ýa-da aýratyn görkezilen ýollar we TLS ady ulanylýar.
4. Node-lar aýratyn rotasiýa edilýär; näsazlykda iň soňky işleýän toplum saklanýar we köne inbound-lar arassalanýar. AmneziaWG, WireGuard we HTTP/SOCKS/mixed saklanylanda döredilip, rotasiýada açaryny we portuny saklaýar; görnüşini, node-ny, relay-i ýa-da porty üýtgetmek üçin ilki pozup saklaň, soň täze baglanyşyk goşuň.
5. Node pozmagyň görnüşleri: `safe` ilki paneldäki inbound-lary pozýar, ýalňyşlykda saklanýar, emma öň pozulan inbound-lar dikeldilmeýär; `deferred` node-ny gizläp soň arassalaýar; `force` 3x-ui bilen habarlaşman ýerli ýazgylary pozýar, panelde galan inbound-lary el bilen barlamaly. Abunalar saklanýar; soňky iki usul degişli sazlamalary öçürýär, elýeterli node bolsa olar indiki rotasiýada awtomatiki işläp biler.
6. Node routing presetleri Russiýa domenlerini/IP-lerini ýa-da IP barlag hyzmatlaryny petikläp, Google trafigini IPv4-a ugrukdyryp biler. Bular serwerdäki Xray düzgünleridir, geodata talap edýär we müşderi routing profillerinden tapawutlanýar.
7. Serwer API-si `happ-routing`, `incy-routing`, abunanyň `note`, `supportUrl`, `websiteUrl` meýdanlaryny we `vless-xhttp-get` görnüşini (XHTTP packet-up, GET, TLS/SNI ýok) goldaýar. Routing setirleri baglanyşyklardan öň gelýär we 20 baglanyşyk çägine goşulmaýar. Abuna formasynda **Happ routing** ýa-da **INCY routing** görnüşini saýlap, profili köp setirli meýdana giriziň; formada **bellik**, **goldaw salgysy**, **web sahypasy** we **VLESS XHTTP GET** baglanyşyk görnüşi hem bar. Baş sahypa operasiýa ýalňyşlaryny düşnükli tekst we maslahat bilen görkezýär, tehniki maglumatlar bolsa ýapyk bölümde saklanýar. [api.md](api.md) serediň.
8. Adaty abuna pozmasy 3x-ui arassalamasy şowsuz bolsa durýar. `force=true` abunany barybir pozýar; panelde galan inbound-lary barlap el bilen aýyryň.

Sazlamalardaky panel göçürme bölüminden ätiýaçlyk nusgasyny alyň, soň täze serwerde fork gurnawçysyny `--restore /root/panel.3dp-backup` bilen işlediň. Aýratyn parol ulanyp bolýar; abuna UUID-leri, node-lar, sazlamalar we relay maglumatlary saklanýar. Dikeltmek diňe 3DP-MANAGER gurnalmadyk serwerde işleýär: `/opt/3dp-manager/docker-compose.yml` bar bolsa, gurnawçy adaty täzelenmäni ýerine ýetirýär we arhiwi ulanmaýar, şonuň üçin ilki köne gurnamany pozuň.

## Talaplar

- Ubuntu 20.04 ýa-da täze, Debian 12.11 ýa-da täze
- `3x-ui` paneli v2.9.4 ýa-da täze
- Serwerde root elýeterliligi
- Docker we Docker Compose; ýok bolsa, gurnama skripti olary awtomatiki gurnamaga synanyşar
- Domen + SSL şahadatnamasy (islege bagly)

---

## Gurnama

`3x-ui` dolandyryş paneli öňünden gurnalan bolmaly. Ony şu komanda bilen gurnap bilersiňiz: `bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)`

Taslamany serwere gurnaň:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

Gurnama wagtynda skript:

- OS, root elýeterliligi, Docker we Docker Compose-y barlaýar;
- RAM az we swap ýok bolsa, 2 GB swap faýl döredýär;
- Web UI elýeterlilik görnüşini saýladýar:
  - Let's Encrypt arkaly HTTPS;
  - self-signed şahadatnama bilen HTTPS;
  - öz şahadatnamalaryňyz bilen HTTPS;
  - şifrlemesiz HTTP;
- Web UI üçin tötänleýin port döredýär;
- administrator login we password döredýär;
- `postgres`, `backend` we `frontend` konteýnerlerini işe goýberýär.

Gurnama tamamlanandan soň terminalda URL, login we password görkeziler. Password-y derrew 3DP-MANAGER sazlamalarynda üýtgediň.

<sup>Gysgaça: interaktiw gurnama skriptini işledýär, gurşawy taýýarlaýar we taslamanyň konteýnerlerini ýerleşdirýär.</sup>

## Täzelemek

Soňky wersiýa çenli täzelemek:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

Şol buýruk bar bolan gurnamany (şol sanda `denpiligrim` repozitoriýasyndan edilen gurnamany) tapýar, PostgreSQL-iň ätiýaçlyk nusgasyny `/opt/3dp-manager/backups/` içinde döredýär, obrazlary K0TD-e geçirýär we Docker volume-y pozmazdan migrasiýalary ulanýar. Täzelenmeden soň node sany azalsa, täzelenme saklanýar we ätiýaçlyk nusganyň ýoluny görkezýär.

<sup>Gysgaça: soňky üýtgeşmeleri alýar, laýyk konfigurasiýa düzedişlerini ulanýar, konteýnerleri täzeleýär we hyzmaty gaýtadan işledýär.</sup>

## Pozmak

Hyzmaty doly pozmak:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/delete.sh)
```

<sup>Gysgaça: konteýnerleri we konfigurasiýa faýllaryny pozýar, ulgamy gurnamadan öňki ýagdaýa getirýär.</sup>

---

## Ilkinji Giriş

Administrator login we password gurnamanyň ahyrynda görkezilýär. Olary gaýtadan görmek üçin:

```bash
grep -E "ADMIN_LOGIN|ADMIN_PASSWORD" /opt/3dp-manager/docker-compose.yml | sed 's/^[ \t]*//; s/^- //'
```

Web UI gurnawçynyň görkezen salgysy boýunça elýeterlidir, mysal üçin:

- HTTPS üçin `https://example.com:PORT`;
- HTTP üçin `http://SERVER_IP:PORT`.

Eger `ufw` işjeň bolsa, gurnawçy inbound üçin iş portlaryny açýar: TCP/UDP üçin `443`, `8443` we `10000-60000`.

---

## Node-lar

**Node-lar** bölümi bir ýa-da birnäçe `3x-ui` panelini birikdirmäge mümkinçilik berýär.

Her node üçin görkezilýär:

- ady;
- `3x-ui` panel URL-i;
- node IP-si;
- baýdak/ýurt;
- autentifikasiýa görnüşi: `password` ýa-da `token`;
- esasy node bolup durýandygy.

URL girizilenden soň programma node IP-sini we ýurduny awtomatiki kesgitlemäge synanyşýar. Baýdak abunanyň içindäki baglanyşyk atlarynda ulanylýar, müşderide serwerleri tapawutlandyrmak aňsat bolýar.

> [!NOTE]
> Esasy node abunalar, inbound-lar we relay serwerler üçin deslapky baha hökmünde ulanylýar.

---

## Abunalar

**Abunalar** bölümi statik abuna URL-lerini we inbound düzümini dolandyrýar.

Her inbound üçin sazlap bolýar:

- baglanyşyk görnüşi;
- node;
- relay serwer;
- baýdak;
- port: `1-65535` aralygyndaky anyk san ýa-da `random`;
- SNI: anyk domen ýa-da `random`;
- `custom` görnüşi üçin taýýar daşarky link.

`hysteria2-udp` üçin şahadatnama we açar ýollaryny aýratyn görkezmek bolýar:

- `node` tertibi panel sertifikat ýollaryny 3x-ui `getWebCertFiles` arkaly alýar;
- `custom` tertibi TLS server name hem-de nodedaky sertifikat/açar ýollaryny talap edýär.

Port ýa-da SNI `random` bolsa, baha rotasiýa wagtynda elýeterli aralykdan ýa-da domen whitelist-den saýlanar.

---

## Forwarding Hyzmatyny Gurnamak

> [!WARNING]
> Forwarding hyzmaty aralyk serwerde işleýär

Forwarding hyzmaty aralyk serweriň gelýän portlaryny saýlanan node-a proxy edýär. Web UI-de şeýle serwerler **Relay serwerler** bölüminde sazlanýar we belli bir node bilen baglanyşdyrylyp bilýär.

Relay serwer IP ýa-da domen boýunça goşulyp bilner. Domen görkezilse, backend onuň IP-sini awtomatiki çözmäge synanyşar.

Aralyk serwerde forwarding-i el bilen gurnamak üçin `IP_ADDRESS` ýerine esasy node IP-sini goýuň:

```bash
sudo ORIGIN_IP="IP_ADDRESS" bash -c "$(curl -sSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_install.sh)"
```

<sup>Gysgaça: forwarding düzgünlerini goşýar.</sup>

## Forwarding-i Pozmak

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_delete.sh)
```

<sup>Gysgaça: forwarding düzgünlerini pozýar. Pozlandan soň üýtgeşmeler güýje girmegi üçin firewall-y `ufw reload` bilen täzeden ýükläň we ulgamy `reboot` bilen täzeden işlediň.</sup>

---

## Multi-Abunalardan Domenleri Toplamak

Gural abunalardan domenleri çykaryp, generator üçin `whitelist` düzýär.

```bash
node get_domains.js
```

<sup>Gysgaça: skripte multi-abuna linkini goşuň we komandany işlediň. Netijede domenleriň sanawy çykýar. Skript üçin `Node.js` gerek.</sup>

---

## Bellikler We Häzirki Çäklendirmeler

- Umumy domen sanawy ähli prowaýderlerde işlemeýär, şonuň üçin öz whitelist sanawyňyzy taýýarlamak we ulanmak maslahat berilýär.

---

## Goşant

Taslama goşantlaryňyza hoşal bolarys! Goşantçylar üçin ýönekeý proses:

1. GitHub-da repozitoriýany fork ediň.
2. Manyly at bilen branch dörediň, mysal üçin `feature/add-README` ýa-da `fix/whitelist-load`.
3. Üýtgeşmeleri giriziň we commit-de gysga düşündiriş ýazyň.
4. Bar bolsa, lokal barlaglary işlediň.
5. Branch-i öz fork-uňyza push ediň we esasy repozitoriýa Pull Request dörediň.

<sup>Maslahat: PR-de üýtgeşmeleri, maksady we test ädimlerini ýazyň. Üýtgeşmeler uly bolsa, olary kiçi commit-lere bölüň.</sup>

---

## Ara Alyp Maslahatlaşmak

- Telegram: [@denpiligrim_web](https://t.me/denpiligrim_web)
- Şu repozitoriýanyň Issues bölümi

## Awtorlar we minnetdarlyk

Asyl taslamany [@DenPiligrim](https://github.com/denpiligrim) döretdi, forky [@K0TD](https://github.com/k0td) goldaýar. Goşant goşanlara minnetdar:

- [@zangetsuka](https://github.com/zangetsuka) — Happ routing, [PR #53](https://github.com/denpiligrim/3dp-manager/pull/53). Happ goldawy forka geçirilip INCY bilen giňeldildi; asyl commit-ler `root` diýip gol çekilipdi.
- [@xFalconMH](https://github.com/xFalconMH) — pozmazdan öň döretmek we arassalamak, [PR #59](https://github.com/denpiligrim/3dp-manager/pull/59). Pikir forkdaky işleýän toplumy saklamak we arassalamak usulyna uýgunlaşdyryldy.
- [@PavelArs](https://github.com/PavelArs) — 3x-ui müşderi shemasy bilen sazlaşyk, [PR #62](https://github.com/denpiligrim/3dp-manager/pull/62). `tgId` sazlaşygy forka geçirildi.
- [@n1xsi](https://github.com/n1xsi) — 3x-ui sazlaşygy, CSRF, diagnostika, Trojan salgysy we probe, [PR #63](https://github.com/denpiligrim/3dp-manager/pull/63). Degişli düzedişler we diagnostika probe-y forkda ulanylýar.
- [@K0TD](https://github.com/k0td) — mejbury operasiýalar we giriş fon suraty, [PR #64](https://github.com/denpiligrim/3dp-manager/pull/64). Fork mejbury pozmagy we öz node pozmak görnüşlerini goldaýar.
- [@lunal1ght](https://github.com/lunal1ght) — şahadatnama ýollary barada [issue #52](https://github.com/denpiligrim/3dp-manager/issues/52) habar berdi. Fork node şahadatnamalaryny we aýratyn ýollary goldaýar.
- [@keidos57](https://github.com/keidos57) — [issue #61](https://github.com/denpiligrim/3dp-manager/issues/61) boýunça döretmek meselesini tassyklady; degişli `tgId` sazlaşygy forkda düzedildi.
- [@iqubik](https://github.com/iqubik) — gurnawçy, UI, testler we dokumentasiýa, şol sanda [PR #39](https://github.com/denpiligrim/3dp-manager/pull/39). Jules-e (`google-labs-jules[bot]`) we beýleki goşantçylara-da sag bolsun aýdýarys.

Doly sanaw Git taryhynda, [forkuň](https://github.com/k0td/3dp-manager/graphs/contributors) we [asyl taslamanyň](https://github.com/denpiligrim/3dp-manager/graphs/contributors) sahypalarynda. Ygtyýarnama: [GPL-3.0](LICENSE).
