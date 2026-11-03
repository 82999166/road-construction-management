import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** 各类人员统一进入人员档案中心，工资、考勤仍沿原审批流程。 */
export default function LaborEntryActionCard({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="border-[#d8e3e0]">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold text-[#203c48]">
            统一录入各类人员
          </p>
          <p className="mt-1 text-xs text-slate-500">
            公司人员、驾驶员、机械操作员、临时工和施工队工人均使用同一档案入口；人员归属、岗位、计薪方式与账号权限分开维护，不自动创建账号或授权。
          </p>
        </div>
        <Button onClick={onAdd}>新增人员</Button>
      </CardContent>
    </Card>
  );
}
