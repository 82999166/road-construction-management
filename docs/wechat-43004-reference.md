# 微信服务号关注状态核验说明

2026-08-16 检索微信开发者文档与腾讯云资料：模板消息投递中的 `43004` 通常表示收件人未关注公众号，但该投递错误本身不应作为系统绑定状态的唯一事实来源。系统改为在收到该错误后调用微信用户信息接口读取明确的 `subscribe` 值；只有 `subscribe = 0` 才更新为未关注，接口或网络异常保持原绑定状态。

参考：

- 微信模板消息接口说明：https://developers.weixin.qq.com/doc/service/guide/product/template_message/Template_Message_Interface.html
- 微信订阅通知发送说明：https://developers.weixin.qq.com/doc/service/api/notify/notify/api_sendnewsubscribemsg.html
- 腾讯云实战说明：https://cloud.tencent.com/developer/article/2587901
