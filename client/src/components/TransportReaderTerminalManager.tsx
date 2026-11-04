import {
  discardTransportDraft,
  useTransportDirty,
  type TransportDirtyChange,
} from "@/lib/transportDraft";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import { toast } from "sonner";
type Draft = {
  id?: number;
  siteId: string;
  deviceCode: string;
  displayName: string;
  status: "active" | "disabled" | "maintenance";
  remarks: string;
};
export function TransportReaderTerminalManager({
  projectId,
  active = true,
  canManage = true,
  onDirtyChange,
}: {
  projectId: number;
  active?: boolean;
  canManage?: boolean;
  onDirtyChange?: TransportDirtyChange;
}) {
  const devices = trpc.transport.listReaderDevices.useQuery(
    { projectId },
    { enabled: Boolean(projectId) && active }
  );
  const sites = trpc.transport.listSites.useQuery(
    { projectId },
    { enabled: Boolean(projectId) && active }
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  useTransportDirty(Boolean(draft), onDirtyChange);
  const closeDraft = () =>
    discardTransportDraft(Boolean(draft), () => setDraft(null));
  const pagination = useFinancePagination(devices.data ?? [], projectId);
  const save = trpc.transport.saveReaderDevice.useMutation({
    onSuccess: async () => {
      toast.success("场站读卡终端已保存");
      setDraft(null);
      await devices.refetch();
    },
    onError: error =>
      toast.error(getUserFacingErrorMessage(error, "终端保存失败")),
  });
  const patch = (value: Partial<Draft>) =>
    setDraft(current => (current ? { ...current, ...value } : current));
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">装卸土场站读卡终端</CardTitle>
        <Button
          size="sm"
          disabled={!canManage}
          onClick={() =>
            setDraft({
              siteId: "",
              deviceCode: "",
              displayName: "",
              status: "active",
              remarks: "",
            })
          }
        >
          登记读卡终端
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">
          设备绑定已有场站，装卸方向由服务端地点类型决定；车辆与RFID卡继续使用唯一车辆档案和原写卡功能。
        </p>
        {devices.isError || sites.isError ? (
          <p role="alert">场站终端读取失败，请重试。</p>
        ) : devices.isLoading ? (
          <p>正在读取终端…</p>
        ) : (
          pagination.pageRows.map(row => (
            <div
              key={row.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {row.displayName} · {row.deviceCode}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {row.siteType === "load" ? "装土" : "卸土"}场站 ·{" "}
                  {row.siteName} ·{" "}
                  {row.status === "active"
                    ? "启用"
                    : row.status === "disabled"
                      ? "停用"
                      : "维护"}
                </p>
                <p className="mt-1 break-words text-xs">
                  {row.remarks || "无备注"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!canManage}
                onClick={() =>
                  setDraft({
                    ...row,
                    siteId: String(row.siteId),
                    remarks: row.remarks ?? "",
                  })
                }
              >
                编辑终端
              </Button>
            </div>
          ))
        )}
        {!devices.isLoading && !devices.data?.length ? (
          <p className="text-sm text-slate-500">尚未登记场站读卡终端。</p>
        ) : null}
        <FinancePagination
          label="场站终端"
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      </CardContent>
      <Dialog
        open={Boolean(draft)}
        onOpenChange={open => {
          if (!open) closeDraft();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? "编辑场站读卡终端" : "登记场站读卡终端"}
            </DialogTitle>
            <DialogDescription>
              沿用现有终端协议与幂等刷卡事件，不创建第二套发票流程。
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-3">
              <div>
                <Label>绑定场站</Label>
                <select
                  className="mt-1 min-h-10 w-full rounded border bg-background px-2"
                  aria-label="绑定场站"
                  value={draft.siteId}
                  onChange={event => patch({ siteId: event.target.value })}
                >
                  <option value="">选择已有场站</option>
                  {(sites.data ?? []).map(site => (
                    <option key={site.id} value={site.id}>
                      {site.siteType === "load" ? "装土" : "卸土"} · {site.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>设备编号</Label>
                <Input
                  value={draft.deviceCode}
                  onChange={event => patch({ deviceCode: event.target.value })}
                />
              </div>
              <div>
                <Label>终端名称</Label>
                <Input
                  value={draft.displayName}
                  onChange={event => patch({ displayName: event.target.value })}
                />
              </div>
              <div>
                <Label>设备状态</Label>
                <select
                  aria-label="设备状态"
                  className="mt-1 min-h-10 w-full rounded border bg-background px-2"
                  value={draft.status}
                  onChange={event =>
                    patch({ status: event.target.value as Draft["status"] })
                  }
                >
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                  <option value="maintenance">维护</option>
                </select>
              </div>
              <div>
                <Label>备注</Label>
                <Input
                  value={draft.remarks}
                  onChange={event => patch({ remarks: event.target.value })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeDraft}>
              取消
            </Button>
            <Button
              disabled={
                !active ||
                !canManage ||
                !draft?.siteId ||
                (draft?.deviceCode.trim().length ?? 0) < 2 ||
                (draft?.displayName.trim().length ?? 0) < 2 ||
                save.isPending
              }
              onClick={() => {
                if (draft)
                  save.mutate({
                    ...draft,
                    projectId,
                    siteId: Number(draft.siteId),
                    remarks: draft.remarks.trim() || null,
                  });
              }}
            >
              保存终端
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
