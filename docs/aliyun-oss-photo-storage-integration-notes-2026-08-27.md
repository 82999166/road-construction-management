# 阿里云 OSS 照片存储集成依据

## 目的

为施工现场照片、柴油表数照片等业务影像增加可选的阿里云 OSS 服务端存储目标，同时保留当前存储路径作为默认回退。配置页面不得展示或持久化 AccessKey Secret；上传、读取和对象键生成仍必须通过服务端权限与项目范围校验。

## 官方约束

阿里云 OSS Node.js SDK 应使用 RAM 用户的最小权限 AccessKey，并通过部署环境变量注入凭据。初始化时应使用对应 Bucket 的地域、Endpoint、Bucket 名称，并启用 V4 签名和 HTTPS。

默认私有 Bucket 中对象不可公开读取；受控预览应由服务端在完成业务权限校验后生成短期 GET 预签名 URL。文档说明 V4 GET 预签名 URL 的有效期上限为 7 天；本系统将采用更短的受控有效期，且不在数据库、前端状态或审计摘要中持久化带签名 URL。

## 配置模型

页面仅保存非敏感运行配置：启用状态、地域、Endpoint、Bucket、对象前缀和私有读策略。AccessKey ID 与 AccessKey Secret 应通过 `ALIYUN_OSS_ACCESS_KEY_ID` 与 `ALIYUN_OSS_ACCESS_KEY_SECRET` 部署环境变量注入；缺少任一凭据或运行配置校验失败时，系统继续使用既有存储路径，而不丢弃现场照片。

## 来源

1. [初始化（Node.js SDK）](https://help.aliyun.com/zh/oss/initialization-10)
2. [上传文件（Node.js SDK）](https://help.aliyun.com/zh/oss/developer-reference/upload-objects-13)
3. [使用预签名 URL 下载（Node.js SDK）](https://help.aliyun.com/zh/oss/developer-reference/download-objects-using-a-presigned-url-generated-with-oss-sdk-for-node-js)
