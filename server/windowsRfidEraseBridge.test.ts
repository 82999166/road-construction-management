import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(new URL("../desktop-bridge/utrust_local_bridge.ps1", import.meta.url), "utf8");
const erase = source.slice(source.indexOf("function Invoke-InitialCardErase"), source.indexOf("$listener = New-Object"));
describe("Windows固定初卡恢复桥接流程", () => {
  it("恢复前先查四个实际安装文件，不能将缺文件交给PowerShell后才报路径", () => {
    for (const name of ["run_utrust_erase_initial.ps1", "UTrustNtag216EraseInitial.cs", "UTrustBridgeSupport.cs", "run_utrust_read_uid.ps1"])
      expect(source).toContain(`"${name}"`);
    expect(source).toContain("initialEraseReady = (Test-InitialEraseFiles)");
    expect(source).toContain('initialEraseVersion = "ntag216-initial-erase-v1"');
    expect(erase.indexOf("Test-InitialEraseFiles")).toBeLessThan(erase.indexOf('Invoke-ReaderScript "run_utrust_read_uid.ps1"'));
    expect(source).toContain('throw "reader_script_missing"');
  });
  it("来源白名单与明确确认都必须在任何实际擦卡前通过", () => {
    expect(erase).toContain("$allowedOrigins -contains $origin");
    expect(erase).toContain("erase_origin_not_allowed");
    expect(erase.indexOf("erase_confirmation_required")).toBeLessThan(erase.indexOf('Invoke-ReaderScript "run_utrust_erase_initial.ps1"'));
  });
  it("已绑定卡指纹先核对，预读指纹传入底层，旧待确认写卡收据失效", () => {
    expect(erase).toContain("expectedCardUidFingerprint -ne $fingerprint");
    expect(erase).toContain("$env:RC_RFID_EXPECTED_UID_FINGERPRINT = $fingerprint");
    expect(erase).toContain('RC_RFID_ERASE_CONFIRM = "ERASE_NTAG216_USER_AREA"');
    expect(erase.indexOf("Clear-PendingRfidConfirmation")).toBeLessThan(erase.indexOf('Invoke-ReaderScript "run_utrust_erase_initial.ps1"'));
  });
  it("任何恢复结果必须匹配版本、当前卡与回读且确认无写保护变化", () => {
    expect(erase).toContain('writerVersion -ne "ntag216-initial-erase-v1"');
    for (const flag of ["success", "erased", "verified", "initialNdef", "writeProtectionChanged"])
      expect(erase).toContain(`$eraseResult.${flag}`);
    expect(erase).toContain("$eraseResult.cardUidFingerprint -ne $fingerprint");
    expect(erase).toContain("-AllowStructuredFailure -RequireSuccessProperty");
  });
  it("finally恢复进程环境变量，恢复不调用车辆开卡或业务数据回填", () => {
    expect(erase).toContain("} finally {");
    expect(erase).toContain("$env:RC_RFID_ERASE_CONFIRM = $oldConfirm");
    expect(erase).toContain("$env:RC_RFID_EXPECTED_UID_FINGERPRINT = $oldExpectedUid");
    expect(erase).not.toContain("Invoke-RfidServer");
    expect(erase).not.toContain("RC_RFID_PAYLOAD_B64");
  });
});
