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

## 已完成的 Windows 现场联调

2026-08-20 已在用户 Windows 11 终端完成以下**测试卡**验证：Smart Card（`SCardSvr`）服务运行；`uTrust 4701 F CL Reader` 与 `Contact Reader` 可通过 PC/SC 枚举；CL Reader 可读取 NTAG216 UID 并收到 `9000` 响应；经用户明确授权覆盖测试卡后，已完成 RC3T 测试 NDEF 写入、回读比对、取下卡片后的独立重插重放读取。联调未触碰制造商区、静态/动态锁定位、配置页或写保护口令。

> 上述结论仅证明测试卡兼容性和本地桥接读写路径可用。正式车辆卡当前优先采用 Android Chrome 手机 NFC 一次性发卡；如日后恢复桌面正式发卡，仍须按受控写卡任务、回读校验、管理员确认和审计流程办理。

## 待现场确认

测试卡的设备、驱动、PC/SC 枚举、NTAG216 UID 读取和 NDEF 写入兼容性已完成确认。仅当业务决定重新启用桌面端**正式车辆卡**写入时，才需要以一张明确指定的正式车辆卡完成一次受控发卡、回读和运输双设备闭环验收；该步骤不应替代当前手机 NFC 发卡主路径。

> 未确认厂商接口前，系统仅生成经审计的写卡任务和 RC3 签名载荷；不会伪造“写卡成功”，也不会将卡写保护口令传至浏览器、日志或业务数据库。

## References

[1] [Hirsch：uTrust 4701 F Dual Interface Smart Card Contact Reader/Writer](https://www.hirschsecure.com/us/en-us/products/smart-card-readers/utrust-4701-f-dual-interface-smart-card-contact-reader-writer)

[2] [Hirsch：uTrust 4701F / 4711F 官方参考手册](https://go.hirschsecure.com/hubfs/LACS/manual/utrust_47xx_F_ProductManual.pdf)
