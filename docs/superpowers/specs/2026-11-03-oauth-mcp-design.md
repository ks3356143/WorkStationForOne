# OAuth 远程 MCP 支持设计

- 日期：2026-11-03
- 状态：待评审
- 基线：v0.37.0，DB v30
- 验证目标：Notion `https://mcp.notion.com/mcp`（支持动态客户端注册）

## 1. 背景

外部 MCP 目前只支持静态请求头：`mcp_server_secrets` 用 `safeStorage` 加密保存 header / env，启动 Claude 或 Codex 时解密进临时配置或子进程环境。公网 Server 越来越多使用 OAuth（Linear、Notion、Atlassian），静态头既拿不到 Token，也会过期。

本设计给远程 HTTP MCP 增加一条通用 OAuth 2.1 链路：运行时发现授权服务器、动态客户端注册、授权码 + PKCE、回环回调、Token 加密存储与刷新。不硬编码具体服务。

## 2. 范围

v1 做：

- 通用 MCP OAuth 发现（401 → `WWW-Authenticate` → 受保护资源元数据 → 授权服务器元数据）
- 动态客户端注册（DCR，RFC 7591）；授权服务器不支持 DCR 时给可读错误
- 授权码 + PKCE（S256）+ `state` + `resource`（RFC 8707）
- 回环回调：固定候选端口 `43110–43119` 的 `/oauth/callback`（DCR 时一次注册这一组 `redirect_uri`，避免每次登录重新注册）
- 访问 / 刷新 Token 用 `safeStorage` 加密存本机，按 Server 隔离
- 过期自动刷新；连接测试遇到 401 先刷新一次再重试
- 能力中心：认证方式选择、登录 / 重新登录 / 退出、状态徽标
- Claude 与 Codex 运行时自动注入 `Authorization: Bearer <access_token>`

v1 不做：

- OAuth 服务端实现、代理或托管
- 预先注册 Client ID 的手动填表流程（DCR 不支持时明确报错；后续可加）
- 写 `~/.claude`、`~/.codex`、CC Switch 或桌面端配置
- 把 Token 暴露给渲染层、日志、审计或命令行

## 3. 关键决策

1. **按规范运行时发现，不硬编码端点。** 先从 MCP Server 的 401 响应读取 `resource_metadata`，取不到再回退 `/.well-known/oauth-protected-resource`；授权服务器元数据先试 `/.well-known/oauth-authorization-server`，再回退 `/.well-known/openid-configuration`。
2. **只支持公开客户端 + PKCE。** DCR 请求 `token_endpoint_auth_method = "none"`；若授权服务器签发 `client_secret`，按返回的 `token_endpoint_auth_method` 支持 `client_secret_post` / `client_secret_basic`，Secret 同样加密存储。
3. **回环回调，不开自定义协议。** 固定候选端口 43110–43119，只接受精确路径 `/oauth/callback`；DCR 时一次注册整组重定向地址，登录时按顺序找可用端口。`state` 一次性、10 分钟有效；回调页不含任何 Token。
4. **认证方式按 Server 显式选择。** `mcp_servers.auth` 取 `headers | oauth`，默认 `headers`。OAuth 与手动 `Authorization` 头互斥：选了 OAuth 就忽略手写的 `Authorization` 头，避免两份凭据打架。
5. **刷新失败不阻塞会话。** 启动会话时无法刷新的 OAuth Server 从本轮运行时里跳过，并把 `last_error` 记为「登录已过期」；能力中心状态显示「已过期」，用户重新登录即可。不静默使用旧 Token 发请求。
6. **Token 只在主进程。** 渲染层只拿到状态与过期时间；运行时注入沿用现有临时 `--mcp-config` / 子进程环境机制，不新增落盘位置。

## 4. 数据模型（DB v31）

`mcp_servers` 增加：

```sql
auth TEXT NOT NULL DEFAULT 'headers' CHECK (auth IN ('headers', 'oauth'))
```

新增 `mcp_oauth`（与 `mcp_servers` 1:1，随 Server 删除）：

```sql
CREATE TABLE mcp_oauth (
  server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL DEFAULT '',
  resource TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  client_secret_encrypted BLOB,
  authorization_endpoint TEXT NOT NULL DEFAULT '',
  token_endpoint TEXT NOT NULL DEFAULT '',
  registration_endpoint TEXT NOT NULL DEFAULT '',
  scopes TEXT NOT NULL DEFAULT '',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  access_token_encrypted BLOB,
  refresh_token_encrypted BLOB,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL
);
```

`state`、`code_verifier`、回调端口只留在内存，不落库。改 Server URL 或切换认证方式时清空 `mcp_oauth` 并清掉旧测试结果。

## 5. 主进程模块

新增 `src/main/capabilities/oauth/`：

- `discovery.ts`：`discoverOAuth(resourceUrl, headers)` → `{ resourceMetadata, authorizationServer }`。解析 401 的 `WWW-Authenticate`（大小写不敏感、引号 / 逗号容错），无头时按 RFC 9728 回退；校验元数据里 `code_challenge_methods_supported` 包含 `S256`，没有就报「授权服务器不支持 PKCE」。
- `pkce.ts`：生成 verifier / challenge（`crypto.randomBytes` + `sha256` base64url）与 `state`；纯函数，单测用固定向量。
- `flow.ts`：登录编排。输入 Server 记录与依赖（`fetch`、`openExternal`、时钟、`safeStorage` 适配），输出 Token 集。步骤：发现 → DCR（复用已有 client_id，注册失效时自动重注册一次）→ 起回环服务器 → 拼授权 URL（`response_type=code`、`client_id`、`redirect_uri`、`scope`、`state`、`code_challenge`、`code_challenge_method=S256`、`resource`）→ 打开浏览器 → 等回调（5 分钟超时）→ 校验 `state` / `iss` / 错误码 → 换 Token（`code_verifier` + `resource`）→ 落库。
- `store.ts`：`mcp_oauth` 仓储读写；Token 加解密只在这里调用 `safeStorage`；对外只返回状态与元数据。
- `refresh.ts`：`ensureAccessToken(serverId, { force })` → 有效 Token 或抛可读错误。提前 60 秒刷新；刷新 Token 轮换时原子更新；`invalid_grant` 视为需要重新登录。

`McpServerService` 改动：

- `runtimeServers()` 改为 `async`，对 `auth === 'oauth'` 的 HTTP Server 调 `ensureAccessToken()`，成功则注入 `Authorization: Bearer …`，失败则跳过并写 `last_error`；其余 Server 行为不变。更新 Claude / Codex 启动调用点。
- `test()`：携带 OAuth Token 测试；401/403 且 `auth === 'oauth'` 时强制刷新一次再重试，仍失败返回「登录已过期，请重新登录」。
- `login(id)` / `logout(id)`：登录、清除 Token 与客户端注册信息；登录写审计 `mcp.oauth-login`，退出写 `mcp.oauth-logout`，只记 Server 名称。状态由仓储读出的元数据组装进 `ExternalMcpServerRecord.oauth`，不单独暴露查询接口。

## 6. IPC 与 preload

`shared/ipc/capability.ts` 增加：

```ts
type ExternalMcpAuthMode = 'headers' | 'oauth'
type ExternalMcpOAuthState = 'none' | 'connected' | 'expired' | 'error'

interface ExternalMcpOAuthInfo {
  state: ExternalMcpOAuthState
  issuer: string
  scopes: string
  expiresAt: number | null
  lastError: string
}
```

- `ExternalMcpSaveInput` 增加可选 `auth`
- `ExternalMcpServerRecord` 增加 `auth` 与 `oauth: ExternalMcpOAuthInfo | null`
- WsApi 增加 `capability.mcp.login(id)`、`logout(id)`；登录返回 `{ ok: boolean; message: string }`，不返回 Token

handler 入参用现有 `assertId` 校验；登录并发按 Server 串行（同一 Server 正在登录时复用同一个 Promise）。

## 7. UI

`McpTab` 表单（仅 HTTP）：

- 「认证方式」二选一：请求头 / OAuth 登录
- 选 OAuth 时隐藏 Header 编辑器，显示说明「凭据由浏览器授权后自动保存」

Server 行：

- `auth === 'oauth'` 时显示 `已连接 / 已过期 / 未登录 / 失败` 徽标与到期时间
- 「登录 / 重新登录」「退出登录」按钮；登录中显示「等待浏览器授权…」并禁用其它操作
- 测试连接错误文案直接来自主进程（例如「登录已过期，请重新登录」）

样式走现有能力中心令牌与 `.w1-cap*` 类，不新增视觉语言。

## 8. 安全约束

- Token / Client Secret 只以 `safeStorage` 加密 BLOB 存本机；渲染层、日志、审计、命令行、仓库都不得出现明文
- 回调只监听 `127.0.0.1`，路径精确匹配，`state` 一次性；超时 5 分钟后关闭
- 只接受 `https` 授权 / Token 端点（回环地址除外）；发现结果不做持久信任，每次登录重新解析
- 校验 `iss`（若授权服务器返回）与 `state`；错误页不回显授权码或错误描述原文中的敏感值
- OAuth 不得绕过现有信任确认、工具策略、域权限与审批规则；登录本身不执行 Server 命令
- 不写 `~/.claude`、`~/.codex`、CC Switch、Claude Desktop

## 9. 错误与边界

| 场景 | 行为 |
| --- | --- |
| 授权服务器不支持 DCR | 「该服务要求预先注册客户端，当前版本暂不支持」 |
| 元数据缺少 S256 | 「授权服务器不支持 PKCE（S256）」 |
| 用户取消 / 关闭浏览器 | 5 分钟超时或回调带回 `error=access_denied`，状态回到未登录 |
| `state` 不匹配 / 重复回调 | 拒绝并记日志（不含 Token），回到未登录 |
| 刷新返回 `invalid_grant` | 标记「登录已过期」，会话启动时跳过该 Server |
| 长会话中途 Token 过期 | v1 只在会话启动时刷新；CLI 使用静态头，过期后需重新登录并重启该会话（记录为已知限制） |
| Server URL 改动 | 清空 `mcp_oauth`、旧测试结果，要求重新登录 |
| 同时点两次登录 | 同一 Server 复用进行中的登录 Promise |

## 10. 验证计划

单测：

- `WWW-Authenticate` / PRM / AS 元数据解析，含缺失与非法输入
- PKCE S256 固定向量、`state` 唯一性
- 回环回调：正确 state、错误 state、超时、`error=access_denied`
- DCR 请求体与注册失效自动重注册一次
- Token 交换 / 刷新 / 轮换，`expires_in` 与提前刷新窗口
- 仓储：加密落库、列表不返回 Token、删除 Server 级联
- 运行时：OAuth 注入 Bearer、手写 Authorization 被忽略、刷新失败跳过该 Server

集成 / 冒烟：

- 本地 mock OAuth + MCP 服务器跑完整登录（注入 `openExternal`，自动走回调）
- 冒烟断言：认证方式切换、徽标、登录按钮、退出后状态回落
- 真实 Notion：手动登录 → 测试连接列出工具 → 重启应用后仍已连接 → 退出登录后状态回落
- 截图：能力中心 OAuth 表单与已连接状态，1440×900 / 1180×720

## 11. 迁移与兼容

- v31 迁移只加列与建表，不改旧数据；旧库 Server 一律 `auth = 'headers'`，行为不变
- 已手写 `Authorization` 头的 Server 不自动切 OAuth
- `runtimeServers()` 变 `async` 属于内部接口变化，同步更新所有调用点与测试
- 不改数据库以外的任何用户配置
