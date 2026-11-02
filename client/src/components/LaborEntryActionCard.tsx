import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** 仅负责施工队实名制工人录入入口；项目范围和服务端权限校验继续由父页面处理。 */
export default function LaborEntryActionCard({ onAdd }: { onAdd: () => void }) {
  return <Card className="border-[#d8e3e0]"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold text-[#203c48]">新建实名制施工队工人</p><p className="mt-1 text-xs text-slate-500">在当前已授权项目直接建立真实劳务人员档案；不会创建系统账号或员工档案，保存后可用于考勤和工资台账。</p></div><Button onClick={onAdd}>新建施工队工人</Button></CardContent></Card>;
}
