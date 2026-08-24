import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type LaborCheckInLedgerRow = {
  id: number;
  userId: number;
  userName: string | null;
  projectId: number;
  projectName?: string | null;
  businessDate: Date | string;
  checkedInAt: Date | string;
  checkedOutAt: Date | string | null;
  deviceLabel: string | null;
  checkInAddress: string | null;
  status: "normal" | "location_missing";
  checkoutAddress: string | null;
  checkoutStatus: "normal" | "location_missing" | null;
};

type LaborCheckInLedgerProps = {
  checkIns: LaborCheckInLedgerRow[];
  businessDate: string;
  onBusinessDateChange: (value: string) => void;
  fallbackBusinessDate: string;
  displayDate: (value: Date | string) => string;
  formatAttendanceLocation: (address: string | null | undefined, status: "normal" | "location_missing" | null | undefined) => string;
  onExportCsv: (filename: string, headers: string[], rows: string[][]) => void;
};

function getLocationReviewText(item: LaborCheckInLedgerRow) {
  return `${item.status === "normal" ? "上班定位正常" : "上班缺少定位"}${item.checkoutStatus ? ` · ${item.checkoutStatus === "normal" ? "下班定位正常" : "下班缺少定位"}` : ""}`;
}

/**
 * 登录人员上下班打卡核验台账。
 * 仅展示服务端返回的中文详细地址；坐标与精度不在业务页面透出。
 */
export default function LaborCheckInLedger({ checkIns, businessDate, onBusinessDateChange, fallbackBusinessDate, displayDate, formatAttendanceLocation, onExportCsv }: LaborCheckInLedgerProps) {
  const exportRows = checkIns.map(item => [
    item.userName || `用户 #${item.userId}`,
    item.projectName || `项目 #${item.projectId}`,
    displayDate(item.businessDate),
    displayDate(item.checkedInAt),
    item.checkedOutAt ? displayDate(item.checkedOutAt) : "未打卡",
    formatAttendanceLocation(item.checkInAddress, item.status),
    item.checkedOutAt ? formatAttendanceLocation(item.checkoutAddress, item.checkoutStatus) : "未打卡",
    getLocationReviewText(item),
    item.deviceLabel || "未记录",
  ]);

  return <Card className="border-[#d8e3e0]">
    <CardHeader className="flex flex-wrap items-end justify-between gap-3 space-y-0">
      <div>
        <CardTitle className="text-base">全员上下班考勤台账</CardTitle>
        <CardDescription>管理员、操作员等登录人员的上班/下班打卡统一在此核验；施工队工人无账号时继续由劳资人员在下方考勤工时台账录入。业务台账只显示中文详细地址，原始坐标须走争议核验留痕流程。</CardDescription>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="考勤日期" className="w-[160px]" type="date" value={businessDate} onChange={event => onBusinessDateChange(event.target.value)} />
        <Button size="sm" variant="outline" disabled={!checkIns.length} onClick={() => onExportCsv(`上下班考勤-${businessDate || fallbackBusinessDate}.csv`, ["人员", "项目", "日期", "上班时间", "下班时间", "上班打卡位置（中文地址）", "下班打卡位置（中文地址）", "定位复核", "设备"], exportRows)}>导出 CSV</Button>
      </div>
    </CardHeader>
    <CardContent>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>人员</TableHead>
              <TableHead>项目</TableHead>
              <TableHead>考勤日期</TableHead>
              <TableHead>上班打卡</TableHead>
              <TableHead>下班打卡</TableHead>
              <TableHead>上班位置（中文地址）</TableHead>
              <TableHead>下班位置（中文地址）</TableHead>
              <TableHead>定位复核</TableHead>
              <TableHead>设备</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checkIns.length ? checkIns.map(item => <TableRow key={item.id}>
              <TableCell className="font-medium">{item.userName || `用户 #${item.userId}`}</TableCell>
              <TableCell>{item.projectName || `项目 #${item.projectId}`}</TableCell>
              <TableCell>{displayDate(item.businessDate)}</TableCell>
              <TableCell>{displayDate(item.checkedInAt)}</TableCell>
              <TableCell>{item.checkedOutAt ? displayDate(item.checkedOutAt) : <span className="text-amber-700">待下班打卡</span>}</TableCell>
              <TableCell className="min-w-[168px] text-xs text-slate-600">{formatAttendanceLocation(item.checkInAddress, item.status)}</TableCell>
              <TableCell className="min-w-[168px] text-xs text-slate-600">{item.checkedOutAt ? formatAttendanceLocation(item.checkoutAddress, item.checkoutStatus) : <span className="text-amber-700">待下班打卡</span>}</TableCell>
              <TableCell><span className={item.status === "normal" && (!item.checkoutStatus || item.checkoutStatus === "normal") ? "text-emerald-700" : "text-amber-700"}>{getLocationReviewText(item)}</span></TableCell>
              <TableCell className="text-xs text-slate-500">{item.deviceLabel || "未记录"}</TableCell>
            </TableRow>) : <TableRow><TableCell colSpan={9} className="h-24 text-center text-sm text-slate-500">所选日期及已授权项目范围内暂无登录人员上下班打卡记录。</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </CardContent>
  </Card>;
}
