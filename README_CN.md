[Русский](/README.md) | [English](/README_EN.md) | [فارسی](/README_IR.md) | [Türkmençe](/README_TK.md)

![Version](https://img.shields.io/badge/version-2.2.0-blue.svg) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0)

# 3DP-MANAGER · K0TD fork

一个通过 [3x-ui](https://github.com/MHSanaei/3x-ui) API 自动生成 inbound 的 Web 面板。它将多个节点的连接汇总到一个拥有固定 URL 的订阅中，并定期轮换这些连接，使流量看起来不那么单一。

本项目是 [denpiligrim/3dp-manager](https://github.com/denpiligrim/3dp-manager) 的分支，采用 GPL-3.0 许可证。

## 功能

- **节点**（**Ноды**）— 支持多个 3x-ui 面板（用户名/密码或令牌、CSRF），自动识别 IP/国家，检查 3x-ui 和 Xray 版本，自动将节点域名添加到 SNI 列表。
- **订阅**（**Подписки**）— 固定 URL `/bus/<UUID>`，可为每个连接选择节点、relay、端口、SNI、旗帜和顺序；可选绑定 3x-ui 3.x 客户端并输出流量/到期统计（`subscription-userinfo`）。
- **轮换** — 按节点独立进行：单个节点故障不会影响其他节点，当前可用的一代连接会保留到成功替换为止，旧连接在后台清理。
- **协议** — VLESS（Reality / TLS / WS / XHTTP / gRPC / XHTTP GET）、VMess、Trojan、Shadowsocks、Hysteria2、MTProto FakeTLS、WireGuard、AmneziaWG、HTTP/SOCKS/mixed、外部链接。
- **连接配置** — Self-SNI、HTTPS Fallback（直接 TLS 或 Nginx/Caddy）、带 fingerprint 的 SNI 配置、通过 xray-core 校验、带自动回滚的 canary 轮换。
- **路由** — 节点预设（屏蔽俄罗斯域名/IP、IP 检测服务、Google 走 IPv4）以及 Happ / INCY 客户端配置。
- **Relay** — 中转服务器，可直接在界面中通过 SSH 安装转发，支持自定义 TCP/UDP 端口并自动将 relay 域名添加到 SNI 列表。
- **其他** — 订阅元数据（备注、支持、网站）、用于自动化的 API 令牌、单个归档文件完成面板迁移、安全/延迟/强制删除节点。

## 要求

- Ubuntu 20.04+ 或 Debian 12+，root 权限。
- 节点上安装 3x-ui v2.9.4+（部分协议需要更新版本的 3x-ui/Xray）。
- Docker 和 Docker Compose — 安装脚本会自动安装。
- 如需 HTTPS — 需要域名和证书（可选）。

## 安装

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

脚本会将 `postgres`、`backend`、`frontend` 部署到 `/opt/3dp-manager`，提供 Web UI 模式选择（Let's Encrypt / 自有证书 / 自签名 / HTTP），并生成端口、用户名和密码。首次登录后请修改密码。

再次查看登录凭据：

```bash
grep -E "ADMIN_LOGIN|ADMIN_PASSWORD" /opt/3dp-manager/docker-compose.yml | sed 's/^[ \t]*//; s/^- //'
```

如果启用了 `ufw`，将开放端口 `443`、`8443`、`10000-60000`（TCP/UDP）。

## 更新

与安装使用相同的命令。也可以在从 `denpiligrim` 仓库安装的版本上直接运行：脚本会将数据库备份到 `/opt/3dp-manager/backups/`，把镜像切换为 K0TD 并应用迁移。

## 迁移到其他服务器

1. **设置 → 面板迁移**（**Настройки → Перенос панели**）— 下载 `.3dp-backup` 文件（可设置密码短语）。
2. 在未安装 3DP-MANAGER 的新服务器上执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh) --restore /root/panel.3dp-backup
```

订阅 UUID、设置、节点和 relay 都会被保留。

## 卸载

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/delete.sh)
```

## 快速开始

1. **节点** — 添加 3x-ui 面板 URL 和认证信息。默认使用主节点。
2. **Relay 服务器**（**Relay серверы**）— 如有需要，添加中转服务器并安装转发。
3. **域名**（**Домены**）— 配置 Reality 使用的 SNI 列表。
4. **订阅** — 创建订阅，选择连接，保存并将 URL 复制到客户端。

建议：通过 HTTPS 提供订阅，轮换间隔 ≥ 10 分钟（最佳为每天一次），客户端自动更新频率更高一些（例如每小时一次）。

## 手动配置转发（relay）

在中转服务器上执行（`IP_ADDRESS` 为节点 IP）：

```bash
sudo ORIGIN_IP="IP_ADDRESS" bash -c "$(curl -sSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_install.sh)"
```

如需自定义端口，可设置 `FORWARDING_TCP_PORTS` 和 `FORWARDING_UDP_PORTS`（默认为 `443,8443,10000:60000`；空值表示禁用对应协议）。

删除（之后执行 `ufw reload` 和 `reboot`）：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_delete.sh)
```

## 收集白名单域名

在 `get_domains.js` 中填入多订阅链接，然后运行 `node get_domains.js`（需要 Node.js）。通用域名列表并非对所有运营商都有效 — 最好自行收集。

## 文档

- [api.md](api.md) — REST API、连接类型、路由配置、订阅元数据。
- [CONTRIBUTING.md](CONTRIBUTING.md) — 如何提交修改建议。

## 反馈

[Issues](https://github.com/k0td/3dp-manager/issues)

## 许可证与作者

[GNU GPL v3](LICENSE)。原项目作者 [@DenPiligrim](https://github.com/denpiligrim)，分支由 [@K0TD](https://github.com/k0td) 维护。

致谢：[@zangetsuka](https://github.com/zangetsuka)（Happ 路由）、[@xFalconMH](https://github.com/xFalconMH)（轮换顺序）、[@PavelArs](https://github.com/PavelArs)（`tgId`）、[@n1xsi](https://github.com/n1xsi)（3x-ui 兼容性、CSRF、probe）、[@iqubik](https://github.com/iqubik)、[@lunal1ght](https://github.com/lunal1ght)、[@keidos57](https://github.com/keidos57) 以及所有[贡献者](https://github.com/k0td/3dp-manager/graphs/contributors)。
