# 深度安全、架构与代码审计工作底稿（只读）

> 本文件仅保存已复核的证据与待进一步核验项；不代表已批准修复方案，也不包含任何密钥、口令、令牌、OpenID 或连接字符串。

## 已排除的初步误报

| 初步线索 | 复核结论 | 依据 |
|---|---|---|
| 认证服务未配置时自动注入管理员 | **不成立** | `server/_core/context.ts:11-28` 认证异常时仅将 `user` 设为 `null`。 |
| `/api/parse-session-files` 与 `/api/upload-image` 对外暴露 | **不成立于当前生产入口** | `server/_core/index.ts:35-83` 仅注册 OAuth、身份恢复、服务号、Heartbeat、RFID、存储代理和 tRPC；当前 `dist/index.cjs` 不含这两个路径标记。 |
| `.project-config.json` 已提交到版本库 | **不成立** | 文件未被 Git 跟踪且在忽略规则中；本地文件仍包含敏感配置键名，按工作区敏感资产管理。 |

## 已确认的身份与前端边界问题

| 编号 | 初步等级 | 已核实事实 | 证据 |
|---|---:|---|---|
| A-01 | 高 | 临时超级管理员登录入口仍可配置且正式运行配置中用户名、口令均处于“已配置”状态；成功后以管理员身份创建 8 小时会话。 | `server/localAuth.ts:11-15,103-107,169-191`；正式运行配置仅核对“configured/empty”状态。 |
| A-02 | 中 | 普通本地管理员登录失败限流状态仅保存在进程内 `Map`；服务重启会清零，未来多实例也不会共享。 | `server/localAuth.ts:16-18,30-31,64-69,195-214`。 |
| A-03 | 低 | PC/手机终端限制使用 `User-Agent` 判定，属于可伪造的辅助控制，不应视作安全边界。 | `server/localAuth.ts:154-166`。 |
| A-04 | 中 | 生产前端错误边界把原始 `error.stack` 渲染到页面。 | `client/src/components/ErrorBoundary.tsx:24-40`。 |
| A-05 | 低 | 认证 Hook 将 `/auth.me` 返回对象镜像到 `localStorage`；需核对实际字段后确定是否超出最小化需求。 | `client/src/_core/hooks/useAuth.ts:67-85`。 |

## 已确认的正式运行环境问题

| 编号 | 初步等级 | 已核实事实 | 证据 |
|---|---:|---|---|
| O-01 | 高 | 应用 systemd 服务以 `root` 运行，且 `ProtectSystem`、`ProtectHome`、`PrivateTmp`、`NoNewPrivileges` 均未启用。 | 正式服务器只读 `systemctl show yx-cloud-management`。 |
| O-02 | 高 | 防火墙存在面向公网的宽范围端口规则，包括管理面板端口与 `1:65000/tcp` 全端口段，应逐项确认业务必要性。 | 正式服务器只读 `ufw status`。 |
| O-03 | 中 | HTTPS 首页仅见服务端标识，未返回 HSTS、CSP、X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy 等常见防护头。HTTP 已正确 301 跳转 HTTPS。 | 正式域名只读 `curl -I`。 |

## 依赖审计初步结果

1. 已运行 `pnpm audit --prod --json`，原始结果保存为 `/tmp/yx-pnpm-audit.json`，仅用于本轮审计。
2. 已确认 `xlsx@0.18.5` 处于 SheetJS 原型污染和 ReDoS 公告影响范围；最终等级取决于系统是否解析外部上传的 Excel，尚待代码调用链核验。
3. `@trpc/server@11.6.0` 命中 Next.js App Router 专用 `experimental_nextAppDirCaller` 公告；当前系统使用 Express 适配器，暂不作为可利用风险。
4. AWS SDK、Express 及 Streamdown/Mermaid 子依赖存在可升级公告；应在确认实际可达解析路径与兼容矩阵后统一安排依赖升级，避免仅凭扫描结果误判为可利用漏洞。

## 后续只读复核清单

1. 复核当前根路由中 `broadcastRouter` 及其相关后台能力是否属于正式业务范围，并审计其操作权限、审计与删除语义。
2. 核对 Excel 导入、Markdown 渲染、微信 XML 与文件上传实际调用链，以评估依赖公告的可达性。
3. 核对备份、恢复、回滚脚本的实际演练证据和 RPO/RTO 约束。
4. 汇总关键业务状态机、条件更新与审计链的已验证结论，不将历史遗留或未部署代码作为当前生产漏洞报告。
