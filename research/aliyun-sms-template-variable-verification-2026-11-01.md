# 阿里云短信模板变量核验

- 阿里云通知短信模板变量必须使用 `${变量名}` 格式；变量名可自定义，但必须与 API `TemplateParam` JSON 的键完全一致。`$vehicle$`、`$time$` 属于普通文本，不会替换。
- 已审核通过的模板不能直接改正文；如要变更变量格式或变量名，必须新建/克隆模板，审核后取得新的 TemplateCode，再更新业务系统配置。
- GetSmsTemplate 可按 TemplateCode 返回 TemplateContent、TemplateStatus、TemplateType 和 VariableAttribute。系统应只向超级管理员展示变量名及校验结果，不回显密钥或收件人。

Sources:

1. https://help.aliyun.com/zh/sms/user-guide/notification-template-specifications
2. https://help.aliyun.com/zh/sms/user-guide/create-message-templates-1
3. https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-getsmstemplate
