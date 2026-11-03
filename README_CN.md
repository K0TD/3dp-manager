[Русский](/README.md) | [English](/README_EN.md) | [فارسی](/README_IR.md) | [Türkmençe](/README_TK.md)

<p><img src="https://denpiligrim.ru/storage/images/3dp-manager.png" alt="3dp-manager preview"></p>

![Version](https://img.shields.io/badge/version-2.2.0-blue.svg) ![Downloads](https://img.shields.io/badge/downloads-5.1k-blue) [![License](https://img.shields.io/badge/license-GPL%20V3-blue.svg?longCache=true)](https://www.gnu.org/licenses/gpl-3.0) [![Telegram](https://img.shields.io/badge/Telegram-26A5E4?style=flat&logo=telegram&logoColor=white)](https://t.me/denpiligrim_web) [![YouTube Channel Subscribers](https://img.shields.io/youtube/channel/subscribers/UCOv2tFFYDY4mXOM60PVz8zw)](https://www.youtube.com/@denpiligrim)

# 3DP-MANAGER · K0TD fork

3DP-MANAGER 是一个用于为 [3x-ui](https://github.com/MHSanaei/3x-ui) 面板自动生成 inbound、创建统一订阅、管理多个 3x-ui 节点，并配置从中间服务器到源服务器的 relay 转发的工具。从 2.0.0 版本开始，项目提供图形界面和简单的用户设置。

**支持项目**

- 银行转账：
  - :credit_card: MIR 卡：`2204320436318077`
  - :credit_card: MasterCard：`5395452209474530`
- 电子钱包：
  - :moneybag: YooMoney：`4100116897060652`
  - :moneybag: PayPal：`vasiljevdenisx@gmail.com`
- 加密货币：
  - :coin: USDT | ETH (ERC20 | BEP20)：`0x6fe140040f6Cdc1E1Ff2136cd1d60C0165809463`
  - :coin: USDT | TRX (TRC20)：`TEWxXmJxvkAmhshp7E61XJGHB3VyM9hNAb`
  - :coin: Bitcoin：`bc1qctntwncsv2yn02x2vgnkrqm00c4h04c0afkgpl`
  - :coin: TON：`UQCZ3MiwyYHXftPItMMzJRYRiKHugr16jFMq2nfOQOOoemLy`
  - :coin: Bybit ID：`165292278`

## 描述

该工具的主要目标是让您的流量看起来不那么单一。3DP-MANAGER 会按设定间隔生成一组具有不同参数的连接：

- 协议：`vless`、`vmess`、`shadowsocks`、`hysteria2`、`trojan`；
- 端口：固定的 `443`、`8443`，以及 `10000-59999` 范围内的随机端口；
- 传输：`tcp`、`websocket`、`grpc`、`xhttp`；
- SNI 可从域名白名单中选择，也可以手动指定；
- 每个 inbound 都可以单独设置节点、relay 服务器、端口和旗帜。

所有连接会合并到一个具有静态 URL 的订阅中。3DP-MANAGER 通过 `3x-ui` 面板的公开 API 工作，不会直接干预面板内部。

次要目标是提高连接稳定性：客户端会收到多个连接选项，并可选择其中任意一个。一个订阅可以包含来自不同节点的 inbound、relay 服务器，以及作为自定义连接添加的外部链接。

此外，3DP-MANAGER 也可用于级联部署。转发服务会把订阅和流量转发配置到选定节点。

建议：

- 为订阅使用 HTTPS（域名 + SSL 证书）。
- 生成间隔设置为不少于 10 分钟；为了稳定性，建议每天一次（1440 分钟）。
- 在客户端设置更频繁的自动更新，例如每小时一次，以便与服务器保持同步。

## 功能

- 为一个或多个订阅生成多样化连接
- 创建具有静态 URL 的统一订阅
- 管理多个 `3x-ui` 节点
- 支持使用登录名/密码或 token 进行节点认证
- 根据面板 URL 自动检测节点 IP、国家和旗帜
- 可为每个 inbound 选择节点、relay 服务器、旗帜、SNI 和端口
- 支持固定端口或 `random`
- 支持自定义连接：可将现成的外部链接加入订阅
- 可为 Hysteria2 UDP 单独指定 `fullchain.pem` 和 `privkey.pem` 路径
- 支持自定义域名 `whitelist`
- 可选的自动 relay 转发配置
- Web UI 可通过 HTTP 或 HTTPS 安装：Let's Encrypt、自签名证书或自定义证书

## 分支功能与配置

1. 添加 3x-ui 节点和认证信息，主节点作为默认值；按需添加 relay 并安装转发，配置 SNI 域名后创建订阅。轮换时 `/bus/<UUID>` 地址保持不变。
2. 支持 VLESS TCP/XHTTP/gRPC Reality、VLESS WS、VLESS TCP/WS/XHTTP TLS、VMess、Shadowsocks、Trojan Reality、Hysteria2、MTProto FakeTLS、AmneziaWG、WireGuard、HTTP/SOCKS/mixed 和自定义链接。具体可用性取决于面板与 Xray 版本；AmneziaWG 需要 3x-ui 3.7 或更高版本。MTProto 使用面板内置的 Xray 桥接。
3. Reality 的 SNI 配置按域名选择 fingerprint、`spiderX`、XHTTP 路径和填充；未匹配时使用 `chrome`。TLS 使用节点证书或指定证书路径与 TLS 名称。
4. 各节点独立轮换，失败时保留上一次可用配置，旧 inbound 会等待清理。AmneziaWG、WireGuard 和 HTTP/SOCKS/mixed 在保存时创建，轮换不改变密钥或端口；修改类型、节点、relay 或端口时先删除并保存，再重新添加。
5. 删除节点：`safe` 先清理面板 inbound，失败则停止，但已删除的 inbound 不会恢复；`deferred` 隐藏节点并延后清理；`force` 不访问面板，直接删除本地记录，面板中残留的 inbound 需手动检查。订阅保留；后两种模式会禁用受影响配置，之后有可用节点时轮换可能自动启用。
6. 节点路由预设可阻止俄罗斯域名/IP 或 IP 检测服务，并让 Google 使用 IPv4；它们修改服务器端 Xray 路由，依赖已安装的地理数据库，与客户端路由配置不同。
7. 服务器 API 支持 `happ-routing`、`incy-routing`，订阅的 `note`、`supportUrl`、`websiteUrl`，以及 `vless-xhttp-get`（XHTTP packet-up、GET、无 TLS/SNI）。路由配置排在连接前，不计入 20 个连接的限制。在订阅表单中选择 **Happ routing** 或 **INCY routing**，并在多行字段中输入配置；表单还提供**备注**、**支持链接**、**网站**和 **VLESS XHTTP GET** 连接类型。首页以易懂的文字和提示显示操作错误，技术详情默认折叠。详见 [api.md](api.md)。
8. 普通删除订阅在 3x-ui 清理失败时停止；`force=true` 会继续删除，需手动检查并清除面板残留 inbound。

可在设置的面板迁移功能中导出备份，然后在新服务器运行分支安装脚本并传入 `--restore /root/panel.3dp-backup`。备份可用独立密码保护，包含订阅 UUID、节点、设置和 relay 凭据。

## 要求

- Ubuntu 20.04 或更高版本，Debian 12.11 或更高版本
- `3x-ui` 面板 v2.9.4 或更高版本
- 服务器 root 权限
- Docker 和 Docker Compose；如果缺失，安装脚本会尝试自动安装
- 域名 + SSL 证书（可选）

---

## 安装

必须先安装 `3x-ui` 控制面板。可使用以下命令安装：`bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)`

在服务器上安装项目：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

安装过程中，脚本会：

- 检查操作系统、root 权限、Docker 和 Docker Compose；
- 如果内存较低且没有 swap，则创建 2 GB 的 swap 文件；
- 询问 Web UI 访问模式：
  - 通过 Let's Encrypt 使用 HTTPS；
  - 使用自签名证书的 HTTPS；
  - 使用自有证书的 HTTPS；
  - 不加密的 HTTP；
- 生成随机 Web UI 端口；
- 生成管理员登录名和密码；
- 部署 `postgres`、`backend` 和 `frontend` 容器。

安装完成后，终端会显示 URL、登录名和密码。请立即在 3DP-MANAGER 设置中修改密码。

<sup>简要说明：运行交互式安装脚本，准备环境并部署项目容器。</sup>

## 更新

更新到最新版本：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)
```

<sup>简要说明：拉取最新更改，应用兼容的配置修复，更新容器并重启服务。</sup>

## 删除

彻底删除服务：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/delete.sh)
```

<sup>简要说明：删除容器和配置文件，将系统恢复到安装前状态。</sup>

---

## 首次登录

管理员登录名和密码会在安装结束时输出。如需再次查看：

```bash
grep -E "ADMIN_LOGIN|ADMIN_PASSWORD" /opt/3dp-manager/docker-compose.yml | sed 's/^[ \t]*//; s/^- //'
```

Web UI 可通过安装脚本显示的地址访问，例如：

- HTTPS：`https://example.com:PORT`；
- HTTP：`http://SERVER_IP:PORT`。

如果启用了 `ufw`，安装脚本会开放 inbound 工作端口范围：TCP/UDP 的 `443`、`8443` 和 `10000-60000`。

---

## 节点

**节点** 页面用于连接一个或多个 `3x-ui` 面板。

每个节点需要设置：

- 名称；
- `3x-ui` 面板 URL；
- 节点 IP；
- 旗帜/国家；
- 认证类型：`password` 或 `token`；
- 是否为主节点。

输入 URL 后，应用会尝试自动检测节点 IP 和国家。旗帜会用于订阅中的连接名称，方便客户端区分服务器。

> [!NOTE]
> 主节点会作为订阅、inbound 和 relay 服务器的默认值。

---

## 订阅

**订阅** 页面用于管理静态订阅 URL 和 inbound 组成。

每个 inbound 可配置：

- 连接类型；
- 节点；
- relay 服务器；
- 旗帜；
- 端口：`1-65535` 的具体数字或 `random`；
- SNI：具体域名或 `random`；
- `custom` 类型的现成外部链接。

对于 `hysteria2-udp`，可以单独指定证书和密钥路径：

- `node` 模式通过 3x-ui `getWebCertFiles` 读取面板证书路径；
- `custom` 模式需要 TLS server name 以及节点上的证书和私钥绝对路径。

如果端口或 SNI 设置为 `random`，轮换时会从可用端口范围或域名白名单中选择值。

---

## 安装转发服务

> [!WARNING]
> 转发服务运行在中间服务器上

转发服务会把中间服务器的入站端口代理到选定节点。在 Web UI 中，这些服务器在 **Relay 服务器** 页面配置，并可绑定到具体节点。

Relay 服务器可以通过 IP 或域名添加。如果提供域名，backend 会尝试自动解析其 IP。

如需在中间服务器上手动安装 forwarding，请将 `IP_ADDRESS` 替换为源节点 IP：

```bash
sudo ORIGIN_IP="IP_ADDRESS" bash -c "$(curl -sSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_install.sh)"
```

<sup>简要说明：添加转发规则。</sup>

## 删除转发

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/forwarding_delete.sh)
```

<sup>简要说明：删除转发规则。删除后，请执行 `ufw reload` 重新加载防火墙，并执行 `reboot` 重启系统以使更改生效。</sup>

---

## 从多订阅收集域名

该工具会从订阅中提取域名，并为生成器构建 `whitelist`。

```bash
node get_domains.js
```

<sup>简要说明：在脚本中添加多订阅链接并运行命令，输出将是域名列表。运行脚本需要 `Node.js`。</sup>

---

## 注意事项和当前限制

- 共享域名列表并非适用于所有服务商，因此建议准备并使用自己的 whitelist。

---

## 贡献

欢迎任何贡献！简单的贡献流程：

1. 在 GitHub 上 fork 仓库。
2. 创建有意义的分支名，例如 `feature/add-README` 或 `fix/whitelist-load`。
3. 修改代码，并在 commit 中添加简短说明。
4. 如有本地检查，请运行它们。
5. 将分支推送到你的 fork，并向主仓库创建 Pull Request。

<sup>建议：在 PR 中说明更改、目标和测试步骤。如果更改较大，请拆分为较小的 commit。</sup>

---

## 讨论

- Telegram: [@denpiligrim_web](https://t.me/denpiligrim_web)
- 本仓库的 Issues 区

## 作者与致谢

原项目由 [@DenPiligrim](https://github.com/denpiligrim) 创建，分支由 [@K0TD](https://github.com/k0td) 维护。感谢各位贡献者：

- [@zangetsuka](https://github.com/zangetsuka) — Happ routing，[PR #53](https://github.com/denpiligrim/3dp-manager/pull/53)。分支移植了 Happ 支持并扩展 INCY；原始提交签名为 `root`。
- [@xFalconMH](https://github.com/xFalconMH) — 先创建后删除的轮换和清理，[PR #59](https://github.com/denpiligrim/3dp-manager/pull/59)。这一思路已适配分支的可用配置保留与清理机制。
- [@PavelArs](https://github.com/PavelArs) — 3x-ui 客户端结构兼容，[PR #62](https://github.com/denpiligrim/3dp-manager/pull/62)。分支移植了 `tgId` 兼容处理。
- [@n1xsi](https://github.com/n1xsi) — 3x-ui 兼容、CSRF、诊断、Trojan 地址和 probe，[PR #63](https://github.com/denpiligrim/3dp-manager/pull/63)。分支使用了相关修复和诊断 probe。
- [@K0TD](https://github.com/k0td) — 强制操作和登录背景，[PR #64](https://github.com/denpiligrim/3dp-manager/pull/64)。分支支持强制删除和自己的节点删除模式。
- [@lunal1ght](https://github.com/lunal1ght) — 在 [issue #52](https://github.com/denpiligrim/3dp-manager/issues/52) 报告证书路径问题；分支支持节点证书和自定义路径。
- [@keidos57](https://github.com/keidos57) — 在 [issue #61](https://github.com/denpiligrim/3dp-manager/issues/61) 确认生成问题；相关 `tgId` 兼容问题已在分支中修复。
- [@iqubik](https://github.com/iqubik) — 安装程序、界面、测试和文档贡献，包括 [PR #39](https://github.com/denpiligrim/3dp-manager/pull/39)。也感谢 Jules（`google-labs-jules[bot]`）及所有其他贡献者。

完整名单见 Git 历史及[分支](https://github.com/k0td/3dp-manager/graphs/contributors)、[原项目](https://github.com/denpiligrim/3dp-manager/graphs/contributors)贡献者页面。许可证：[GPL-3.0](LICENSE)。
