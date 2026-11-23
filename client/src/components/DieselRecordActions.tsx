import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import {
  dieselCorrectionLockReason,
  type DieselCorrectionRecord,
} from "@/lib/dieselRecordCorrection";
import { formatChinaDateTime } from "@/lib/businessTime";
import { formatAmount, formatQuantity } from "@shared/numberFormat";
import { toast } from "sonner";

export function DieselRecordActions({
  record,
  onEdit,
  onDeleted,
  disabled = false,
}: {
  record: DieselCorrectionRecord;
  onEdit: () => void;
  onDeleted: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const busy = useRef(false);
  const [deleted, setDeleted] = useState(false);
  const deletion = trpc.admin.diesel.deleteRefuelRecord.useMutation();
  const reason = dieselCorrectionLockReason(record);
  const locked = Boolean(reason) || disabled || deleted || deletion.isPending;

  async function remove() {
    if (locked || busy.current) return;
    const confirmed = window.confirm(
      `确认删除这笔柴油登记？\n单号：${record.recordNo}\n资源：${record.assetName ?? "未关联资源"}\n加油时间：${formatChinaDateTime(record.refueledAt)}\n油量：${formatQuantity(record.liters)} L\n金额：¥${formatAmount(record.amount, false)}\n\n删除后不再计入有效汇总，关联机械油料成本同步失效；原始凭证和操作记录保留在后台。已结算记录不能删除。`
    );
    if (!confirmed) return;
    busy.current = true;
    try {
      await deletion.mutateAsync({
        id: record.id,
        projectId: record.projectId,
        expectedUpdatedAt: new Date(record.updatedAt).toISOString(),
      });
      setDeleted(true);
      toast.success("柴油记录已删除，原始凭证与操作记录已保留");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "删除未完成，请刷新后重试"));
      busy.current = false;
      return;
    }
    try {
      await onDeleted();
    } catch {
      toast.warning("删除已完成，台账刷新失败，请手动刷新页面");
    } finally {
      busy.current = false;
    }
  }

  return (
    <div className="flex max-w-56 flex-wrap items-center justify-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={locked}
        onClick={() => {
          if (!locked && !busy.current) onEdit();
        }}
      >
        修改
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={locked}
        onClick={() => void remove()}
      >
        {deletion.isPending ? "删除中…" : "删除"}
      </Button>
      {reason || deleted ? (
        <p className="w-full whitespace-normal break-words text-right text-[11px] leading-4 text-slate-500">
          {deleted ? "已删除，原始记录保留" : reason}
        </p>
      ) : null}
    </div>
  );
}
