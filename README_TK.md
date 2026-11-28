[Русский](/README.md) | [English](/README_EN.md) | [中文](/README_CN.md) | [فارسی](/README_IR.md)

![Version](https://img.shields.io/badge/version-2.2.0-blue.svg) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0)

# 3DP-MANAGER · K0TD fork

[3x-ui](https://github.com/MHSanaei/3x-ui) panelinde onuň API-si arkaly inbound-lary awtomatiki döredýän web-panel. Ol birnäçe node-dan gelýän birikmeleri hemişelik URL-li bir abuna jemleýär we trafik birmeňzeş görünmez ýaly olary wagtal-wagtal çalşyp durýar.

[denpiligrim/3dp-manager](https://github.com/denpiligrim/3dp-manager) taslamasynyň forky, GPL-3.0.

## Mümkinçilikler

- **Node-lar** (**Ноды**) — birnäçe 3x-ui paneli (login/parol ýa-da token, CSRF), IP/ýurt awtomatiki kesgitlemek, 3x-ui we Xray wersiýalaryny barlamak, node domenini SNI sanawyna awtomatiki goşmak.
- **Abunalar** (**Подписки**) — hemişelik URL `/bus/<UUID>`, her birikme üçin node, relay, port, SNI, baýdak we tertip saýlamak; islege görä 3x-ui 3.x müşderisini baglamak we trafik/möhlet statistikasyny bermek (`subscription-userinfo`).
- **Rotasiýa** — her node üçin aýratyn: bir node-yň näsazlygy beýlekilere täsir etmeýär, işleýän nesil üstünlikli çalşylýança saklanýar, köne nesiller fonda arassalanýar.
- **Protokollar** — VLESS (Reality / TLS / WS / XHTTP / gRPC / XHTTP GET), VMess, Trojan, Shadowsocks, Hysteria2, MTProto FakeTLS, WireGuard, AmneziaWG, HTTP/SOCKS/mixed, daşarky salgylar.
- **Birikme profilleri** — Self-SNI, HTTPS Fallback (göni TLS ýa-da Nginx/Caddy), fingerprint bilen SNI profilleri, xray-core arkaly barlag, awtomatiki yzyna gaýtarmak bilen canary-rotasiýa.
- **Marşrutlaşdyrma** — node-lar üçin taýýar sazlamalar (RU domenlerini/IP-lerini, IP kesgitleýän hyzmatlary blokirlemek, Google-y IPv4 arkaly) we Happ / INCY müşderi profilleri.
- **Relay** — interfeýsiň özünden SSH arkaly ugrukdyrma gurnalýan aralyk serwerler, sazlanýan TCP/UDP portlary, relay domenini SNI sanawyna awtomatiki goşmak.
- **Beýlekiler** — abuna metamaglumatlary (bellik, goldaw, saýt), awtomatlaşdyrma üçin API tokenleri, paneli bir arhiw bilen göçürmek, node-lary howpsuz/gijikdirilen/mejbury pozmak.

## Talaplar

- Ubuntu 20.04+ ýa-da Debian 12+, root elýeterliligi.
- Node-larda 3x-ui v2.9.4+ (käbir protokollar 3x-ui/Xray-yň has täze wersiýalaryny talap edýär).
- Docker we Docker Compose — gurnaýjy olary özi gurnar.
- HTTPS üçin — domen we sertifikat (hökmany däl).

## Gurnamak

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

Skript `postgres`, `backend`, `frontend` hyzmatlaryny `/opt/3dp-manager` içinde ýerleşdirer, Web UI režimini (Let's Encrypt / öz sertifikatyňyz / self-signed / HTTP) teklip eder, port, login we parol döreder. Ilkinji girişden soň paroly üýtgediň.

Giriş maglumatlaryny gaýtadan görmek:

```bash
grep -E "ADMIN_LOGIN|ADMIN_PASSWORD" /opt/3dp-manager/docker-compose.yml | sed 's/^[ \t]*//; s/^- //'
```

Eger `ufw` açyk bolsa, `443`, `8443`, `10000-60000` (TCP/UDP) portlary açylýar.

## Täzelemek

Gurnamak üçin ulanylýan şol bir buýruk. `denpiligrim` repozitoriýasyndan edilen gurnamanyň üstünden hem işleýär: maglumat bazasynyň ätiýaçlyk nusgasyny `/opt/3dp-manager/backups/` içinde döredýär, obrazlary K0TD-ä geçirýär we migrasiýalary ulanýar.

## Başga serwere göçürmek

1. **Sazlamalar → Paneli göçürmek** (**Настройки → Перенос панели**) — `.3dp-backup` faýlyny ýükläp alyň (parol sözlemi bilen goramak mümkin).
2. 3DP-MANAGER gurnalmadyk täze serwerde:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh) --restore /root/panel.3dp-backup
```

Abunalaryň UUID-leri, sazlamalar, node-lar we relay-lar saklanýar.

## Aýyrmak

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/delete.sh)
```

## Çalt başlangyç

1. **Node-lar** — 3x-ui paneliniň URL-ini we awtorizasiýany goşuň. Esasy node deslapky ýagdaýda ulanylýar.
2. **Relay serwerler** (**Relay серверы**) — zerur bolsa, aralyk serwer goşuň we ugrukdyrmany gurnaň.
3. **Domenler** (**Домены**) — Reality üçin SNI sanawyny sazlaň.
4. **Abunalar** — abuna dörediň, birikmeleri saýlaň, ýatda saklaň we URL-i müşderä göçüriň.

Maslahatlar: abunany HTTPS arkaly beriň, rotasiýa aralygy ≥ 10 minut (iň amatlysy — günde bir gezek), müşderide awtomatiki täzelenme — has ýygy (meselem, sagatda bir gezek).

## Ugrukdyrmany (relay) el bilen sazlamak

Aralyk serwerde (`IP_ADDRESS` — node-yň IP-si):

```bash
sudo ORIGIN_IP="IP_ADDRESS" bash -c "$(curl -sSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_install.sh)"
```

Zerur bolanda `FORWARDING_TCP_PORTS` we `FORWARDING_UDP_PORTS` üýtgeýjilerini beriň (deslapky baha `443,8443,10000:60000`; boş baha degişli protokoly öçürýär).

Aýyrmak (soňra — `ufw reload` we `reboot`):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_delete.sh)
```

## Whitelist üçin domenleri ýygnamak

`get_domains.js` faýlynda multi-abuna salgysyny görkeziň we `node get_domains.js` işlediň (Node.js gerek). Umumy domen sanawy ähli prowaýderlerde işlemeýär — öz sanawyňyzy ýygnamak has gowy.

## Resminamalar

- [api.md](api.md) — REST API, birikme görnüşleri, marşrutlaşdyrma profilleri, abuna metamaglumatlary.
- [CONTRIBUTING.md](CONTRIBUTING.md) — üýtgetmeleri nädip teklip etmeli.

## Pikir alyşmak

[Issues](https://github.com/k0td/3dp-manager/issues)

## Ygtyýarnama we awtorlar

[GNU GPL v3](LICENSE). Asyl taslama — [@DenPiligrim](https://github.com/denpiligrim), forky [@K0TD](https://github.com/k0td) goldaýar.

Minnetdarlyk: [@zangetsuka](https://github.com/zangetsuka) (Happ routing), [@xFalconMH](https://github.com/xFalconMH) (rotasiýa tertibi), [@PavelArs](https://github.com/PavelArs) (`tgId`), [@n1xsi](https://github.com/n1xsi) (3x-ui bilen gabat gelmek, CSRF, probe), [@iqubik](https://github.com/iqubik), [@lunal1ght](https://github.com/lunal1ght), [@keidos57](https://github.com/keidos57) we ähli [gatnaşyjylara](https://github.com/k0td/3dp-manager/graphs/contributors).
