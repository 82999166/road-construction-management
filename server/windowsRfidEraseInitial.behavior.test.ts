import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(new URL("../desktop-bridge/UTrustNtag216EraseInitial.cs", import.meta.url));
const fakePath = fileURLToPath(new URL("./fixtures/UTrustNtag216EraseInitialFake.cs", import.meta.url));
const wrapper = readFileSync(new URL("../desktop-bridge/run_utrust_erase_initial.ps1", import.meta.url), "utf8");
const expectedFingerprint = createHash("sha256").update("road-rfid-card:v1:04A1B2C3D4E5F6").digest("hex");
// A Mono-equipped CI executes the actual C# logic, including raw APDU status
// checks. No PC/SC DLL, external reader, real card, or network is used by fake.
const hasMono = spawnSync("mcs", ["--version"]).status === 0 && spawnSync("mono", ["--version"]).status === 0;
const retainCrcCommand = "FFEF00000160";
const observedRawVersion = "0004040201001303B1AD";
const versionByteMutations = [
  "01040402010013030E2C", "00050402010013036432", "00040502010013039AA9", "0004040301001303F5A6",
  "00040402000013030AB1", "00040402010113036DF7", "000404020100120369B4", "000404020100130238BC",
];

type EraseResult = {
  success: boolean; erased: boolean; verified: boolean; initialNdef: boolean;
  writeProtectionChanged: boolean; cardUidFingerprint: string; writerVersion: string;
  stage: string; result: string; writeAttempted: boolean; pagesWritten: number;
  failedPage: number; ndefCapacityBytes: number; physicalUserBytes: number;
};
type HarnessResult = {
  harness: true; exitCode: number; calls: number; uidReads: number; versionReads: number;
  writes: number[]; writeData: string[]; reads: number[]; readCounts: number[];
  versionCommands: string[]; versionResponses: string[];
  protectedPagesPreserved: boolean; memory: string;
};

describe("Windows 初卡擦除包装器", () => {
  it("独立加载擦除器，保留其 JSON stdout 与退出码，不代替调用方授予擦除授权", () => {
    expect(wrapper).toContain('Join-Path $PSScriptRoot "UTrustNtag216EraseInitial.cs"');
    expect(wrapper).toContain("Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop");
    expect(wrapper).toContain("[int][UTrustNtag216EraseInitial]::Main()");
    expect(wrapper).toContain("exit $exitCode");
    expect(wrapper).toContain("ConvertTo-Json -Compress");
    expect(wrapper).toContain('"eraser_source_not_found"');
    expect(wrapper).toContain('"eraser_load_failed"');
    expect(wrapper).toContain('"eraser_invocation_failed"');
    for (const field of ["erased", "verified", "initialNdef", "writeProtectionChanged", "cardUidFingerprint", "writerVersion", "stage", "result"]) expect(wrapper).toContain(field);
    expect(wrapper).not.toContain("$env:RC_RFID_ERASE_CONFIRM =");
    expect(wrapper).not.toContain("$env:RC_RFID_EXPECTED_UID_FINGERPRINT =");
    expect(wrapper).not.toContain("UTrustNtag216RfidWrite");
  });
});

describe.skipIf(!hasMono)("NTAG216 初卡擦除真实 C# / fake APDU 行为", () => {
  let directory: string;
  let executable: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "ntag216-erase-behavior-"));
    executable = join(directory, "EraseFake.exe");
    const compiled = spawnSync("mcs", ["-main:UTrustNtag216EraseInitialFake", `-out:${executable}`, sourcePath, fakePath], { encoding: "utf8", timeout: 30_000 });
    expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0);
  });
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  function run(scenario: string) {
    const child = spawnSync("mono", [executable, scenario], { encoding: "utf8", timeout: 10_000 });
    expect(child.status, child.stderr).toBe(0);
    const lines = child.stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    const result = JSON.parse(lines[0]) as EraseResult;
    const harness = JSON.parse(lines[1]) as HarnessResult;
    expect(result.writerVersion).toBe("ntag216-initial-erase-v2");
    expect(harness.harness).toBe(true);
    // No discard-CRC mode, status fallback, retry, or extra model probe.
    expect(harness.versionReads).toBeLessThanOrEqual(1);
    expect(harness.versionCommands).toEqual(Array(harness.versionReads).fill(retainCrcCommand));
    // Every scenario inspects the actual write APDUs, not source-string patterns.
    expect(harness.writes.every(page => page >= 4 && page <= 225)).toBe(true);
    expect(harness.reads.every(page => page <= 228)).toBe(true);
    expect(harness.reads).not.toContain(229);
    expect(harness.reads).not.toContain(230);
    if (scenario !== "lock_changed") expect(harness.protectedPagesPreserved).toBe(true);
    return { result, harness };
  }
  function refused(scenario: string, code: string, beforeWrite = true) {
    const { result, harness } = run(scenario);
    expect(harness.exitCode).toBe(1);
    expect(result).toMatchObject({ success: false, erased: false, verified: false, initialNdef: false });
    expect(result.result).toBe(code);
    if (beforeWrite) {
      expect(harness.writes).toEqual([]);
      expect(result.writeAttempted).toBe(false);
    }
    return { result, harness };
  }

  it.each([
    ["missing_confirmation", "erase_confirmation_required"],
    ["wrong_confirmation", "erase_confirmation_required"],
    ["missing_uid", "expected_uid_fingerprint_invalid"],
    ["uppercase_fingerprint", "expected_uid_fingerprint_invalid"],
  ])("%s 在触碰读卡器前拒绝", (scenario, code) => {
    const { harness } = refused(scenario, code);
    expect(harness.calls).toBe(0);
  });
  it("真实 Main 缺少确认在 Linux 也直接返回结构化失败，未加载 winscard.dll", () => {
    const child = spawnSync("mono", [executable, "main_missing_confirmation"], { encoding: "utf8", timeout: 10_000 });
    expect(child.status).toBe(1);
    expect(JSON.parse(child.stdout.trim())).toMatchObject({ success: false, erased: false, result: "erase_confirmation_required", stage: "prepare", writeAttempted: false });
  });
  it("错误预读 UID 在 GET_VERSION/用户区读取和任何写入之前拒绝", () => {
    const { result, harness } = refused("wrong_uid", "card_uid_fingerprint_mismatch");
    expect(result.cardUidFingerprint).toBe(expectedFingerprint);
    expect(harness.versionReads).toBe(0);
    expect(harness.reads).toEqual([]);
  });
  it.each([
    ["ntag213", "card_type_not_ntag216"],
    ["ntag215", "card_type_not_ntag216"],
    ["unknown_version", "card_type_not_ntag216"],
    ["short_version", "get_version_response_length_invalid"],
    ["version_status_fail", "get_version_status_6982"],
    ["version_transport_fail", "apdu_transport_0x80100068"],
    ["short_uid", "ntag216_uid_invalid"],
    ["uid_status_fail", "get_uid_status_6982"],
    ["unknown_cc", "ntag216_cc_capacity_not_supported"],
    ["small_cc", "ntag216_cc_capacity_not_supported"],
    ["manufacturer_mismatch", "manufacturer_uid_mismatch"],
    ["bcc_mismatch", "manufacturer_uid_mismatch"],
  ])("%s 非严格卡能力/身份不允许擦除", (scenario, code) => { refused(scenario, code); });
  it.each([
    ["version_crc_low_bad", "get_version_crc_invalid"],
    ["version_crc_high_bad", "get_version_crc_invalid"],
    ["version_crc_low_bad_with_status", "get_version_crc_invalid"],
    ["version_crc_high_bad_with_status", "get_version_crc_invalid"],
    ["version_crc_sw_spoof", "get_version_crc_invalid"],
    ["version_no_crc", "get_version_response_length_invalid"],
    // Eight bytes + 9000 are ten bytes, but 9000 is NOT a valid CRC-A.
    ["version_no_crc_with_status", "get_version_crc_invalid"],
    ["version_crc_truncated", "get_version_response_length_invalid"],
    ["version_crc_truncated_with_status", "get_version_response_length_invalid"],
    ["short_version_with_status", "get_version_response_length_invalid"],
    ["version_null", "get_version_response_length_invalid"],
    ["version_empty", "get_version_response_length_invalid"],
    ["version_one_byte", "get_version_response_length_invalid"],
    ["version_wrong_status", "get_version_status_6982"],
    ["version_unknown_status", "get_version_status_6F00"],
    ["version_unsupported_status", "get_version_status_6A81"],
    ["version_extra_prefix", "get_version_response_length_invalid"],
    ["version_extra_suffix", "get_version_response_length_invalid"],
    ["version_extra_prefix_with_status", "get_version_response_length_invalid"],
    ["version_extra_suffix_with_status", "get_version_response_length_invalid"],
    ["version_two_extra_prefix", "get_version_status_B1AD"],
    ["version_two_extra_suffix", "get_version_status_AABB"],
    ["version_two_extra_before_status", "get_version_response_length_invalid"],
  ])("%s 型号帧错误在任何页读取/写入前闭锁，不 fallback 或剥离字节猜测", (scenario, code) => {
    const { result, harness } = refused(scenario, code);
    expect(result).toMatchObject({ stage: "identify_card", pagesWritten: 0, writeProtectionChanged: false });
    expect(harness.versionReads).toBe(1);
    expect(harness.uidReads).toBe(1);
    expect(harness.calls).toBe(2);
    expect(harness.reads).toEqual([]);
    expect(harness.writeData).toEqual([]);
    expect(harness.memory).toBe(Array.from({ length: 222 }, (_, index) => "A55AB6" + (index + 4).toString(16).padStart(2, "0").toUpperCase()).join(""));
  });
  it.each([
    ["ntag213", "0004040201000F038091"],
    ["ntag215", "0004040201001103019E"],
    ["unknown_version", "00040402010113036DF7"],
    ["ntag213_with_status", "0004040201000F0380919000"],
    ["ntag215_with_status", "0004040201001103019E9000"],
    ["unknown_version_with_status", "00040402010113036DF79000"],
    ...versionByteMutations.flatMap((response, index) => [
      [`version_byte_${index}`, response], [`version_byte_${index}_with_status`, response + "9000"],
    ]),
  ])("%s 完整 CRC 正确仍必须逐字节精确 NTAG216，CC 不能替代型号", (scenario, response) => {
    const { result, harness } = refused(scenario, "card_type_not_ntag216");
    expect(harness.versionResponses).toEqual([response]);
    expect(harness.versionCommands).toEqual([retainCrcCommand]);
    expect(harness.calls).toBe(2);
    expect(harness.reads).toEqual([]);
    expect(harness.writeData).toEqual([]);
    expect(result).toMatchObject({ stage: "identify_card", pagesWritten: 0, writeProtectionChanged: false });
  });
  it.each([
    ["cc_write_protected", "card_write_protected_cc"],
    ["cc_read_protected", "card_write_protected_cc"],
    ["static_lock", "card_write_protected_static_lock"],
    ["static_block_lock", "card_write_protected_static_lock"],
    ["dynamic_lock", "card_write_protected_dynamic_lock"],
    ["dynamic_block_lock", "card_write_protected_dynamic_lock"],
    ["unknown_dynamic_profile", "ntag216_dynamic_lock_profile_unknown"],
    ["password_protected", "card_write_protected_configuration"],
    ["config_only_password", "card_write_protected_configuration"],
    ["config_locked", "card_write_protected_configuration"],
    ["read_protected", "card_write_protected_configuration"],
    ["mirror", "card_ascii_mirror_enabled"],
    ["protection_read_fail", "read_page_226_status_6982"],
  ])("%s 只读探测后闭锁，不解锁、不写保护页", (scenario, code) => { refused(scenario, code); });
  it.each([
    ["tail_read_fail", "read_page_225_status_6982"],
    ["short_page", "read_page_224_length_invalid"],
    ["uid_changed_prewrite", "card_uid_changed"],
  ])("%s 完整物理区预检失败，不写第一页", (scenario, code) => { refused(scenario, code); });
  it("裸型号回包兼容绝不放宽 GET UID 的 9000 检查", () => {
    const { harness } = refused("uid_without_status", "get_uid_status_E5F6");
    expect(harness.versionReads).toBe(0);
    expect(harness.reads).toEqual([]);
  });
  it("裸型号回包兼容绝不放宽通用 ReadBinary 的 9000 检查", () => {
    const { harness } = refused("page_without_status", "read_page_224_status_B6E0");
    expect(harness.reads).toContain(224);
    expect(harness.writes).toEqual([]);
  });
  it.each([
    ["first_write_fail", "write_page_4_status_6982", [4]],
    ["write_fail", "write_page_6_status_6982", [4, 5, 6]],
    ["write_transport_fail", "apdu_transport_0x80100069", [4, 5, 6]],
    ["unexpected_write_response", "write_page_4_response_length_invalid", [4]],
  ] as const)("%s 立即中止，不重试不提交初卡", (scenario, code, writes) => {
    const { result, harness } = refused(scenario, code, false);
    expect(result.writeAttempted).toBe(true);
    expect(harness.writes).toEqual(writes);
    expect(harness.writeData).not.toContain("0300FE00");
  });
  it("裸型号回包兼容绝不接受无 9000 的通用 WriteBinary，写后立即中止且不回滚保护页", () => {
    const { result, harness } = refused("write_without_status", "write_page_4_response_length_invalid", false);
    expect(result).toMatchObject({ writeAttempted: true, pagesWritten: 0 });
    expect(harness.writes).toEqual([4]);
    expect(harness.writeData).toEqual(["00000000"]);
    expect(harness.writeData).not.toContain("0300FE00");
  });
  it.each([
    ["tail_write_fail", "write_page_225_status_6982"],
    ["tail_not_zero", "post_write_byte_mismatch_page_225"],
    ["zero_scan_tail_dirty", "post_write_byte_mismatch_page_225"],
    ["uid_changed_before_commit", "card_uid_changed"],
  ])("%s 最后物理页/提交前扫描拒绝（不是只校验872字节）", (scenario, code) => {
    const { harness } = refused(scenario, code, false);
    expect(harness.writes).toHaveLength(222);
    expect(harness.writeData).not.toContain("0300FE00");
  });
  it("写入后 UID 变化立即拒绝，不擦后续页", () => {
    const { harness } = refused("uid_changed_after_first_write", "card_uid_changed", false);
    expect(harness.writes).toEqual([4]);
  });
  it("中途换卡拒绝，停止第51次写入", () => {
    const { harness } = refused("uid_changed_mid_erase", "card_uid_changed", false);
    expect(harness.writes).toHaveLength(50);
    expect(harness.writeData).not.toContain("0300FE00");
  });
  it("提交后 UID 变化也不能宣称擦除验证成功", () => {
    const { harness } = refused("uid_changed_final", "card_uid_changed", false);
    expect(harness.writes).toHaveLength(223);
  });
  it("最终完整回读发现公称CC容量以外的最后页非空，返回失败", () => {
    const { result, harness } = refused("final_tail_dirty", "post_write_byte_mismatch_page_225", false);
    expect(result.stage).toBe("verify_initial_user_area");
    expect(harness.writes).toHaveLength(223);
    expect(harness.memory.endsWith("7B")).toBe(true);
  });
  it("外部改变动态锁位只报告失败/保护变化，绝不尝试恢复锁位", () => {
    const { result, harness } = refused("lock_changed", "read_only_page_changed_226", false);
    expect(result.writeProtectionChanged).toBe(true);
    expect(harness.protectedPagesPreserved).toBe(false);
    expect(harness.writes).not.toContain(226);
  });
  it.each([
    ["success", observedRawVersion],
    ["version_with_status", observedRawVersion + "9000"],
  ])("%s 成功必须清理和回读全部888物理字节，最终03 00 FE + 零尾，保护字节完全保持", (scenario, response) => {
    const { result, harness } = run(scenario);
    expect(result).toMatchObject({ success: true, erased: true, verified: true, initialNdef: true, writeProtectionChanged: false,
      cardUidFingerprint: expectedFingerprint, stage: "complete", result: "initial_card_restored", ndefCapacityBytes: 872, physicalUserBytes: 888, pagesWritten: 223 });
    expect(harness.exitCode).toBe(0);
    expect(harness.versionCommands).toEqual([retainCrcCommand]);
    expect(harness.versionResponses).toEqual([response]);
    const userPages = Array.from({ length: 222 }, (_, index) => index + 4);
    expect(harness.writes).toEqual([...userPages, 4]);
    expect(harness.writeData.slice(0, 222).every(data => data === "00000000")).toBe(true);
    expect(harness.writeData[222]).toBe("0300FE00");
    expect(harness.memory).toBe("0300FE" + "00".repeat(885));
    // preflight + immediate write verification + zero scan + final full scan.
    for (const page of userPages) expect(harness.readCounts[page]).toBeGreaterThanOrEqual(4);
    for (const page of [222, 223, 224, 225]) expect(harness.readCounts[page]).toBeGreaterThanOrEqual(4);
    expect(harness.uidReads).toBeGreaterThan(harness.writes.length);
    expect(harness.protectedPagesPreserved).toBe(true);
  });
});
