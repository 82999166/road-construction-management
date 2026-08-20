# uTrust 4701 F 与 NTAG216 写卡适配核验

## 已核验事实

Hirsch 官方将 uTrust 4701 F 描述为一台 **PC 连接的双接口读写器**，可处理 ISO/IEC 7816 接触式卡与 13.56 MHz 非接触式技术，并明确列为 NFC 技术设备。[1] 官方页面同时提供该型号的数据手册、4701F 产品参考手册及 Type F 软件参考手册，说明实际接入应以设备驱动和厂商接口文档为准。[1]

| 适配项 | 当前结论 | 系统处理原则 |
|---|---|---|
| 设备角色 | PC 连接的接触式/非接触式/NFC 读写器 | 发票管理员的桌面终端或受管 Windows 设备运行本地适配器 |
| NTAG216 | 属于 13.56 MHz、NFC Forum Type 2 标签 | 先完成读 UID、写 NDEF、回读校验三个受控动作 |
| 浏览器直连 | 不能假定浏览器可直接调用该 USB 读写器 | 不依赖网页直接控制读写器；采用厂商 SDK 或 PC/SC/CCID 本地桥接程序 |
| 权威数据 | 车辆、司机、路线、运价与票据状态在服务端 | 卡片只存 RC3 签名载荷与现场核对字段，写卡器不保存业务数据库副本 |

4701F 官方参考手册说明设备实现 CCID 功能，并列出通过 PC/SC API 的本地通信和非接触式伪 APDU；手册包含读取 UID 的 `PAPDU_GET_UID`，以及适用于 MIFARE UL/UL C 的 4 字节非易失存储读写伪 APDU。[2] NTAG216 同属 NFC Forum Type 2 标签，但厂商手册没有在该章节逐项列出 NTAG216 型号，因此必须在实际设备与卡片上先进行**非生产卡试写、回读、重插复读**三项兼容性验证，再启用正式写卡。

| 本地桥接动作 | 4701F 官方手册依据 | 本系统要求 |
|---|---|---|
| 枚举读写器 | CCID / PC/SC 本地接口 | 桥接程序只接受本机受控管理员操作 |
| 读取 UID | `PAPDU_GET_UID` | 读取后在本地派生或上送受控指纹，不在日志保存原始 UID |
| 写入 Type 2 页 | 手册列出 MIFARE UL/UL C 的 4 字节非易失读写伪 APDU | 先以 NTAG216 测试卡验证页寻址和响应码，不假定所有固件版本相同 |
| 写后回读 | 设备原始读命令 / PCSC 传输 | 必须比较 RC3 NDEF 正文与服务器下发摘要，成功后才能确认写卡任务 |

## 待现场确认

在接入物理写卡前，需在实际安装 uTrust 4701 F 的 Windows 终端上确认：设备管理器驱动状态、厂商参考手册所列接口、是否可列为 PC/SC 读卡器、NTAG216 的 UID 读取及 Type 2 Tag NDEF 写入命令。上述确认不能由网页或云端服务器替代。

> 未确认厂商接口前，系统仅生成经审计的写卡任务和 RC3 签名载荷；不会伪造“写卡成功”，也不会将卡写保护口令传至浏览器、日志或业务数据库。

## References

[1] [Hirsch：uTrust 4701 F Dual Interface Smart Card Contact Reader/Writer](https://www.hirschsecure.com/us/en-us/products/smart-card-readers/utrust-4701-f-dual-interface-smart-card-contact-reader-writer)

[2] [Hirsch：uTrust 4701F / 4711F 官方参考手册](https://go.hirschsecure.com/hubfs/LACS/manual/utrust_47xx_F_ProductManual.pdf)
