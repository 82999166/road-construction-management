# 阿里云 OSS 接入点与 Node.js SDK 兼容性记录

日期：2026-08-27

## 结论

当前照片上传服务使用 `ali-oss` Node.js SDK。阿里云 OSS 官方“通过接入点访问 OSS”说明明确表示：接入点别名目前仅由 Java SDK 与 Python SDK 支持；Node.js SDK 未列为支持 SDK。因此，系统设置中的 Node.js OSS 照片存储不能将接入点外网 Endpoint 或接入点别名作为常规 Bucket Endpoint 使用。

应改为填写 Bucket 所在地域的标准公网 Endpoint，并填写关联 Bucket 名称。RAM 用户仍可通过最小对象读写权限访问该 Bucket；接入点策略可保留给兼容 SDK 或其他访问路径。

## 对当前故障的影响

移动端柴油小票上传失败很可能与“接入点 Endpoint + Node.js SDK”的不兼容有关。后续增加的 OSS 连接测试应明确提示：若检测到 `oss-accesspoint.aliyuncs.com` 域名，要求管理员改用标准 Bucket 公网 Endpoint，再进行只读权限验证。

## 来源

- [阿里云：通过接入点访问 OSS](https://help.aliyun.com/zh/oss/user-guide/access-point/)
- [阿里云：OSS Node.js SDK](https://help.aliyun.com/zh/oss/developer-reference/nodejs-sdk/)
- [阿里云：Node.js SDK 使用自定义域名](https://help.aliyun.com/en/oss/developer-reference/use-custom-domain-names)
