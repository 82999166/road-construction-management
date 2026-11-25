import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTakeoffPrintHtml,
  printTakeoffDetail,
  type TakeoffDetail,
  type TakeoffMeasurementRow,
} from "./measurementTakeoffPrint";

const row = (index = 1): TakeoffMeasurementRow => ({
  item: `第${index}项原始测量`, location: `K${index}+012 至 K${index}+030`,
  length: 1.234, width: 2.345, height: null, count: 0, quantity: 0,
  calculation: `原始计算式${index}：按断面记录，不执行表达式`, remarks: `完整备注${index}`,
});
const photo = (id: number): TakeoffDetail["evidences"][number] => ({
  evidenceId: id, fileName: `原图文件-${id}.png`, mimeType: "image/png",
  url: `https://preview.example/controlled/photo-${id}?signature=authorized&expires=123`,
  capturedAt: "2026-11-25T07:30:00+08:00", description: `原始水印现场图说明${id}`,
});
const detail = (): TakeoffDetail => ({
  record: {
    id: 41, projectId: 9, takeoffNo: "SF-20261125-0101", workItem: "桥台背填工程",
    workLocation: "K10+100 左幅台背", unit: "m3", quantity: "12.345", unitPrice: "2.00",
    declaredAmount: "24.70", takeoffDate: "2026-11-25", status: "draft",
    submittedBy: 12, reviewedBy: null, reviewedAt: null, reviewNote: null,
    createdAt: new Date("2026-11-25T00:00:00Z"), updatedAt: "2026-11-25T00:00:00Z",
    workDescription: "第一段完整说明\n第二段-END", measurementBasis: "按合同、原始测量记录复核-END",
    measurementRows: [row()], version: "server-strong-version",
  },
  project: { id: 9, name: "道路改建项目" }, submittedByName: "录入甲", reviewedByName: "复核乙",
  evidences: [photo(1)],
});

let frame: any;
let win: any;
let doc: any;
const decodedPhoto = (decode = vi.fn().mockResolvedValue(undefined)) => ({
  complete: true, naturalWidth: 1200, naturalHeight: 800, decode,
});
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers();
  doc = { open: vi.fn(), write: vi.fn(), close: vi.fn(), images: [], body: { dataset: {} } };
  win = { document: doc, addEventListener: vi.fn(), focus: vi.fn(), print: vi.fn() };
  frame = {
    contentWindow: win, style: {}, isConnected: true, setAttribute: vi.fn(),
    remove: vi.fn(() => { frame.isConnected = false; }),
  };
  vi.stubGlobal("document", { createElement: vi.fn(() => frame), body: { appendChild: vi.fn() } });
  vi.stubGlobal("window", { setTimeout, location: { origin: "https://road.example" } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("收方独立A4完整输出", () => {
  it("固定表题、真实统一号、位置、人员、状态及服务端金额，不自行重算", () => {
    const data = detail();
    data.record.declaredAmount = "999.99"; // 故意与数量×单价不同，打印须保留服务端值。
    const html = buildTakeoffPrintHtml(data);
    for (const value of ["项目部工程量收方记录表", "道路改建项目", "SF-20261125-0101", "2026-11-25", "桥台背填工程", "K10+100 左幅台背", "录入甲", "复核乙", "12.345", "2.00", "999.99", "m³"]) expect(html).toContain(value);
    expect(html).toContain("服务端申报金额（元）");
    expect(html).not.toContain("24.69");
    expect(data.record.quantity).toBe("12.345");
  });
  it("草稿醒目注明未经复核，不冒充结算依据、电子签名或国家法定表式", () => {
    const html = buildTakeoffPrintHtml(detail());
    expect(html).toContain('<p class="takeoff-status">草稿·未经复核</p>');
    expect(html).toContain("草稿未经复核，不作为结算或付款依据");
    expect(html).toContain("不代表手写签名或电子签章");
    expect(html).toContain("不声称国家统一法定表式");
    for (const role of ["测量人", "复核人", "项目负责人", "监理或业主代表"]) expect(html).toContain(`<th scope="row" style="width:22%">${role}</th>`);
    expect(html.match(/签字：________________________/g)).toHaveLength(4);
    expect(html.match(/日期：______年____月____日/g)).toHaveLength(4);
    expect(html).not.toContain("签字：录入甲");
    expect(html).not.toContain("签字：复核乙");
  });
  it.each([
    ["submitted", "已提交·待复核"], ["reviewing", "复核中·尚未完成复核"],
    ["approved", "已审核"], ["rejected", "已退回·未经复核"],
    ["locked", "已锁定"], ["void", "已作废"],
  ])("准确显示%s状态，不伪造复核结论", (status, label) => {
    const data = detail(); data.record.status = status;
    const html = buildTakeoffPrintHtml(data);
    expect(html).toContain(`<p class="takeoff-status">${label}</p>`);
    expect(html).not.toContain("已签认");
    if (status === "void") expect(html).toContain("已作废记录，不作为结算或付款依据");
  });
  it("所有100行、长正文、依据、长单行计算和备注原文完整，无截取", () => {
    const data = detail();
    data.record.workDescription = "详细段落\n".repeat(1900) + "说明末尾-10000-END";
    data.record.measurementBasis = "计量依据".repeat(495) + "依据末尾-2000-END";
    data.record.measurementRows = Array.from({ length: 100 }, (_, index) => ({
      ...row(index + 1), calculation: "原式".repeat(160) + `计算末尾-${index + 1}-END`,
      remarks: "长备注\n".repeat(95) + `备注末尾-${index + 1}-END`,
    }));
    const html = buildTakeoffPrintHtml(data);
    expect(html).toContain(data.record.workDescription);
    expect(html).toContain(data.record.measurementBasis);
    expect(html.match(/data-measurement-row="\d+"/g)).toHaveLength(100);
    for (let index = 1; index <= 100; index++) {
      expect(html).toContain(`计算末尾-${index}-END`);
      expect(html).toContain(`备注末尾-${index}-END`);
    }
    expect(html).toContain("1.234"); expect(html).toContain("2.345"); expect(html).toContain("<td>0</td>");
    expect(html).not.toMatch(/ellipsis|line-clamp|overflow:\s*hidden|text-overflow/);
  });
  it("超过契约100行明确拒绝而非截掉第101行", () => {
    const data = detail(); data.record.measurementRows = Array.from({ length: 101 }, (_, i) => row(i));
    expect(() => buildTakeoffPrintHtml(data)).toThrow("最多100行");
  });
  it("null历史字段与明确清空区别显示，无伪造补填", () => {
    const historical = detail();
    historical.record.workDescription = null; historical.record.measurementBasis = null; historical.record.measurementRows = null;
    historical.record.takeoffDate = null; historical.submittedByName = null; historical.reviewedByName = null;
    historical.evidences = [];
    const html = buildTakeoffPrintHtml(historical);
    expect(html.match(/历史未填写/g)!.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain("未归档照片"); expect(html).not.toContain("<img");
    historical.record.workDescription = ""; historical.record.measurementBasis = ""; historical.record.measurementRows = [];
    const cleared = buildTakeoffPrintHtml(historical);
    expect(cleared).toContain('<div class="takeoff-prose">未填写</div>');
    expect(cleared).toContain("未填写测量明细");
  });
  it("Date及string日期均支持，字符串保留时区与完整历史日期文本", () => {
    const data = detail(); data.record.takeoffDate = new Date("2026-11-25T00:00:00Z");
    data.evidences[0].capturedAt = new Date("2026-11-25T01:02:03Z");
    let html = buildTakeoffPrintHtml(data);
    expect(html).toContain("2026-11-25"); expect(html).toContain("2026-11-25 01:02:03.000 UTC");
    data.record.takeoffDate = "2026-11-25（历史原文完整-END）";
    data.evidences[0].capturedAt = "2026-11-25T07:30:00+08:00";
    html = buildTakeoffPrintHtml(data);
    expect(html).toContain(data.record.takeoffDate); expect(html).toContain(data.evidences[0].capturedAt);
  });
  it("184mm页内上限、12mm边距、thead重复、长行自然分页，无整个section防分页", () => {
    const html = buildTakeoffPrintHtml(detail());
    expect(html).toContain("size: A4 portrait; margin: 12mm");
    expect(html).toContain("max-width: 184mm");
    expect(html).toContain("display: table-header-group !important");
    expect(html).toContain("tr { break-inside: auto !important; page-break-inside: auto !important; }");
    expect(html).toContain(".takeoff-print section, .takeoff-print figure, .takeoff-print figcaption, .takeoff-print .takeoff-prose { break-inside: auto");
    expect(html).not.toMatch(/(?:section|figure|figcaption)\s*\{[^}]*break-inside:\s*avoid/);
  });
  it("全部照片依载荷原序每组最多两张，文件名、日期及很长说明完整", () => {
    const data = detail(); data.evidences = [photo(9), photo(2), photo(7), photo(1), photo(20)];
    data.evidences[2].description = "照片图注\n".repeat(1200) + "图注末尾-END";
    data.evidences[2].fileName = "超长原始文件名".repeat(60) + "文件名末尾.png";
    const html = buildTakeoffPrintHtml(data);
    expect(html.match(/<img /g)).toHaveLength(5);
    expect(html.match(/data-attachment-group=/g)).toHaveLength(3);
    const groups = html.split('<section class="takeoff-evidence-page"').filter(part => part.includes("data-attachment-group="));
    expect(groups.map(group => (group.match(/<img /g) ?? []).length)).toEqual([2, 2, 1]);
    const ids = Array.from(html.matchAll(/data-photo-id="(\d+)"/g)).map(match => Number(match[1]));
    expect(ids).toEqual([9, 2, 7, 1, 20]);
    expect(html).toContain(data.evidences[2].description); expect(html).toContain(data.evidences[2].fileName);
    expect(html).toContain("照片 5 / 5"); expect(html).toContain("object-fit: contain"); expect(html).toContain("height: 95mm");
    expect(html).toContain("break-before: page"); expect(html).toContain("图内水印保留原样");
  });
  it("不限制历史真实照片总数或静默漏图，新上传上限并非历史照片截断线", () => {
    const data = detail(); data.evidences = Array.from({ length: 23 }, (_, index) => photo(index + 1));
    const html = buildTakeoffPrintHtml(data);
    expect(html.match(/<img /g)).toHaveLength(23);
    expect(html.match(/data-attachment-group=/g)).toHaveLength(12);
    expect(html).toContain("照片 23 / 23");
  });
  it("业务文本和src属性严格转义，不展开key、OCR、电话、银行或电子签名属性", () => {
    const data = detail(); const attack = '<script>alert("x")</script>&\'\n完整尾部';
    data.project.name = attack; data.record.workItem = attack; data.record.workLocation = attack;
    data.record.workDescription = attack; data.record.measurementBasis = attack;
    data.submittedByName = attack; data.reviewedByName = attack;
    data.record.measurementRows = [{ ...row(), item: attack, calculation: attack, remarks: attack }];
    data.evidences = [{ ...photo(1), fileName: attack, description: attack,
      url: 'https://preview.example/image?signature=a&quote="onerror=evil',
      fileKey: "PRIVATE_KEY", ocrText: "PRIVATE_OCR", bankAccount: "PRIVATE_BANK", phone: "PRIVATE_PHONE", signatureUrl: "PRIVATE_SIGNATURE",
    } as TakeoffDetail["evidences"][number]];
    Object.assign(data.record, { fileKey: "PRIVATE_RECORD_KEY", ocrResult: "PRIVATE_RECORD_OCR" });
    const html = buildTakeoffPrintHtml(data);
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;");
    expect(html).toContain('&amp;quote=&quot;onerror=evil');
    expect(html).not.toContain("<script>"); expect(html).not.toContain(' onerror="'); expect(html).not.toContain("PRIVATE_");
    expect(html).toContain('loading="eager"'); expect(html).toContain('referrerpolicy="no-referrer"');
  });
  it.each([
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,NOT-BASE64",
    "data:image/jpeg;base64,AAAA", "file:///private/photo.png", "blob:https://preview.example/id",
    "//preview.example/photo.png", "https://user:password@preview.example/photo.png",
    "https://preview.example/\nphoto.png", "", "<img src=x onerror=alert(1)>",
    "/private/photo.png", "/api/other/preview/token", "/api/measurement-takeoff/preview/../private",
  ])("非法预览地址拒绝整次输出而非跳图：%s", url => {
    const data = detail(); data.evidences[0].url = url;
    expect(() => buildTakeoffPrintHtml(data)).toThrow("未生成缺图打印");
  });
  it.each(["https", "http"])("受控%s预览URL保留，签名与amp正确转义", protocol => {
    const data = detail(); data.evidences[0].url = `${protocol}://preview.example/image?signature=a&expires=2`;
    expect(buildTakeoffPrintHtml(data)).toContain(`src="${protocol}://preview.example/image?signature=a&amp;expires=2"`);
  });
  it("兼容后端固定受控令牌路径，仅解析为当前源站HTTPS，不允许任意相对路径", () => {
    const data = detail(); data.evidences[0].url = "/api/measurement-takeoff/preview/secure_token-123";
    expect(buildTakeoffPrintHtml(data)).toContain('src="https://road.example/api/measurement-takeoff/preview/secure_token-123"');
  });
  it("受控路径没有可验证HTTP源站时明确拒绝，不拼造来源", () => {
    const data = detail(); data.evidences[0].url = "/api/measurement-takeoff/preview/secure_token-123";
    vi.stubGlobal("window", { setTimeout, location: { origin: "null" } });
    expect(() => buildTakeoffPrintHtml(data)).toThrow();
  });
  it.each(["png", "jpeg"])("只接受格式匹配的data:image/%s;base64", format => {
    const data = detail(); data.evidences[0].mimeType = `image/${format}`;
    data.evidences[0].url = `data:image/${format};base64,AAAA`;
    expect(buildTakeoffPrintHtml(data)).toContain(`src="data:image/${format};base64,AAAA"`);
  });
  it("不支持图片MIME或缺失清单不能冒充无照片", () => {
    const data = detail(); data.evidences[0].mimeType = "text/html";
    expect(() => buildTakeoffPrintHtml(data)).toThrow("未生成缺图打印");
    data.evidences = undefined as unknown as TakeoffDetail["evidences"];
    expect(() => buildTakeoffPrintHtml(data)).toThrow("归档照片清单缺失");
  });
});

describe("收方异步打印复用真实a4Print严格解码", () => {
  it("portrait/12mm/实际A4预布局/无自动打印脚本，返回Promise等到print调用", async () => {
    doc.images = [decodedPhoto()];
    const pending = printTakeoffDetail(detail());
    expect(pending).toBeInstanceOf(Promise);
    expect(win.print).not.toHaveBeenCalled();
    const html = doc.write.mock.calls[0][0];
    expect(html).toContain("@page { size:A4 portrait; margin:12mm; }");
    expect(html).not.toContain("<script>");
    expect(frame.style.cssText).toContain("width:794px;height:1123px");
    await vi.advanceTimersByTimeAsync(180); await pending;
    expect(doc.images[0].decode).toHaveBeenCalledOnce(); expect(win.print).toHaveBeenCalledOnce();
  });
  it("每一张全部decode，最后一张慢图未就绪之前不打印", async () => {
    const slow = deferred(); doc.images = [decodedPhoto(), decodedPhoto(), decodedPhoto(vi.fn(() => slow.promise))];
    const data = detail(); data.evidences = [photo(1), photo(2), photo(3)];
    const pending = printTakeoffDetail(data);
    await vi.advanceTimersByTimeAsync(1000); expect(win.print).not.toHaveBeenCalled();
    slow.resolve(); await vi.advanceTimersByTimeAsync(180); await pending;
    expect(doc.images.every((image: any) => image.decode.mock.calls.length === 1)).toBe(true);
    expect(win.print).toHaveBeenCalledOnce();
  });
  it.each(["网络失败", "签名过期", "损坏图像"])("%s失败明确退回UI，重试成功，不静默缺图", async reason => {
    doc.images = [decodedPhoto(vi.fn().mockRejectedValue(new Error(reason)))];
    await expect(printTakeoffDetail(detail())).rejects.toThrow("请重新点击打印重试");
    expect(win.print).not.toHaveBeenCalled(); expect(frame.remove).toHaveBeenCalledOnce();
    frame.isConnected = true; doc.images = [decodedPhoto()];
    const retried = printTakeoffDetail(detail()); await vi.advanceTimersByTimeAsync(180); await retried;
    expect(win.print).toHaveBeenCalledOnce();
  });
  it("非法URL在创建打印文档前拒绝，错误Promise交给UI", async () => {
    const data = detail(); data.evidences[0].url = "javascript:alert(1)";
    await expect(printTakeoffDetail(data)).rejects.toThrow("未生成缺图打印");
    expect(doc.write).not.toHaveBeenCalled(); expect(win.print).not.toHaveBeenCalled();
  });
  it("过期上下文立即取消，不创建iframe", async () => {
    await expect(printTakeoffDetail(detail(), () => false)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(doc.write).not.toHaveBeenCalled(); expect(win.print).not.toHaveBeenCalled();
  });
  it("等待图像期间切换或关闭取消，迟到decode不复活打印", async () => {
    let current = true; const slow = deferred(); doc.images = [decodedPhoto(vi.fn(() => slow.promise))];
    const pending = printTakeoffDetail(detail(), () => current);
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    current = false; await vi.advanceTimersByTimeAsync(100); await rejected;
    slow.resolve(); await vi.advanceTimersByTimeAsync(200);
    expect(frame.remove).toHaveBeenCalledOnce(); expect(win.print).not.toHaveBeenCalled();
  });
  it("全部图像decode后最后布局期取消仍不打印", async () => {
    let current = true; doc.images = [decodedPhoto()];
    const pending = printTakeoffDetail(detail(), () => current);
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.advanceTimersByTimeAsync(50); current = false;
    await vi.advanceTimersByTimeAsync(150); await rejected; expect(win.print).not.toHaveBeenCalled();
  });
  it("超过60秒失败清理，未解码的照片不成为空白打印", async () => {
    doc.images = [decodedPhoto(vi.fn(() => deferred().promise))];
    const pending = printTakeoffDetail(detail()); const rejected = expect(pending).rejects.toThrow("超过60秒");
    await vi.advanceTimersByTimeAsync(60_000); await rejected;
    expect(win.print).not.toHaveBeenCalled(); expect(frame.remove).toHaveBeenCalledOnce();
  });
  it("无照片也走严格路径，并明确打印未归档照片", async () => {
    const data = detail(); data.evidences = [];
    const pending = printTakeoffDetail(data);
    expect(doc.write.mock.calls[0][0]).toContain("未归档照片");
    await vi.advanceTimersByTimeAsync(180); await pending; expect(win.print).toHaveBeenCalledOnce();
  });
});

// 外部静态 fixture 仅按显式环境变量输出，不写产品页面、不使用真实项目或隐私资料。
// 如父任务提供 fixture 照片 data URLs，可用于观察横/竖图与图内水印的 contain 效果。
const fixtureDir = process.env.TAKEOFF_PRINT_FIXTURE_DIR;
it("可选输出外部静态长正文、100行及三张附件版式fixture", () => {
  if (!fixtureDir) return;
  mkdirSync(fixtureDir, { recursive: true });
  const data = detail();
  data.project.name = "打印版式专项测试项目（合成测试数据，非业务记录）";
  data.record.workDescription = Array.from({ length: 100 }, (_, i) => `说明第${i + 1}段：原始资料正文必须完整续页；这是静态版式测试，不是正式收方资料。`).join("\n") + "\n说明末尾-END";
  data.record.measurementBasis = Array.from({ length: 25 }, (_, i) => `依据第${i + 1}条：按完整原始记录核对，禁止裁切及伪造计算依据。`).join("\n") + "\n依据末尾-END";
  data.record.measurementRows = Array.from({ length: 100 }, (_, i) => ({ ...row(i + 1), remarks: `第${i + 1}行完整备注。`.repeat(16) + `备注末尾-${i + 1}-END` }));
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2l9sAAAAASUVORK5CYII=";
  const supplied = process.env.TAKEOFF_PRINT_FIXTURE_IMAGE_URLS;
  const urls: string[] = supplied ? JSON.parse(supplied) : [png, png, png];
  data.evidences = urls.map((url, i) => ({ ...photo(i + 1), url, description: `合成测试图${i + 1}，仅验证打印分页；非真实归档照片。` + "完整图注原文 ".repeat(i === 1 ? 300 : 5) + `图注末尾-${i + 1}-END` }));
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>收方A4静态版式fixture</title></head><body class="a4-print-document">${buildTakeoffPrintHtml(data)}</body></html>`;
  writeFileSync(join(fixtureDir, "takeoff-long-100rows-3photos.html"), html, "utf8");
  const empty = detail(); empty.evidences = []; empty.record.workDescription = null; empty.record.measurementBasis = null; empty.record.measurementRows = null;
  writeFileSync(join(fixtureDir, "takeoff-historical-no-photos.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>收方历史空字段fixture</title></head><body class="a4-print-document">${buildTakeoffPrintHtml(empty)}</body></html>`, "utf8");
  const compact = detail();
  compact.project.name = "普通三图版式测试项目（合成测试数据）";
  compact.evidences = urls.map((url, i) => ({ ...photo(i + 1), url, description: `合成测试图${i + 1}，不是业务归档照片；检查四角及边缘测试水印完整显示。` }));
  writeFileSync(join(fixtureDir, "takeoff-compact-3photos.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>收方普通三图fixture</title></head><body class="a4-print-document">${buildTakeoffPrintHtml(compact)}</body></html>`, "utf8");
});
