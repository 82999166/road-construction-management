# Android Chrome 访问核验记录

核验时间：2026-08-20（GMT+8）

已通过正式域名访问：`https://yx.maomaoyx.com/mobile/transport`。页面正常返回 HTTPS 应用内容；在未建立会话的浏览器中，短暂加载权限后显示“请使用企业统一身份进入已授权项目的运输调度数据”，并提供“前往登录页”。

该结果表明正式域名、TLS 与移动端路由可达。手机端若无法进入运输页，应先通过正式地址登录已获项目与运输权限的账号；如出现证书、网络错误、白屏或登录后无项目，应保留具体提示用于继续排查。

进一步在 Chromium 环境访问根地址后，系统正常进入独立登录页 `https://yx.maomaoyx.com/login?returnTo=%2Fadmin`，手机号登录表单与微信授权入口均正常渲染。页面为安全 HTTPS 上下文；未检测到已注册 Service Worker 或 Cache Storage 条目，因此项目端不存在由 Service Worker 持久控制旧版本资源的迹象。

## Android Chrome 现场恢复顺序

| 顺序 | 操作 | 目的 |
| --- | --- | --- |
| 1 | 使用 Chrome 无痕标签页直接访问 `https://yx.maomaoyx.com/login`。 | 无痕会话关闭后会删除临时 Cookie 与站点数据，可快速区分本地旧会话问题。[1] |
| 2 | 若无痕可访问，在普通 Chrome 访问域名后点地址栏左侧“网页信息”→“Cookie 和网站数据”→删除该站点数据。 | 仅清理本系统的 Cookie/站点数据，不影响其他网站；重新登录即可。[2] |
| 3 | 若仍无法打开，进入 Chrome“更多”→“设置”→“安全检查”，完成 Chrome 更新和安全项检查。 | 官方安全检查会提示可用 Chrome 更新与站点权限等问题。[3] |
| 4 | 若出现“证书”“网络”“无法连接”或白屏，保留完整提示截图并同时测试 Wi‑Fi 与移动数据。 | 当前站点根路径、登录页与移动运输路由均实测返回 HTTPS 200、`no-cache, no-store, must-revalidate` 与 HSTS；此类现象需要结合终端或网络错误信息定位。 |

## 参考资料

[1]: https://support.google.com/chrome/answer/95464?hl=zh-Hans&co=GENIE.Platform%3DAndroid "在 Android Chrome 中使用无痕模式"
[2]: https://support.google.com/chrome/answer/95647?hl=zh-Hans&co=GENIE.Platform%3DAndroid "在 Chrome 中删除、允许和管理 Cookie - Android"
[3]: https://support.google.com/chrome/answer/10468685?hl=zh-Hans&co=GENIE.Platform%3DAndroid "管理 Chrome 的安全性 - Android"

手机 NFC 直接写卡/读卡仅作为 Android Chrome 优先能力；不具备 Web NFC 能力的浏览器仍可正常使用非 NFC 业务，并以车牌直拍方式录入运输票据。
