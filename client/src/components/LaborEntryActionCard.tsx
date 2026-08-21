import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** 仅负责劳务档案录入入口；档案表单、项目范围和权限校验继续由父页面处理。 */
export default function LaborEntryActionCard({ onAdd }: { onAdd: () => void }) {
  return <Card className="border-[#d8e3e0]"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-[#203c48]">员工与工人信息录入</p><p className="mt-1 text-xs text-slate-500">新增公司管理人员、劳务队工人或临时日结人员档案；档案将同步用于工资、考勤与日结。</p></div><Button onClick={onAdd}>添加员工/工人</Button></CardContent></Card>;
}
