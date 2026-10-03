# ADR 0002：阶段 1 身份规则

日期：2026-10-02。用户授权按推荐方案冻结阶段 1 身份参数。

## 决定

- 用户名为 3–32 位 ASCII 字母、数字或下划线；登录和唯一性比较不区分大小写，展示保留注册时的大小写。
- 密码为 15–128 个字符；服务端使用 Argon2id（19 MiB、2 次迭代、并行度 1）加盐哈希，不设置字符组合规则。
- 首发仅面向 18 岁及以上用户；注册请求必须明确声明已满 18 岁，暂不收集出生日期。
- 各设备使用独立、可撤销的服务端 Cookie 会话；空闲 30 分钟过期，创建后最长 8 小时过期。登录时轮换当前设备会话，不影响其他设备。
- 注册每 IP 每小时最多 5 次；登录每 IP 每 15 分钟最多 20 次、每规范化用户名每 15 分钟最多 5 次。计数放 PostgreSQL，使用固定时间窗；部署阶段需核实反向代理传递的可信客户端 IP。
- 所有修改状态的身份请求核对精确 Origin；退出还需 `X-CSRF-Token`，由同一会话的 `GET /api/auth/csrf` 取得。生产站点须配置 HTTPS、`__Host-` Cookie 名与独立 CSRF 密钥。

## 依据与边界

密码长度、Argon2id 参数、会话空闲及最长时限参考 OWASP 指南；具体时限和限流阈值是本项目选择。完整部署限流、账号滥用监测与多设备会话管理界面留待阶段 7，阶段 1 仅提供当前设备退出。

参考：[OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。
