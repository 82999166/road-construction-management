# 现场大屏免费天气：配置和数据说明

## 配置在哪里

超级管理员进入「后台设置 → 现场大屏」，地址为 `/admin/settings?category=onsite`。选择对应项目，在「天气地点」填写该项目实际工地名称和经纬度，再在「天气接入」选择「MET Norway 免费模型预报（无需 API Key）」。项目天气卡可通过 `/admin/settings?category=onsite&siteTab=weather&siteProjectId=项目ID` 直达天气接入；只允许项目列表内的项目，URL 仅作首次初始化，不覆盖之后的手动选择。

经纬度必须来自实际项目定位；系统不读取浏览器或设备 GPS，也不会代填一个工地。免费方案无需注册天气密钥，不调用 Open-Meteo 免费接口。原有 `disabled` 和 `open_meteo_commercial` 配置可继续解析；全局商业密钥只在选择商业服务时显示，切换服务不会删除或重写已保存密钥。

## 必须由真人管理员完成的确认

MET Norway 官方 FAQ 明确允许免费商用，数据采用 CC BY 4.0。[1] 2026-11-05 修订的条款要求有权限的真人阅读、理解并接受，不能将接受行为委托给 AI。[2]

请管理员自行打开 [MET Norway 服务条款](https://api.met.no/doc/TermsOfService)，阅读后决定是否勾选「我是有权限的真人管理员，已阅读、理解并接受服务条款，确认所填公司联系方式真实且可联系」。新配置默认未勾选，本次实现没有接受条款、写入正式配置或启用服务。

填写真实有效公司邮箱，或无需登录且能联系技术支持的公开 HTTPS 页面。系统会检查格式并拒绝占位信息、私网地址、HTTP 和 GitHub 地址；不会抓取联系方式页面，也不能自动核实邮箱是否可收件或页面是否有真实支持人员，因此管理员须核实可联系性。请勿使用虚构邮箱、私有仓库或需要额外注册才能联系的页面。

确认和联系方式按项目保存，通过已有 CAS 配置版本校验并回读。只有「已保存配置」用于天气查询；未确认、缺少有效联系方式或未填项目坐标时，返回 `not_configured` 且不发送任何外部天气请求。可以保存未完成确认的草稿配置，保存不代表自动接受。

## 数据来源与显示边界

服务器仅请求固定 `https://api.met.no/weatherapi/locationforecast/2.0/compact`，User-Agent 标识为 `https://yx.maomaoyx.com SiteOperations/1.0` 加管理员填写的联系信息。坐标截断到最多四位小数，支持 gzip/deflate，不从浏览器直接访问 MET。[2] 当前只采用离查询时刻最近的模型预报点；若最近点距离现在超过一小时，返回 `stale`，不产生系统作业提示。

MET 时间按 UTC ISO-8601 传递，业务日期按 `Asia/Shanghai`。`current.time` 为所选预报点有效时间，`updatedAt` 为模型 `meta.updated_at`，`fetchedAt` 为服务器成功获取或验证缓存时间；三者不是传感器观测时间。

气温、湿度、风向来自瞬时时点；风速由 m/s 转为 km/h。MET `next_1_hours` 为从相应预报点开始的下一小时累计预测雨量，而不是实时雨量。[3] `current.precipitationMm` 因此为 `null`，雨量放在 `predictive.precipitationMm`，并提供起止时间；小时列表的 `precipitationMm` 同样表示该点之后一小时，不把六小时雨量换成一小时数据。

免费 compact 方案未提供或本集成未采用的能见度、阵风、降水概率、体感温度均返回 `null`，不从雾量推算能见度，不伪造 0 或晴天。`weatherDescription` 是下一小时天气符号的中文展示，未知符号保留 `null`。当天最高和最低气温仅取「北京时间当天剩余预报点」，不是完整自然日高低温，`predictive.dailyBasis` 明确为 `remaining_forecast_points`。

署名通过可选 `attribution` 传递，提供 MET Norway 和 CC BY 4.0 链接，说明风速单位换算、中文描述和系统提示等派生处理。风雨、高低温提示共用项目已有阈值，`workHints.source` 为 `system_work_hint`，不是气象部门官方预警，不自动认定停工；`officialAlerts.status` 始终为 `not_connected`。网络、HTTP、数据异常返回 `unavailable` 和空实时数据，不伪装成正常天气。

## 缓存与流量控制

官方 Locationforecast 2026 年更新说明规定，北欧以外相同请求至少间隔三小时。[4] 本实现为所有项目使用保守的三小时最低间隔，并在 `Expires` 较晚时继续遵守该时间。同 URL 不因换项目、改阈值、配置版本变化或商业密钥变化而提前重复下载；缓存原始模型，每次读取按当前时刻重新选取预报并应用该项目最新阈值。

保留合法 `Last-Modified` 原文用于后续 `If-Modified-Since`；304 复用缓存正文，首次缺少正文的 304 安全失败。支持并发去重，失败逐次退避，429 同时遵守秒数或 HTTP 日期格式的 `Retry-After`，并暂停此进程所有 MET 坐标请求。最多保留 250 项 LRU；只驱逐已过允许请求时间的项，容量全为未过期项时拒绝新项而不是清空造成重复下载。免费和商业 provider 的缓存与授权完全隔离。

只跟随固定 HTTPS MET 域名的有限次数重定向，不允许 HTTP、其他域名或 URL 凭据，同 URL 循环重定向只请求一次。每进程最多开始 10 个外部请求/秒，重定向请求同样计入，不排队制造重试风暴。本缓存为单服务进程内存缓存，服务重启会丢失；若部署多实例、需要更严格跨重启流量控制或接近供应商总计 20 请求/秒上限，应在实际启用前部署共享缓存与统一出口节流，不应按实例分别反复查询。[2]

## 本次验证

只读取官方文档，没有调用真实 MET 天气 API，没有启用正式配置，没有编造联系信息，没有代接受条款，也没有提交、发布或 checkpoint。自动测试全部用 mock Response 和本地 fixture，覆盖人工确认门槛、真实配置保存回读、商业密钥保留、UTC 和北京时间跨日、缺失字段、未来一小时雨量、Expires 最低间隔、条件请求和 304、跨项目缓存、并发去重、失败退避、429、重定向和有界 LRU。

## 返回契约

`SiteConfiguration.weather.provider` 新增 `met_norway`。可选 `weather.metNorway` 为 `{ termsAccepted: boolean; contact: string }`；旧配置不需要新字段。

`SiteWeather.source` 新增 `met_norway`。以下新字段均可选，旧页面和测试 fixture 无需提供：

- `attribution`: `{ name, url, sourceUrl, license, licenseUrl, modification }`，`sourceUrl` 与 `url` 是相同来源链接的兼容别名。
- `weatherDescription`: `string | null`。
- `predictive`: `{ label: "模型预报·非现场实测", precipitationPeriod: "next_1_hour", precipitationMm: number | null, periodStart: string | null, periodEnd: string | null, dailyBasis: "remaining_forecast_points" }`。

## References

[1]: https://api.met.no/doc/FAQ "MET Norway API FAQ: free commercial use and identification"
[2]: https://api.met.no/doc/TermsOfService "MET Norway Terms of Service revised 2026-11-05"
[3]: https://api.met.no/doc/locationforecast/datamodel "Locationforecast instant and period variable data model"
[4]: https://api.met.no/weatherapi/locationforecast/2.0/documentation "Locationforecast documentation: update and minimum request intervals"
