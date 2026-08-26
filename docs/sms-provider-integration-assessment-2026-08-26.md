# 阿里云与腾讯云短信内置通道评估

悦信云智管计划在站内通知之外提供阿里云短信与腾讯云短信的可选补充通道。两类短信均必须通过服务端调用，使用已审核通过的签名与模板；密钥不得进入浏览器、日志或聊天记录。

| 服务商 | 服务端发送接口 | 后台需配置的非敏感字段 | 加密托管字段 | 发送前置 |
|---|---|---|---|---|
| 阿里云短信 | `Dysmsapi/2017-05-25` 的 `SendSms` | 签名名称、模板 Code、模块模板参数顺序 | AccessKey ID、AccessKey Secret | 企业资质、签名审核与实名报备、模板审核通过。 |
| 腾讯云短信 | `sms.tencentcloudapi.com` 的 `SendSms`（`2021-01-11`） | `SmsSdkAppId`、签名内容、模板 ID、模块模板参数顺序 | SecretId、SecretKey | 已审核签名和模板；模板参数个数必须匹配；号码使用 E.164 格式。 |

系统设计应按业务模块配置短信开关、签名和模板编号，同时保持站内通知为基础通道。短信失败、模板未审核、频率限制、号码格式错误或服务商返回拒绝均不得回滚采购、运输、柴油、计量、财务等主业务；应以受控失败码写入通知审计。

阿里云官方建议使用最小权限 RAM 用户及官方 SDK；腾讯云官方要求 `SendSms` 使用已审核签名与模板，且支持服务端状态回执。系统将在用户提供真实服务商凭据前仅保存配置框架与禁用状态，不伪造连通性或投递结果。

## 参考资料

[1]: https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-overview "阿里云短信 API 概览"
[2]: https://help.aliyun.com/zh/sms/getting-started/use-sms-api "阿里云：通过 API 发送短信"
[3]: https://cloud.tencent.com/document/product/382/55981 "腾讯云：发送短信"
[4]: https://cloud.tencent.com/document/api/382/52077 "腾讯云短信 API 概览"
