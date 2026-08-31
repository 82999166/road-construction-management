# uTrust 4701 F 官方资料取证摘要

本文件只保存外部公开资料中与本系统读写排查直接相关的事实，供后续根因分析引用；不包含服务器地址、账号、令牌、卡片明文或现场设备标识。

| 主题 | 官方资料要点 | 对当前排查的含义 |
|---|---|---|
| 设备接口 | uTrust 47xx F 的应用可通过 PC/SC 接口与驱动直接交互，产品支持接触式 ISO/IEC 7816 与 13.56 MHz 非接触式技术。 | 本机 C# 应以已枚举的 **Contactless Reader** 作为 PC/SC 卡通道；网页本身不能直接驱动设备。 |
| Windows 驱动 | 官方软件手册说明，Windows Vista 及以后通常已有 CCID 驱动；有局限时可安装官方签名专用驱动。 | 需用 PCSC 诊断工具验证实际读取器、ATR/卡型和 PC/SC 传输状态，不能只以网页“桥接已连接”为准。 |
| APDU | 官方手册提供 `PAPDU_GET_UID`、MIFARE 读写、Type 2 / MIFARE Ultralight 家族命令与状态字说明。 | 正式卡读写应记录实际 APDU 及 SW1/SW2，不可仅将任意 `90 00` 或测试字符串视作 NDEF 业务卡写入成功。 |
| 键盘仿真 | 手册列出键盘接口控制命令；并非所有 uTrust 47xx 型号均等同于键盘式读卡器。 | 若业务要求电脑刷卡后自动触发网页，应由桥接主动读取卡内容并经受控前端动作跳转；不能假设硬件会自动把 URI 输入浏览器。 |

## 官方来源

1. Hirsch, [uTrust 4701 F Dual Interface Smart Card Contact Reader/Writer](https://www.hirschsecure.com/us/en-us/products/smart-card-readers/utrust-4701-f-dual-interface-smart-card-contact-reader-writer)，产品页提供官方产品与软件手册入口。
2. Hirsch, [Reference Manual for uTrust 4701F Dual Interface Reader/Writer](https://go.hirschsecure.com/hubfs/LACS/manual/utrust_47xx_F_ProductManual.pdf)，文档版本 1.2，2017-09-26。
3. Hirsch, [uTrust Type F Software Reference Manual](https://go.hirschsecure.com/hubfs/LACS/manual/uTrust-Type-F-Software-Reference-Manual.pdf)，涵盖 PC/SC、CCID、通用 APDU、接触式与非接触式命令。
