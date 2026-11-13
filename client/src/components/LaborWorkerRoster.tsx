import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import BusinessStatusBadge from "./BusinessStatusBadge";

export type LaborWorkerRosterRow = {
  id: number;
  realName: string;
  teamName: string | null;
  identityVerificationStatus: "pending" | "verified" | "rejected";
  attendanceStatus: "pending" | "active" | "left";
  entryDate: Date | string | null;
  exitDate: Date | string | null;
};

function identityLabel(
  status: LaborWorkerRosterRow["identityVerificationStatus"]
) {
  return status === "verified"
    ? "已核验"
    : status === "rejected"
      ? "已驳回"
      : "待核验";
}

/** 劳务实名制人员的人员目录；档案详情与新建窗口均由父级受控承载。 */
export default function LaborWorkerRoster({
  workers,
  displayDate,
  onOpenProfile,
  onCreateWorker,
}: {
  workers: LaborWorkerRosterRow[];
  displayDate: (value: Date | string) => string;
  onOpenProfile: (worker: LaborWorkerRosterRow) => void;
  onCreateWorker?: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">劳务人员台账</CardTitle>
          <CardDescription>
            展示实名核验与进退场状态；显示完整身份和资金资料。
          </CardDescription>
        </div>
        {onCreateWorker ? (
          <Button size="sm" onClick={onCreateWorker}>
            新建施工队工人
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {workers.length ? (
          workers.map(worker => (
            <div
              key={worker.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-800">
                    {worker.realName}
                  </p>
                  <BusinessStatusBadge status={worker.attendanceStatus} />
                  <Badge variant="outline">
                    实名：{identityLabel(worker.identityVerificationStatus)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  班组：{worker.teamName || "未设置"} · 入场：
                  {worker.entryDate
                    ? displayDate(worker.entryDate)
                    : "未登记"}{" "}
                  · 退场：{worker.exitDate ? displayDate(worker.exitDate) : "—"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenProfile(worker)}
              >
                查看档案
              </Button>
            </div>
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
            当前项目尚无真实劳务人员档案。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
