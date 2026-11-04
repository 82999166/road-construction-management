import React from "react";
import { Button } from "@/components/ui/button";
import {
  RFID_FIRST_INSTALL_PACKAGE_URL,
  REQUIRED_RFID_BRIDGE_BUILD_ID,
  REQUIRED_RFID_BRIDGE_VERSION,
  type RfidBridgeReadiness,
} from "@/lib/rfidBridgeReadiness";

export default function RfidBridgeReadinessPanel({
  result,
  checking,
  disabled = false,
  onCheck,
}: {
  result: RfidBridgeReadiness | null;
  checking: boolean;
  disabled?: boolean;
  onCheck: () => void;
}) {
  return (
    <section
      aria-label="正式写卡桥接版本诊断"
      aria-live="polite"
      className={`min-w-0 rounded-xl border p-3 text-xs leading-5 ${result?.status === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : result ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-700"}`}
    >
      <p className="text-sm font-semibold">本机写卡版本检查</p>
      <p className="mt-1">
        {checking
          ? "正在只读检测本机桥接版本…"
          : result?.reason ||
            "写卡前会自动检查版本。读到卡号或测试写卡成功，不代表正式车辆卡接口版本已匹配。"}
      </p>
      <dl className="mt-2 grid min-w-0 gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt>系统要求</dt>
        <dd className="break-all font-mono">
          {REQUIRED_RFID_BRIDGE_VERSION} · {REQUIRED_RFID_BRIDGE_BUILD_ID}
        </dd>
        {result ? (
          <>
            <dt>本机返回</dt>
            <dd className="break-all font-mono">
              {result.bridgeVersion || "未返回版本"} ·{" "}
              {result.bridgeBuildId || "未返回构建标识"}
            </dd>
          </>
        ) : null}
      </dl>
      {result && result.status !== "ready" ? (
        <p className="mt-2">
          下载后先完整解压，双击 <strong>Install-Yuexin-RFID-Bridge.cmd</strong>
          （旧包可能显示“安装写卡桥接.cmd”），允许安装程序更新并重启桥接，完成后回到这里重新检测。安装包版本为
          v16，内部桥接版本为 v13，两个编号含义不同。
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCheck}
          disabled={disabled || checking}
        >
          {checking ? "检测中…" : "重新检测版本（不写卡）"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || checking}
          onClick={() =>
            window.open(
              RFID_FIRST_INSTALL_PACKAGE_URL,
              "_blank",
              "noopener,noreferrer"
            )
          }
        >
          下载最新版安装包
        </Button>
      </div>
      {result?.status !== "ready" ? (
        <p className="mt-2">
          如果本次已执行过写入但结果不确定，请保持卡片不动，先核查或只读复核；不要用“写入测试卡”覆盖正式卡。
        </p>
      ) : null}
    </section>
  );
}
