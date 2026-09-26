# 词屿 · Render 部署版

四模块单词学习 + 管理员登录 + CSV / JSON 独立词库导入与统一发布。Node.js 服务和 PostgreSQL 数据库，不需要安装 Cloudflare 工具。原 Cloudflare 版保留在另一个项目中，本包独立运行。

## 从 GitHub 部署（使用外部 PostgreSQL）

本项目只在 Render 创建网站服务，**不创建 Render 数据库**。你可以自行选择其他平台的 PostgreSQL。

1. 解压项目，把**文件夹里面的内容**上传到 GitHub 仓库根目录。根目录应直接看到 `render.yaml`、`package.json`、`package-lock.json`，不要只上传 ZIP。
2. 登录 Render，选择 **New → Blueprint**，连接此 GitHub 仓库。
3. Render 读取 `render.yaml`，只创建一个 Free Web Service。
4. 按提示填写 `DATABASE_URL`（外部 PostgreSQL 连接串）和 `ADMIN_PASSWORD`（你设置的后台密码）。
5. 确认创建，等待部署成功。数据库表会在服务启动时自动初始化。
6. 打开生成的 `https://…onrender.com` 地址学习；地址后加 `/admin.html` 进入词库后台。

### 需要配置的环境变量

| 变量 | 是否必填 | 填写内容 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | 数据库平台提供的 PostgreSQL 连接串，包含用户名、密码、主机、端口和数据库名 |
| `ADMIN_PASSWORD` | 是 | 自行设置的长随机密码，用于登录词库管理后台 |
| `PUBLIC_ORIGIN` | 否 | 使用自定义域名时填写，例如 `https://words.example.com`；默认 Render 域名无需填写 |
| `PORT` | 否 | Render 自动提供；本地默认 3000 |

连接串示意：`postgresql://用户名:密码@数据库地址:5432/数据库名`。优先复制提供商给出的完整连接串，保留提供商要求的 SSL/TLS 查询参数；若手工组装，密码中的 `@`、`:`、`/` 等特殊字符需 URL 编码。不要把真实连接串或密码上传到 GitHub，填写在 Render 的 Environment 中。

数据库地址需要能从 Render 连接，不能填写你电脑的 `localhost`。数据库账号需要能创建本项目的表和索引。首次部署建议使用专用数据库；自动建表 SQL 位于 `migrations/001_initial.sql`，也可在数据库平台手动执行。连接失败时服务停止启动，不会改为临时文件存储。

Render 免费 Web Service 闲置 15 分钟后会休眠，首次访问需要等待启动。词库保存在外部 PostgreSQL，Render 重启不会删除词库；外部平台自身的免费额度、休眠和保留期限由该平台决定。个人学习进度仍保存在访客浏览器中。

如果此前已经创建了 Render 数据库，本次配置变更不会自动迁移其数据；请先备份、迁移或逐模块导出词库，再修改 `DATABASE_URL`。不要在确认迁移成功前删除旧数据库。

官方说明：[Render 免费限制](https://render.com/docs/free)、[GitHub Web Service 部署](https://render.com/docs/web-services)、[Blueprint 配置](https://render.com/docs/blueprint-spec)。

## 手动创建 Web Service

如果不使用 Blueprint：准备好外部 PostgreSQL 连接串，再创建 Web Service 并连接 GitHub：

| 设置 | 值 |
| --- | --- |
| Language | Node |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Instance Type | Free（或自行选择） |
| Root Directory | 文件在仓库根目录则留空 |

添加环境变量：

- `DATABASE_URL`：外部数据库提供商的连接串，保留其要求的 TLS 参数。
- `ADMIN_PASSWORD`：你设置的管理员密码。
- `NODE_VERSION`：`22`。
- `PUBLIC_ORIGIN`：仅在使用自定义域名时填网站完整来源，例如 `https://words.example.com`。默认自动使用 Render 分配的网址。

数据库凭据、密码只填 Render Environment，不上传 `.env`。启动时数据库不可用会直接报错停止，不会改用可能丢数据的临时存储。

## 功能

1. 单词认知：英文、音标和朗读 → 点击英译英 → 点击中文翻译与英文例句。
2. 英译中选择：中文释义选项、即时校验。
3. 中译英拼写：中文提示、输入英文；答错展示答案、音标、朗读、英文释义和例句。
4. 听音拼写：点击播放发音，填写英文，不提前显示答案。

默认 18 个示例词、SVG 插图，保留自动学习、错题隔题重试、复习调度和学习备份。四模块分别上传词库、预览和发布。发布后访客刷新读取；个人进度不是账号云同步。发音依赖设备的英语语音功能。

## 导入词库

进入 `/admin.html`，登录后选择模块，下载模板，编辑 CSV UTF-8 或 JSON，上传预览并发布。

必填列：`word`（或 `id`）、`ipa`、`meaning`、`definition`、`sentence`、`translation`。例句必须包含目标单词。模板在 `templates/`；每模块 1–1000 词，文件与完整发布请求最多 1 MB。发布只替换当前模块，并检查版本防止覆盖别人的更新。密码仅保存在当前管理页面内存中。

## 本地开发与测试

需要 Node.js 22+，以及一个 PostgreSQL 数据库。

```sh
npm ci
# 参考 .env.example 创建 .env，填入实际连接信息。
node --env-file=.env server/index.js
```

默认 http://localhost:3000 。执行 `npm test` 运行单元和数据库适配集成测试（测试使用内存 PostgreSQL 模拟器，不访问生产数据库）。

`migrations/001_initial.sql` 包含 PostgreSQL 建表 SQL，启动会幂等执行；不是 Cloudflare D1 的 SQL。交互采用参数绑定、设备隔离、事务批量写入和重复事件去重。后台采用管理员密码校验、请求大小限制和版本冲突检查。

此包已完成本地验证，不代表已经在你的 Render 账户上线。
