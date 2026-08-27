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

## 一次性安装步骤

以下步骤由服务器环境管理员执行。备份应使用独立的无登录系统账户 `yxbackup`，而不是应用服务账户。`pnpm build:self-host` 会将完整备份脚本归档到生产包；安装备份服务时再将脚本复制到只读的受控运行时目录，使低权限备份账户无需读取应用发布目录。

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin yxbackup
sudo install -d -m 0750 -o yxbackup -g yxbackup /var/backups/yx-cloud-management/mysql
sudo install -d -m 0750 -o root -g yxbackup /etc/yx-cloud-management
sudo editor /etc/yx-cloud-management/mysql-backup.cnf
```

`/etc/yx-cloud-management/mysql-backup.cnf` 仅写入 MySQL 备份专用、只读导出权限账号，文件权限必须为 `0640`，属主 `root:yxbackup`。不要把口令写入项目源码、systemd unit 或命令行。

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

## 每次备份后核验

成功后目录会出现 `.sql.gz`、同名 `.manifest.json` 和 `latest-success.json`。清单中的 `tableCount` 必须与 `tables` 数量一致，且 `verification` 同时显示 gzip 与全表定义校验通过。

```bash
node /usr/local/lib/yx-cloud-management/backup/verify-self-host-db-backup.mjs \
  /var/backups/yx-cloud-management/mysql/请填写某个备份文件.sql.gz.manifest.json
```

## 受控恢复演练

恢复演练必须在**空的非生产数据库**中进行，禁止将导入命令直接指向正在运行的业务库。先离线核验清单，再由数据库管理员创建演练库、导入备份、比对表数量和抽样关键表记录数。演练成功后记录日期、备份文件名、表数量和结果；不要把演练库的连接口令写入系统或审计文档。
