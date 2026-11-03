import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  chinaToday,
  dateInput,
  friendlyPersonnelError,
} from "./UnifiedPersonnelDirectory.helpers";

type Policy =
  inferRouterOutputs<AppRouter>["personnel"]["detail"]["insurance"][number];
type InsuranceType =
  | "work_injury"
  | "accident"
  | "medical"
  | "employer_liability"
  | "other";
type Props = {
  personId: number;
  version: number;
  policy?: Policy;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

/** 保单元数据与保单附件各有受控入口，不因编辑金额或日期而清空历史附件。 */
export function PersonnelInsuranceEditor({
  personId,
  version,
  policy,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState({
    insuranceType: (policy?.insuranceType ?? "accident") as InsuranceType,
    providerName: policy?.providerName ?? "",
    policyReference: "",
    premiumAmount: policy?.premiumAmount ?? "",
    coverageAmount: policy?.coverageAmount ?? "",
    purchasedAt: policy ? dateInput(policy.purchasedAt) : chinaToday(),
    expiresAt: policy ? dateInput(policy.expiresAt) : "",
    status: policy?.status ?? "active",
    remarks: policy?.remarks ?? "",
  });
  const [error, setError] = useState("");
  const save = trpc.personnel.saveInsurance.useMutation({
    onSuccess: async () => {
      toast.success(policy ? "保险信息已更新，历史附件保留" : "保险台账已登记");
      await onSaved();
      onClose();
    },
    onError: e => setError(friendlyPersonnelError(e)),
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(current => ({ ...current, [key]: value }));
  const field = (label: string, children: React.ReactNode) => (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-600">
      <span>{label}</span>
      {children}
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{policy ? "修改人员保险" : "登记人员保险"}</DialogTitle>
          <DialogDescription>
            保单台账与附件均归属于当前人员。此处不创建工资、不登记实际付款，也不改写历史工资和结算。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={event => {
            event.preventDefault();
            setError("");
            if (!form.expiresAt || form.expiresAt < form.purchasedAt)
              return setError("到期日期不能早于购买日期。");
            save.mutate({
              personId,
              version,
              id: policy?.id,
              insuranceType: form.insuranceType,
              providerName: form.providerName.trim() || null,
              ...(form.policyReference.trim()
                ? { policyReference: form.policyReference.trim() }
                : {}),
              premiumAmount:
                form.premiumAmount === "" ? null : Number(form.premiumAmount),
              coverageAmount:
                form.coverageAmount === "" ? null : Number(form.coverageAmount),
              purchasedAt: form.purchasedAt,
              expiresAt: form.expiresAt,
              status: form.status,
              remarks: form.remarks.trim() || null,
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {field(
              "保险险种",
              <select
                className="h-9 rounded-md border bg-white px-2 text-xs"
                value={form.insuranceType}
                onChange={e =>
                  set("insuranceType", e.target.value as InsuranceType)
                }
              >
                <option value="accident">意外险</option>
                <option value="work_injury">工伤保险</option>
                <option value="employer_liability">雇主责任险</option>
                <option value="medical">医疗保险</option>
                <option value="other">其他保险</option>
              </select>
            )}
            {field(
              "保险公司",
              <Input
                className="h-9"
                maxLength={160}
                value={form.providerName}
                onChange={e => set("providerName", e.target.value)}
              />
            )}
            {field(
              "保单号（可替换，留空保留原值）",
              <Input
                className="h-9"
                type="password"
                autoComplete="off"
                maxLength={255}
                value={form.policyReference}
                onChange={e => set("policyReference", e.target.value)}
              />
            )}
            {field(
              "保单状态",
              <select
                className="h-9 rounded-md border bg-white px-2 text-xs"
                value={form.status}
                onChange={e =>
                  set("status", e.target.value as typeof form.status)
                }
              >
                <option value="active">有效</option>
                <option value="expired">已过期</option>
                <option value="cancelled">已取消</option>
              </select>
            )}
            {field(
              "保费（元）",
              <Input
                className="h-9"
                type="number"
                min="0"
                step="0.01"
                value={form.premiumAmount}
                onChange={e => set("premiumAmount", e.target.value)}
              />
            )}
            {field(
              "保额（元）",
              <Input
                className="h-9"
                type="number"
                min="0"
                step="0.01"
                value={form.coverageAmount}
                onChange={e => set("coverageAmount", e.target.value)}
              />
            )}
            {field(
              "购买日期",
              <Input
                className="h-9"
                type="date"
                required
                value={form.purchasedAt}
                onChange={e => set("purchasedAt", e.target.value)}
              />
            )}
            {field(
              "到期日期",
              <Input
                className="h-9"
                type="date"
                min={form.purchasedAt}
                required
                value={form.expiresAt}
                onChange={e => set("expiresAt", e.target.value)}
              />
            )}
          </div>
          {field(
            "备注",
            <Input
              maxLength={500}
              value={form.remarks}
              onChange={e => set("remarks", e.target.value)}
            />
          )}
          <p className="rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
            保单附件可在本人员“证照保险”上传、预览。这里修改保费、保额和日期不会清空已关联的历史附件；保单号不回显。
          </p>
          {error ? (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={save.isPending}
              onClick={onClose}
            >
              取消
            </Button>
            <Button size="sm" disabled={save.isPending}>
              {save.isPending ? "正在保存…" : "保存保险信息"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
