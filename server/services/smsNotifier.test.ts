import { describe, expect, it } from "vitest";
import {
  buildTestTemplateParams,
  createAliyunSmsClient,
  evaluateAliyunTemplateVariableContract,
  extractAliyunLegacyDollarVariables,
  extractAliyunTemplateVariables,
  extractSafeAliyunSmsErrorCode,
  getSmsEventModule,
  normalizeSmsEventTemplates,
  selectSmsEventTemplate,
} from "./smsNotifier";

describe("业务事件短信模板配置", () => {
  it("仅保留受支持事件、去除重复项，并允许先保存未填写编码的待审核条目", () => {
    const templates = normalizeSmsEventTemplates([
      {
        eventCode: "transport_load_completed",
        templateCode: "",
        enabled: false,
      },
      {
        eventCode: "transport_load_completed",
        templateCode: "SMS_DUPLICATE",
        enabled: true,
      },
      {
        eventCode: "diesel_refuel_completed",
        templateCode: "SMS_DIESEL",
        enabled: true,
      },
      { eventCode: "unknown", templateCode: "SMS_UNKNOWN", enabled: true },
    ]);
    expect(templates).toEqual([
      {
        eventCode: "transport_load_completed",
        templateCode: "",
        enabled: false,
      },
      {
        eventCode: "diesel_refuel_completed",
        templateCode: "SMS_DIESEL",
        enabled: true,
      },
    ]);
  });

  it("只选择已启用且已填写编码的当前事件模板，绝不把柴油模板错用于运输", () => {
    const templates = normalizeSmsEventTemplates([
      {
        eventCode: "transport_load_completed",
        templateCode: "SMS_LOAD",
        enabled: true,
      },
      {
        eventCode: "transport_unload_completed",
        templateCode: "",
        enabled: true,
      },
      {
        eventCode: "diesel_refuel_completed",
        templateCode: "SMS_DIESEL",
        enabled: true,
      },
    ]);
    expect(
      selectSmsEventTemplate(templates, "transport_load_completed")
        ?.templateCode
    ).toBe("SMS_LOAD");
    expect(
      selectSmsEventTemplate(templates, "transport_unload_completed")
    ).toBeNull();
    expect(
      selectSmsEventTemplate(templates, "diesel_refuel_completed")?.templateCode
    ).toBe("SMS_DIESEL");
  });

  it("测试发送和正式发送按事件固定映射到业务模块", () => {
    expect(getSmsEventModule("transport_load_completed")).toBe("transport");
    expect(getSmsEventModule("transport_unload_completed")).toBe("transport");
    expect(getSmsEventModule("transport_scan_exception")).toBe("transport");
    expect(getSmsEventModule("diesel_refuel_completed")).toBe("diesel");
    expect(getSmsEventModule("machine_refuel_completed")).toBe("machinery");
    expect(getSmsEventModule("vehicle_expense_recorded")).toBe("transport");
    expect(getSmsEventModule("machine_expense_recorded")).toBe("machinery");
  });

  it("运输装土和卸土测试样例包含车辆当日阶段车次，供审核后的模板显示第几车", () => {
    expect(buildTestTemplateParams("transport_load_completed")).toMatchObject({
      vehicle: "湘A12345",
      place: "测试运输现场",
      tripOrdinal: "1",
    });
    expect(buildTestTemplateParams("transport_unload_completed")).toMatchObject(
      { vehicle: "湘A12345", place: "测试运输现场", tripOrdinal: "1" }
    );
  });

  it("车辆和机械费用测试样例包含费用类别、金额和北京时间", () => {
    expect(buildTestTemplateParams("vehicle_expense_recorded")).toMatchObject({
      vehicle: "湘A12345",
      category: "维修保养",
      amount: "100.00",
    });
    expect(buildTestTemplateParams("machine_expense_recorded")).toMatchObject({
      vehicle: "挖机001",
      category: "维修保养",
      amount: "100.00",
    });
    expect(buildTestTemplateParams("machine_refuel_completed")).toMatchObject({
      vehicle: "挖机001",
      quantity: "100",
      amount: "100.00",
    });
  });

  it("仅将阿里云 ${name} 识别为可替换变量，并明确识别不会替换的旧式 $name$ 写法", () => {
    const content =
      "【湖南悦信建筑】车辆 ${vehicle} 本次刷卡未完成，请联系现场管理员处理，时间 ${time}。";
    expect(extractAliyunTemplateVariables(content)).toEqual([
      "time",
      "vehicle",
    ]);
    expect(
      extractAliyunLegacyDollarVariables(
        "车辆 $vehicle$ 本次刷卡未完成，时间 $time$。"
      )
    ).toEqual(["time", "vehicle"]);
    expect(
      extractAliyunTemplateVariables("车辆 $vehicle$，时间 $time$。")
    ).toEqual([]);
  });

  it("允许模板按需选用车牌和时间，并阻止旧式或系统无法提供的变量", () => {
    expect(
      evaluateAliyunTemplateVariableContract(
        "transport_scan_exception",
        "车辆 ${vehicle} 本次刷卡未完成，时间 ${time}。"
      )
    ).toMatchObject({
      verified: true,
      variables: ["time", "vehicle"],
      unsupportedVariables: [],
      legacyDollarVariables: [],
    });
    expect(
      evaluateAliyunTemplateVariableContract(
        "transport_load_completed",
        "车辆 ${vehicle} 装土完成。"
      )
    ).toMatchObject({
      verified: true,
      unusedEventVariables: ["place", "time", "tripOrdinal"],
    });
    expect(
      evaluateAliyunTemplateVariableContract(
        "transport_scan_exception",
        "车辆 $vehicle$ 本次刷卡未完成，时间 $time$。"
      )
    ).toMatchObject({
      verified: false,
      legacyDollarVariables: ["time", "vehicle"],
    });
    expect(
      evaluateAliyunTemplateVariableContract(
        "transport_scan_exception",
        "车辆 ${vehicle}，地点 ${place}。"
      )
    ).toMatchObject({ verified: false, unsupportedVariables: ["place"] });
  });

  it("仅保留阿里云 SDK 的短错误码，不回显异常消息或敏感请求字段", () => {
    expect(extractSafeAliyunSmsErrorCode({ code: "Forbidden.RAM" })).toBe(
      "Forbidden.RAM"
    );
    expect(
      extractSafeAliyunSmsErrorCode({
        data: { code: "InvalidAccessKeyId.NotFound" },
      })
    ).toBe("InvalidAccessKeyId.NotFound");
    expect(
      extractSafeAliyunSmsErrorCode({ code: "包含手机号 13800138000" })
    ).toBe("SDK_REQUEST_FAILED");
    expect(
      extractSafeAliyunSmsErrorCode(new Error("request contains secret"))
    ).toBe("Error");
  });

  it("在生产 CommonJS 兼容路径中能构造短信客户端，不会因默认导出对象触发 TypeError", () => {
    const client = createAliyunSmsClient(
      "local-test-access-key",
      "local-test-access-secret"
    );
    expect(typeof client.sendSms).toBe("function");
  });
});
