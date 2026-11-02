# 自有服务器数据库全表备份与恢复核验

## 现有能力与本次补齐

系统原有的“业务数据备份”是受控的在线逻辑快照。它刻意排除口令摘要、第三方密钥、系统敏感配置、审计日志以及影像文件本体，因此**不能代替 MySQL 全库灾备**。本次新增的脚本使用 `mysqldump --databases` 导出指定数据库的全部基础表、触发器、存储例程与事件；完成后执行 gzip 完整性校验、逐表 `CREATE TABLE` 定义核验、SHA-256 清单记录和过期文件轮换。

> 备份脚本不会向业务库插入测试数据，也不会读取或打印数据库口令。MySQL 凭据必须保存在仅备份服务账户可读的客户端配置文件中。

| 项目 | 默认策略 |
|---|---|
| 执行时间 | 每日北京时间 02:30，额外随机延迟最多 15 分钟 |
| 导出范围 | 指定 MySQL 数据库内全部基础表、表结构、数据、触发器、例程和事件 |
| 一致性 | `--single-transaction`，适用于 InnoDB 业务库 |
| 完整性 | gzip 测试、SHA-256、逐表建表语句核验、JSON 清单 |
| 保留 | 默认 30 天，可在 `backup.env` 中设为 7–3650 天 |
| 失败处理 | 非零退出、写入 `latest-failure.json`，由 systemd 日志记录 |
| 浏览器取件 | 默认关闭；仅已验证备份、超级管理员二次确认、同源流式下载、审计和断点续传 |

> 完整备份包含全部业务数据。系统**不提供在线恢复**。浏览器取件只用于经授权的灾备交付，不等同于恢复操作；必须保存至受控加密介质，禁止转发、上传个人网盘或留存在非受控电脑。

## 一次性安装步骤

以下步骤由服务器环境管理员执行。备份应使用独立的无登录系统账户 `yxbackup`，而不是应用服务账户。`pnpm build:self-host` 会将完整备份脚本归档到生产包；安装备份服务时再将脚本复制到只读的受控运行时目录，使低权限备份账户无需读取应用发布目录。

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin yxbackup
sudo groupadd --system yxbackupreaders
sudo usermod -a -G yxbackupreaders yxbackup
sudo usermod -a -G yxbackupreaders yxapp
sudo install -d -m 2750 -o yxbackup -g yxbackupreaders /var/backups/yx-cloud-management/mysql
sudo install -d -m 0750 -o root -g yxbackup /etc/yx-cloud-management
sudo editor /etc/yx-cloud-management/mysql-backup.cnf
```

`/etc/yx-cloud-management/mysql-backup.cnf` 仅写入 MySQL 备份专用、只读导出权限账号，文件权限必须为 `0640`，属主 `root:yxbackup`。不要把口令写入项目源码、systemd unit 或命令行。

`yxbackupreaders` 只读取**已生成的备份工件和无敏感状态清单**：目录使用 setgid `2750`，备份文件使用 `0640`。应用账户 `yxapp` 加入该组后仅可为受控下载流式读取工件，不能写入、删除目录或读取 `mysql-backup.cnf`、`backup.env`。变更组成员后必须重启应用服务，使其获得新组身份。

```ini
[client]
user=请填写备份专用账号
password=请填写该账号口令
host=127.0.0.1
port=3306
```

创建 `/etc/yx-cloud-management/backup.env`：

```ini
YX_DB_BACKUP_DATABASE=请填写实际业务库名
YX_DB_BACKUP_MYSQL_DEFAULTS_FILE=/etc/yx-cloud-management/mysql-backup.cnf
YX_DB_BACKUP_DIR=/var/backups/yx-cloud-management/mysql
YX_DB_BACKUP_KEEP_DAYS=30
```

安装并启用定时器：

```bash
sudo install -m 0644 deploy/yx-db-backup.service /etc/systemd/system/yx-db-backup.service
sudo install -m 0644 deploy/yx-db-backup.timer /etc/systemd/system/yx-db-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now yx-db-backup.timer
sudo systemctl start yx-db-backup.service
sudo systemctl status yx-db-backup.timer --no-pager
sudo journalctl -u yx-db-backup.service -n 80 --no-pager
```

发布时应将 `self-host-db-backup.mjs`、`verify-self-host-db-backup.mjs` 更新到 `/usr/local/lib/yx-cloud-management/backup/`，属主 `root:root`、目录不可由 `yxapp` 或 `yxbackup` 写入。不要把 `/etc/yx-cloud-management/backup.env`、`mysql-backup.cnf` 或任何历史转储打入发布包。

管理后台的“执行完整备份”由应用账户通过**仅允许这一条固定命令**的 sudoers 规则启动单个 unit；禁止给应用账户授予 shell、任意 `systemctl`、任意 sudo 或数据库凭据读取权。环境管理员在确认实际服务账号与 unit 名称后创建类似以下规则，并使用 `visudo -f` 校验：

```sudoers
yxapp ALL=(root) NOPASSWD: /usr/bin/systemctl start yx-db-backup.service
```

如需打开“下载已验证完整备份”，在**应用**受限运行时环境文件中设置非敏感开关，并重启应用服务：

```dotenv
YX_DB_BACKUP_BROWSER_DOWNLOAD_ENABLED=true
# 可选：仅允许浏览器下载不超过该字节数的已验证压缩包。
YX_DB_BACKUP_BROWSER_DOWNLOAD_MAX_BYTES=4294967296
```

默认保持关闭。开启后仍只有超级管理员在后台二次确认后可下载；服务端每次重新校验会话、超级管理员权限、最新已验证清单、SHA-256 标识、目录边界、常规文件类型和文件大小。下载名不含数据库名或服务器路径，支持单 Range 断点续传，且每次 GET 写入“下载开始”审计摘要。

## 每次备份后核验

成功后目录会出现 `.sql.gz`、同名 `.manifest.json` 和 `latest-success.json`。清单中的 `tableCount` 必须与 `tables` 数量一致，且 `verification` 同时显示 gzip 与全表定义校验通过。

```bash
node /usr/local/lib/yx-cloud-management/backup/verify-self-host-db-backup.mjs \
  /var/backups/yx-cloud-management/mysql/请填写某个备份文件.sql.gz.manifest.json
```

## 受控恢复演练

恢复演练必须在**空的非生产数据库**中进行，禁止将导入命令直接指向正在运行的业务库。先离线核验清单，再由数据库管理员创建演练库、导入备份、比对表数量和抽样关键表记录数。演练成功后记录日期、备份文件名、表数量和结果；不要把演练库的连接口令写入系统或审计文档。

备份脚本只在压缩与逐表定义校验通过后原子更新 `latest-success.json`；失败时只记录稳定错误码，并保留此前最近一次已验证成功备份。后台同时存在“最近成功”和“最近失败”时，应以成功清单的校验状态和时间判断可恢复版本，不能把陈旧失败误判为当前没有可用备份。

## 受控下载的反向代理要求

完整备份下载路由必须仍经应用同源会话鉴权，不能配置为静态目录、对象存储公开链接或 Nginx `alias`。若备份容量可能超过默认反向代理时限，在实际生效的站点配置中为**固定路由模式**追加专用 location；关闭代理缓冲，延长发送/读取超时，并关闭访问日志（下载审计以应用数据库为准，避免把工件标识写入普通 Web 日志）：

```nginx
location ~ ^/api/admin/backups/full/[a-f0-9]{64}/download$ {
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 7200s;
    proxy_send_timeout 7200s;
    access_log off;
}
```

修改宝塔 Nginx 配置前先在维护窗口备份实际生效站点配置并执行语法检查；不应为了下载功能重启其他站点或放开应用监听端口。
