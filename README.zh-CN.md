<div align="center">

# SendFolio

**分享文档，并看清对方每一页读了多久。**
免费、可自托管的开源 DocSend 替代品，为创始人而做。

[![CI](https://github.com/MurrayCmy/sendfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/MurrayCmy/sendfolio/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[English](README.md) · [简体中文](README.zh-CN.md)

</div>

你在融资、做企业销售，或者在搭建数据室。你把 BP 以 PDF 发出去，然后就没有下文了：对方打开了吗？读了哪几页？有没有转发？

SendFolio 为每位收件人生成专属链接，要求对方验证邮箱，（可选）签署 NDA，在浏览器里展示文档，并在每一页水印上对方的名字，
最后告诉你对方在每一页停留了多久。你把它部署在自己的服务器和域名上，文档和读者数据都留在你手里。

<p align="center">
  <img src="docs/images/overview.png" alt="后台概览" width="860">
</p>

<table>
  <tr>
    <td><img src="docs/images/reader.png" alt="收件人看到的页面（带水印）"></td>
    <td><img src="docs/images/analytics.png" alt="每页阅读热力图"></td>
  </tr>
  <tr>
    <td align="center"><sub>收件人看到的页面，水印是 TA 的名字</sub></td>
    <td align="center"><sub>所有读者在每页的阅读时长</sub></td>
  </tr>
</table>

## 功能

- **每位收件人一个专属链接**：可自定义地址（`你的域名/acme`）、设置有效期和访问密码，随时停用或删除。
- **阅读分析**：每页停留时长、读到哪一页、所有读者的热力图、回访、设备与地点，以及“正在阅读”提示。
- **跟进清单**：看出谁回访、谁读得深；给每个人设置跟进状态并写私人备注。
- **邮箱验证**：访问者填写姓名和工作邮箱，并输入 6 位验证码。可拒绝个人邮箱，或只允许指定公司域名。
- **NDA 门槛与电子签署**：对方先同意保密协议才能看到内容。每次签署生成一份 PDF（协议加签署记录：时间、IP、协议文本哈希），并邮件发给签署人。
- **动态水印**：把访问者的姓名、邮箱、IP 和时间烙印在页面图片上（下载的 PDF 也有），显示哪些字段由你选择。
- **页面以图片形式提供**，不直接给 PDF，并带防篡改检测；可选带水印的 PDF 下载。
- **通知**：有人打开链接时发邮件，读完后再发一封阅读小结。
- **中英双语**：后台、阅读页、邮件和 PDF 都支持英文和简体中文，也方便添加其他语言。
- **到处都能跑**：Docker、VPS、Netlify，或者在笔记本上 `npm start`。没有厂商绑定。

## 两分钟试用

需要 Node.js 22 或更新版本。

```bash
git clone https://github.com/MurrayCmy/sendfolio.git
cd sendfolio
npm install
npm run init -- --admin-email you@example.com   # 生成 .env 和随机密钥
npm run build
npm run demo      # 可选：写入一些虚构的示例数据，方便先看看效果
npm start
```

打开 <http://localhost:8787/admin>。登录验证码会打印在终端里（还没配置邮件）。示例数据里有一个链接：<http://localhost:8787/acme>。

试用模式使用内置数据库和本地文件。正式使用请选择下面的部署方式。

## 正式部署

| 方式 | 适合 | 数据库 | 文件 | 指南 |
|---|---|---|---|---|
| **Docker Compose** | 任何 VPS 或家用服务器，推荐 | PostgreSQL（已包含） | Docker 卷 | [docs/deploy-docker.md](docs/deploy-docker.md) |
| **Netlify** | 不想管服务器 | Netlify Database 或任意 Postgres | Netlify Blobs | [docs/deploy-netlify.md](docs/deploy-netlify.md) |
| **Railway、Render、Fly.io 等** | 托管容器平台 | 平台托管的 Postgres | 挂载卷 | [docs/deploy-paas.md](docs/deploy-paas.md) |
| **直接用 Node.js** | 笔记本、小型服务器 | 内置 PGlite 或 Postgres | 本地目录 | 本页 |

无论哪种方式，你都需要：一个域名（或子域名）、一个能发邮件的 SMTP 账号（Resend、Gmail、Postmark、SES 等都行），以及十来分钟。

### 让 AI 助手替你部署

SendFolio 专门为 AI 编程助手（Claude Code、Codex、Gemini CLI、Grok、Antigravity、Cursor 等）能顺利部署而设计。用助手打开这个文件夹，然后粘贴：

> 请把这个仓库里的 SendFolio 部署到 **【我的 VPS 上用 Docker / Netlify / Railway】**。请遵循 `AGENTS.md`。凡是你查不到的信息（管理员邮箱、域名、SMTP 凭据）请向我询问。
> 完成后运行 `npm run doctor` 和 `npm test`，并告诉我后台地址。

[`AGENTS.md`](AGENTS.md) 包含各部署方式的分步手册、需要向你确认的问题，以及验证方法。`npm run doctor -- --json` 为助手提供机器可读的健康检查。

## 配置

全部用环境变量配置，[`.env.example`](.env.example) 对每一项都有说明。重要的有：`ADMIN_EMAIL`、`SITE_URL`、`SESSION_SECRET`、`SMTP_*`、`APP_NAME`、
`DEFAULT_LOCALE`（`en` 或 `zh`）、`TIMEZONE`。详见 [docs/configuration.md](docs/configuration.md)；自定义名称、颜色、logo、NDA 文本和语言见 [docs/customization.md](docs/customization.md)。

## 隐私与安全

- 访问者会被告知记录了哪些信息：姓名、邮箱、时间、IP 地址、设备和每页停留时间。
- 会话使用签名的 HttpOnly Cookie；登录验证码有频率限制；后台只接受一个邮箱地址登录。
- 威胁模型、局限（水印只能威慑，拍屏幕照片是拦不住的）以及如何报告漏洞，见 [SECURITY.md](SECURITY.md)。
- **自带的 NDA 只是示例模板，不构成法律意见。** 正式使用的文本请让律师确认。

## 状态

SendFolio 还很年轻（v0.1）。作者在生产环境使用它，标注“推荐”的部署方式在 CI 里有测试。欢迎提 Issue 和 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[Apache License 2.0](LICENSE)。名称和 logo 的使用见 [TRADEMARKS.md](TRADEMARKS.md)，第三方声明见 [NOTICE](NOTICE)。
