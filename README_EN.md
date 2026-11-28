[Русский](/README.md) | [中文](/README_CN.md) | [فارسی](/README_IR.md) | [Türkmençe](/README_TK.md)

![Version](https://img.shields.io/badge/version-2.2.0-blue.svg) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0)

# 3DP-MANAGER · K0TD fork

A web panel that auto-generates inbounds in [3x-ui](https://github.com/MHSanaei/3x-ui) via its API. It combines connections from multiple nodes into a single subscription with a permanent URL and rotates them periodically so the traffic doesn't look uniform.

A fork of [denpiligrim/3dp-manager](https://github.com/denpiligrim/3dp-manager), GPL-3.0.

## Features

- **Nodes** (**Ноды**) — multiple 3x-ui panels (login/password or token, CSRF), automatic IP/country detection, 3x-ui and Xray version checks, automatic addition of node domains to SNI.
- **Subscriptions** (**Подписки**) — permanent URL `/bus/<UUID>`, per-connection choice of node, relay, port, SNI, flag and order; optional 3x-ui 3.x client binding with traffic/expiry stats (`subscription-userinfo`).
- **Rotation** — independent per node: a failure on one node doesn't affect the others, the working generation is kept until it is successfully replaced, and old ones are cleaned up in the background.
- **Protocols** — VLESS (Reality / TLS / WS / XHTTP / gRPC / XHTTP GET), VMess, Trojan, Shadowsocks, Hysteria2, MTProto FakeTLS, WireGuard, AmneziaWG, HTTP/SOCKS/mixed, external links.
- **Connection profiles** — Self-SNI, HTTPS Fallback (direct TLS or Nginx/Caddy), SNI profiles with fingerprint, verification via xray-core, canary rotation with automatic rollback.
- **Routing** — node presets (blocking RU domains/IPs, IP-detection services, Google over IPv4) and Happ / INCY client profiles.
- **Relay** — intermediate servers with forwarding installed over SSH from the interface, configurable TCP/UDP ports, and automatic addition of relay domains to SNI.
- **Other** — subscription metadata (note, support, website), API tokens for automation, panel migration in a single archive, safe/deferred/forced node deletion.

## Requirements

- Ubuntu 20.04+ or Debian 12+, root access.
- 3x-ui v2.9.4+ on the nodes (some protocols require newer 3x-ui/Xray versions).
- Docker and Docker Compose — the installer will set them up itself.
- For HTTPS — a domain and a certificate (optional).

## Installation

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

The script deploys `postgres`, `backend`, `frontend` to `/opt/3dp-manager`, offers a Web UI mode (Let's Encrypt / your own certificate / self-signed / HTTP), and generates a port, login and password. Change the password after the first login.

To view the credentials again:

```bash
grep -E "ADMIN_LOGIN|ADMIN_PASSWORD" /opt/3dp-manager/docker-compose.yml | sed 's/^[ \t]*//; s/^- //'
```

If `ufw` is enabled, ports `443`, `8443`, `10000-60000` (TCP/UDP) are opened.

## Update

Same command as for installation. It also works on top of an installation from the `denpiligrim` repository: it backs up the database to `/opt/3dp-manager/backups/`, switches the images to K0TD and applies migrations.

## Moving to another server

1. **Settings → Panel migration** (**Настройки → Перенос панели**) — download a `.3dp-backup` (optionally protected with a passphrase).
2. On the new server, without 3DP-MANAGER installed:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh) --restore /root/panel.3dp-backup
```

Subscription UUIDs, settings, nodes and relays are preserved.

## Uninstall

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/delete.sh)
```

## Quick start

1. **Nodes** — add the 3x-ui panel URL and authentication. The main node is used by default.
2. **Relay servers** (**Relay серверы**) — if needed, add an intermediate server and install forwarding.
3. **Domains** (**Домены**) — configure the SNI list for Reality.
4. **Subscriptions** — create a subscription, select connections, save it and copy the URL into your client.

Recommendations: serve the subscription over HTTPS, set the rotation interval to ≥ 10 minutes (once a day is optimal), and make the client auto-update more often (e.g. once an hour).

## Manual forwarding (relay)

On the intermediate server (`IP_ADDRESS` is the node's IP):

```bash
sudo ORIGIN_IP="IP_ADDRESS" bash -c "$(curl -sSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_install.sh)"
```

Optionally set `FORWARDING_TCP_PORTS` and `FORWARDING_UDP_PORTS` (defaults to `443,8443,10000:60000`; an empty value disables that protocol).

Removal (afterwards run `ufw reload` and `reboot`):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_delete.sh)
```

## Collecting domains for a whitelist

Put your multi-subscription link into `get_domains.js` and run `node get_domains.js` (Node.js required). A shared domain list doesn't work with every provider — it's better to collect your own.

## Documentation

- [api.md](api.md) — REST API, connection types, routing profiles, subscription metadata.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to propose changes.

## Feedback

[Issues](https://github.com/k0td/3dp-manager/issues)

## License and authors

[GNU GPL v3](LICENSE). Original project by [@DenPiligrim](https://github.com/denpiligrim), fork maintained by [@K0TD](https://github.com/k0td).

Thanks to: [@zangetsuka](https://github.com/zangetsuka) (Happ routing), [@xFalconMH](https://github.com/xFalconMH) (rotation order), [@PavelArs](https://github.com/PavelArs) (`tgId`), [@n1xsi](https://github.com/n1xsi) (3x-ui compatibility, CSRF, probe), [@iqubik](https://github.com/iqubik), [@lunal1ght](https://github.com/lunal1ght), [@keidos57](https://github.com/keidos57) and all [contributors](https://github.com/k0td/3dp-manager/graphs/contributors).
