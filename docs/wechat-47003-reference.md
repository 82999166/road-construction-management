# 微信服务号 47003 参数格式错误记录

## 官方依据

微信服务号“发送模板消息”接口文档明确说明：`47003` 表示参数格式错误；`data` 中每个字段必须遵循模板审核时确定的关键词类型与长度限制。官方文档还说明，`thing.DATA` 通常不超过 20 个字符，`character_string.DATA` 不超过 32 个字符，时间字段需采用受支持的日期/时间格式，接口会在错误消息中指出具体字段。

参考：<https://developers.weixin.qq.com/doc/service/api/notify/template/api_sendtemplatemessage>

## 本项目修复

服务号投递层现在会读取已发布的模块模板映射，而不是只读取旧版通用模板配置；发送前会移除控制字符，并按字段名对 `thing`、`const`、`character_string`、`time`、`phone_number` 和 `car_number` 做长度与格式规范化。对于模块模板不存在的业务域，系统继续记录 `template_not_bound`，不会伪造已发送状态。

2026-08-16 对用户 510307 的真实 transport 模板验收已返回 `delivered=true`，数据库记录通道为 `official_account`、状态为 `sent`，并获得微信 `providerMessageId`；此前同一链路依次暴露了 `disabled`（未读取模块模板）和 `47003`（字段格式错误）。
