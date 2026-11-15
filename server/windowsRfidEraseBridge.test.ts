import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(new URL("../desktop-bridge/utrust_local_bridge.ps1", import.meta.url), "utf8");
const erase = source.slice(source.indexOf("function Invoke-InitialCardErase"), source.indexOf("$listener = New-Object"));
const failure = source.slice(source.indexOf("function Get-InitialEraseFailureCode"), source.indexOf("function Invoke-InitialCardErase"));
// Interpret only the literal -eq/-match classification rules under test, preserving source order.
const rules = [...failure.matchAll(/if \(\$Reason -(eq|match) "([^"]+)"\) \{ return "([^"]+)" \}/g)];
const safeCodes = failure.match(/foreach \(\$code in @\(([^)]+)\)/)?.[1].match(/"([^"]+)"/g)?.map(code => code.slice(1, -1)) || [];
const classify = (reason: string) => rules.find(([, op, pattern]) => op === "eq" ? reason === pattern : new RegExp(pattern, "i").test(reason))?.[3] || (safeCodes.includes(reason) ? reason : "erase_initial_card_failed");
describe("Windows固定初卡恢复桥接流程", () => {
  it("恢复前先查四个实际安装文件，不能将缺文件交给PowerShell后才报路径", () => {
    for (const name of ["run_utrust_erase_initial.ps1", "UTrustNtag216EraseInitial.cs", "UTrustBridgeSupport.cs", "run_utrust_read_uid.ps1"])
      expect(source).toContain(`"${name}"`);
    expect(source).toContain("initialEraseReady = (Test-InitialEraseFiles)");
    expect(source).toContain('initialEraseVersion = "ntag216-initial-erase-v2"');
    expect(erase.indexOf("Test-InitialEraseFiles")).toBeLessThan(erase.indexOf('Invoke-ReaderScript "run_utrust_read_uid.ps1"'));
    expect(source).toContain('throw "reader_script_missing"');
  });
  it("来源白名单与明确确认都必须在任何实际擦卡前通过", () => {
    expect(erase).toContain("$allowedOrigins -contains $origin");
    expect(erase).toContain("erase_origin_not_allowed");
    expect(erase.indexOf("erase_origin_not_allowed")).toBeLessThan(erase.indexOf("Read-BridgeBody"));
    expect(erase.indexOf("erase_confirmation_required")).toBeLessThan(erase.indexOf('Invoke-ReaderScript "run_utrust_erase_initial.ps1"'));
  });
  it("已绑定卡指纹先核对，预读指纹传入底层，旧待确认写卡收据失效", () => {
    expect(erase).toContain("expectedCardUidFingerprint -ne $fingerprint");
    expect(erase).toContain("$env:RC_RFID_EXPECTED_UID_FINGERPRINT = $fingerprint");
    expect(erase).toContain('RC_RFID_ERASE_CONFIRM = "ERASE_NTAG216_USER_AREA"');
    expect(erase.indexOf("Clear-PendingRfidConfirmation")).toBeLessThan(erase.indexOf('Invoke-ReaderScript "run_utrust_erase_initial.ps1"'));
  });
  it("任何恢复结果必须匹配版本、当前卡与回读且确认无写保护变化", () => {
    expect(erase).toContain('writerVersion -ne "ntag216-initial-erase-v2"');
    for (const flag of ["success", "erased", "verified", "initialNdef", "writeProtectionChanged"])
      expect(erase).toContain(`$eraseResult.${flag}`);
    expect(erase).toContain("$eraseResult.cardUidFingerprint -ne $fingerprint");
    expect(erase).toContain("-AllowStructuredFailure -RequireSuccessProperty");
  });
  it.each([
    ["get_version_status_6300", "erase_reader_identification_failed"],
    ["get_version_status_6A81", "erase_reader_identification_failed"],
    ["get_version_response_length_invalid", "erase_reader_identification_failed"],
    ["get_version_transmit_failed", "erase_reader_identification_failed"],
    ["get_version_crc_invalid", "erase_card_identification_crc_invalid"],
    ["card_type_not_ntag216", "erase_card_type_not_supported"],
    ["ntag216_dynamic_lock_profile_unknown", "erase_card_protection_profile_unknown"],
    ["card_write_protected_dynamic", "erase_card_write_protected"],
    ["card_uid_fingerprint_mismatch", "erase_card_uid_mismatch"],
    ["read_page_3_status_6300", "erase_card_read_failed"],
    ["write_page_4_status_6300", "erase_card_write_failed"],
    ["post_write_byte_mismatch_page_4", "erase_card_verify_failed"],
  ])("%s仅输出脱敏分类%s，第二次归一不丢失分类", (raw, expected) => {
    expect(classify(raw)).toBe(expected);
    expect(classify(classify(raw))).toBe(expected);
    expect(failure).not.toContain('return $Reason');
    expect(erase).toContain('throw (Get-InitialEraseFailureCode ([string]$eraseResult.result))');
  });
  it("finally恢复进程环境变量，恢复不调用车辆开卡或业务数据回填", () => {
    expect(erase).toContain("} finally {");
    expect(erase).toContain("$env:RC_RFID_ERASE_CONFIRM = $oldConfirm");
    expect(erase).toContain("$env:RC_RFID_EXPECTED_UID_FINGERPRINT = $oldExpectedUid");
    expect(erase).not.toContain("Invoke-RfidServer");
    expect(erase).not.toContain("RC_RFID_PAYLOAD_B64");
    expect(erase).not.toContain("bridgeToken");
  });
});
