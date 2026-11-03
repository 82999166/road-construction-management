import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";

type ResourcePerson = { id: number; name: string; userId: number | null };
type Props = {
  projectId?: number;
  role: "driver" | "operator";
  value?: number | null;
  fallbackLabel?: string | null;
  onChange: (person: ResourcePerson | null) => void;
};

/** 业务选人不读取薪资、证件、银行卡或手机号，也不创建账号或授予权限。 */
export function PersonnelResourceSelect({
  projectId,
  role,
  value,
  fallbackLabel,
  onChange,
}: Props) {
  const input = useMemo(
    () => ({ projectId: projectId ?? 0, role }),
    [projectId, role]
  );
  const query = trpc.personnel.selectOptions.useQuery(input, {
    enabled: Boolean(projectId),
    retry: false,
  });
  const rows = query.data ?? [];
  const retained = value && !rows.some(person => person.id === value);
  return (
    <div className="min-w-0 space-y-1.5">
      <Select
        value={value ? String(value) : "unassigned"}
        disabled={!projectId || query.isLoading || query.isError}
        onValueChange={id => {
          if (id === "unassigned") onChange(null);
          else {
            const person = rows.find(row => row.id === Number(id));
            if (person)
              onChange({
                id: person.id,
                name: person.name,
                userId: person.userId,
              });
          }
        }}
      >
        <SelectTrigger className="w-full min-w-0 bg-white">
          <SelectValue
            placeholder={
              role === "driver"
                ? "从统一人员档案选择驾驶员"
                : "从统一人员档案选择操作员"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">暂不关联人员档案</SelectItem>
          {retained ? (
            <SelectItem value={String(value)} disabled>
              {fallbackLabel || "原关联人员"}（当前不可选）
            </SelectItem>
          ) : null}
          {rows.map(person => (
            <SelectItem key={person.id} value={String(person.id)}>
              {person.name} · {person.positionName || "岗位未设置"} ·{" "}
              {person.personNo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {query.isError ? (
        <div role="alert" className="text-xs text-red-700">
          {getUserFacingErrorMessage(query.error, "人员列表暂时无法加载")}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-1 h-6 px-2"
            onClick={() => void query.refetch()}
          >
            重试
          </Button>
        </div>
      ) : null}
      {!projectId ? (
        <p className="text-xs text-slate-500">请先选择项目。</p>
      ) : !query.isLoading && !query.isError && !rows.length ? (
        <p className="text-xs text-slate-500">
          暂无符合岗位的人员，请先在劳务工资的“人员档案”录入并分配本项目。
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          关联人员档案不等于开通账号或分配管理权限；薪资仍在人员详情维护。
        </p>
      )}
    </div>
  );
}
