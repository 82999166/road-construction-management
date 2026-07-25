import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { trpc } from "@/lib/trpc";
import { Archive, ArrowLeft, CircleHelp, HardHat, PackagePlus, Printer, ShoppingCart, Warehouse } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "../_core/hooks/useAuth";

/** 将服务端 decimal 结果格式化展示，前端不参与库存或金额的业务重算。 */
function formatMoney(value: string | number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function requestStatus(status: string) {
  const labels: Record<string, string> = { draft: "草稿", submitted: "待审批", approved: "已批准", ordered: "已下单", received: "已收货", stocked: "已入库", closed: "已关闭", rejected: "已退回" };
  const tone = status === "closed" ? "bg-stone-100 text-stone-600" : status === "approved" || status === "stocked" ? "bg-emerald-50 text-emerald-700" : status === "submitted" ? "bg-amber-50 text-amber-700" : "bg-[#f8ead8] text-[#94603a]";
  return { label: labels[status] ?? status, tone };
}

function orderStatus(status: string) {
  const labels: Record<string, string> = { draft: "待确认", confirmed: "已确认", received: "已收货", closed: "已关闭", void: "已作废" };
  const tone = status === "received" || status === "closed" ? "bg-emerald-50 text-emerald-700" : status === "confirmed" ? "bg-amber-50 text-amber-700" : status === "void" ? "bg-stone-100 text-stone-600" : "bg-[#f8ead8] text-[#94603a]";
  return { label: labels[status] ?? status, tone };
}

function createInventoryDraft() {
  return { transactionType: "inbound" as "inbound" | "outbound" | "return", requestId: "", purchaseOrderId: "", itemName: "", unit: "件", quantity: "", unitCost: "", occurredAt: new Date().toISOString().slice(0, 16), remarks: "" };
}

function createOrderDraft() {
  return { requestId: "", supplierId: "", amount: "", orderedAt: new Date().toISOString().slice(0, 16) };
}

/** 采购仓储移动端：所有可见数据均由项目、组织和岗位范围在服务端过滤。 */
export default function MobilePurchasingPage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const { isSuperAdmin } = useManagementPermissions();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState<number>();
  const [tab, setTab] = useState("requests");
  const [requestOpen, setRequestOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [requestDraft, setRequestDraft] = useState({ categoryId: "", amount: "", description: "" });
  const [orderDraft, setOrderDraft] = useState(createOrderDraft);
  const [settlementDraft, setSettlementDraft] = useState({ orderId: "", amount: "", settledAt: new Date().toISOString().slice(0, 16), remarks: "" });
  const [inventoryDraft, setInventoryDraft] = useState(createInventoryDraft);
  const [supplierDraft, setSupplierDraft] = useState({ name: "", contactName: "", contactPhoneMasked: "" });

  const projects = trpc.purchasing.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  useEffect(() => { if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id); }, [projectId, projects.data]);
  const selectedProjectId = projectId ?? 0;
  const projectInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const categories = trpc.purchasing.categories.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const suppliers = trpc.purchasing.listSuppliers.useQuery(undefined, { enabled: isAuthenticated && isSuperAdmin, retry: false });
  const requests = trpc.purchasing.listRequests.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const orders = trpc.purchasing.listOrders.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const settlements = trpc.purchasing.listSettlements.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const inventory = trpc.purchasing.listInventory.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  /** 未选择项目时路由返回空数组；页面统一转换为余额列表以保持渲染类型安全。 */
  const inventoryBalances = Array.isArray(inventory.data) ? [] : inventory.data?.balances ?? [];
  const activeProjectName = projects.data?.find(project => project.id === selectedProjectId)?.name ?? "请选择项目";
  const refreshData = async () => {
    await Promise.all([
      utils.purchasing.listRequests.invalidate(),
      utils.purchasing.listOrders.invalidate(),
      utils.purchasing.listSettlements.invalidate(),
      utils.purchasing.listInventory.invalidate(),
      utils.purchasing.listSuppliers.invalidate(),
    ]);
  };
  const saveRequest = trpc.purchasing.saveRequest.useMutation({
    onSuccess: async () => { toast.success("采购申请草稿已保存"); setRequestOpen(false); setRequestDraft({ categoryId: "", amount: "", description: "" }); await refreshData(); },
    onError: error => toast.error(error.message),
  });
  const transitionRequest = trpc.purchasing.transitionRequest.useMutation({ onSuccess: async () => { toast.success("采购申请状态已更新"); await refreshData(); }, onError: error => toast.error(error.message) });
  const createOrder = trpc.purchasing.createOrder.useMutation({
    onSuccess: async () => { toast.success("采购订单已创建"); setOrderOpen(false); setOrderDraft(createOrderDraft()); await refreshData(); },
    onError: error => toast.error(error.message),
  });
  const transitionOrder = trpc.purchasing.transitionOrder.useMutation({ onSuccess: async () => { toast.success("采购订单状态已更新"); await refreshData(); }, onError: error => toast.error(error.message) });
  const recordSettlement = trpc.purchasing.recordSettlement.useMutation({ onSuccess: async data => { toast.success(`结算已登记，订单待结算 ${formatMoney(data.remainingAmount)}`); setSettlementOpen(false); setSettlementDraft({ orderId: "", amount: "", settledAt: new Date().toISOString().slice(0, 16), remarks: "" }); await refreshData(); }, onError: error => toast.error(error.message) });
  const saveInventory = trpc.purchasing.saveInventoryTransaction.useMutation({
    onSuccess: async () => { toast.success("库存收发流水已登记"); setInventoryOpen(false); setInventoryDraft(createInventoryDraft()); await refreshData(); },
    onError: error => toast.error(error.message),
  });
  const saveSupplier = trpc.purchasing.saveSupplier.useMutation({
    onSuccess: async () => { toast.success("供应商资料已保存"); setSupplierOpen(false); setSupplierDraft({ name: "", contactName: "", contactPhoneMasked: "" }); await refreshData(); },
    onError: error => toast.error(error.message),
  });

  function submitRequest() {
    if (!selectedProjectId || !requestDraft.categoryId || !requestDraft.amount || !requestDraft.description.trim()) return toast.error("请填写采购类别、申请金额和说明");
    saveRequest.mutate({ projectId: selectedProjectId, categoryId: Number(requestDraft.categoryId), amount: Number(requestDraft.amount), description: requestDraft.description.trim() });
  }

  function openCreateOrder(request: { id: number; amount: string | number }) {
    setOrderDraft({ requestId: String(request.id), supplierId: "", amount: String(request.amount), orderedAt: new Date().toISOString().slice(0, 16) });
    setOrderOpen(true);
  }

  function submitOrder() {
    if (!selectedProjectId || !orderDraft.requestId || !orderDraft.amount || !orderDraft.orderedAt) return toast.error("请填写采购申请、订单金额和下单时间");
    createOrder.mutate({
      requestId: Number(orderDraft.requestId),
      projectId: selectedProjectId,
      supplierId: orderDraft.supplierId ? Number(orderDraft.supplierId) : null,
      amount: Number(orderDraft.amount),
      orderedAt: new Date(orderDraft.orderedAt).toISOString(),
    });
  }

  function openSettlement(orderId?: number) {
    const order = orderId ? orders.data?.find(item => item.id === orderId) : undefined;
    const balance = order ? settlements.data?.totalsByOrder[String(order.id)]?.remainingAmount ?? Number(order.amount) : "";
    setSettlementDraft({ orderId: order ? String(order.id) : "", amount: balance === "" ? "" : String(balance), settledAt: new Date().toISOString().slice(0, 16), remarks: "" });
    setSettlementOpen(true);
  }

  function submitSettlement() {
    if (!selectedProjectId || !settlementDraft.orderId || !settlementDraft.amount || !settlementDraft.settledAt) return toast.error("请填写订单、结算金额和结算时间");
    recordSettlement.mutate({ orderId: Number(settlementDraft.orderId), projectId: selectedProjectId, amount: Number(settlementDraft.amount), settledAt: new Date(settlementDraft.settledAt).toISOString(), remarks: settlementDraft.remarks.trim() || null });
  }

  function submitInventory() {
    if (!selectedProjectId || !inventoryDraft.itemName.trim() || !inventoryDraft.quantity || !inventoryDraft.unitCost) return toast.error("请填写物料、数量和单价");
    saveInventory.mutate({
      projectId: selectedProjectId,
      requestId: inventoryDraft.requestId ? Number(inventoryDraft.requestId) : null,
      purchaseOrderId: inventoryDraft.purchaseOrderId ? Number(inventoryDraft.purchaseOrderId) : null,
      transactionType: inventoryDraft.transactionType,
      itemName: inventoryDraft.itemName.trim(),
      unit: inventoryDraft.unit.trim(),
      quantity: Number(inventoryDraft.quantity),
      unitCost: Number(inventoryDraft.unitCost),
      occurredAt: new Date(inventoryDraft.occurredAt).toISOString(),
      remarks: inventoryDraft.remarks.trim() || null,
    });
  }

  function submitSupplier() {
    if (!supplierDraft.name.trim()) return toast.error("请填写供应商名称");
    saveSupplier.mutate({ organizationId: null, name: supplierDraft.name.trim(), unifiedSocialCreditCode: null, contactName: supplierDraft.contactName.trim() || null, contactPhoneMasked: supplierDraft.contactPhoneMasked.trim() || null, status: "active" });
  }

  if (loading || !isAuthenticated || projects.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projects.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载采购仓储权限…" title="采购仓储" description="请使用企业统一身份进入已授权项目的采购和库存数据。" Icon={ShoppingCart} onRetry={() => { void refresh(); void projects.refetch(); }} />;

  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]"><div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-10 shadow-[0_0_50px_rgba(74,42,29,.12)]">
    <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea] print:hidden"><div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,238,215,.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,238,215,.32)_1px,transparent_1px)] [background-size:24px_24px]" /><div className="relative flex items-center justify-between"><Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></Button><div className="text-center"><p className="text-sm font-semibold">采购仓储</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">申请 · 订单 · 收发 · 库存台账</p></div><Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => toast.info("采购类别固定为 12 类；库存余额由不可变收发流水汇总。")}><CircleHelp className="h-5 w-5" /></Button></div><div className="relative mt-5 flex items-end justify-between"><div><p className="text-xs text-[#e8cfb2]">当前项目</p><p className="mt-1 text-lg font-semibold">{activeProjectName}</p></div><Warehouse className="h-6 w-6 text-[#e7b779]" /></div></header>
    <main className="space-y-4 px-5 py-5">
      <section className="hidden print:block"><h1 className="text-center text-xl font-semibold">采购仓储业务台账</h1><p className="mt-2 text-center text-sm">项目：{activeProjectName}　生成时间：{new Date().toLocaleString("zh-CN")}</p><div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm"><div>采购申请<p className="mt-1 font-semibold">{requests.data?.length ?? 0} 笔</p></div><div>采购订单<p className="mt-1 font-semibold">{orders.data?.length ?? 0} 笔</p></div><div>库存品目<p className="mt-1 font-semibold">{inventoryBalances.length} 项</p></div></div></section>
      {!projects.data?.length ? <Card className="border-0"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#ad6335]" /><h2 className="mt-3 font-semibold">暂无授权项目</h2><p className="mt-2 text-xs leading-5 text-[#765544]">请联系管理员配置采购仓储的数据权限。</p></CardContent></Card> : <>
        <Select value={projectId ? String(projectId) : undefined} onValueChange={value => setProjectId(Number(value))}><SelectTrigger className="h-11 border-[#e9d8c6] bg-white print:hidden"><SelectValue placeholder="选择已授权项目" /></SelectTrigger><SelectContent>{projects.data.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select>
        <section className="flex items-center justify-between rounded-2xl bg-[#f0dfc7] px-4 py-3 print:hidden"><div><p className="font-semibold">采购仓储台账</p><p className="text-xs text-[#7d563d]">订单、收货与入库均由项目范围和岗位权限控制。</p></div><Button size="sm" variant="ghost" className="gap-1 text-[#8b3f20] hover:bg-[#e8cda9]" onClick={() => window.print()}><Printer className="h-4 w-4" />打印</Button></section>
        {isSuperAdmin ? <section className="flex items-center justify-between gap-3 rounded-2xl border border-[#ead3bb] bg-[#fffaf4] px-4 py-3 print:hidden"><div><p className="font-semibold text-[#6d3421]">采购结算</p><p className="mt-1 text-xs text-[#8f7566]">仅已收货订单可登记实际付款；余额由财务流水在服务端汇总。</p></div><Button size="sm" className="shrink-0 bg-[#6d3421] hover:bg-[#542516]" disabled={!orders.data?.some(order => ["received", "closed"].includes(order.status) && (settlements.data?.totalsByOrder[String(order.id)]?.remainingAmount ?? Number(order.amount)) > 0)} onClick={() => openSettlement()}>登记结算</Button></section> : null}
        <Tabs value={tab} onValueChange={setTab} className="print:hidden"><TabsList className={`grid h-auto w-full ${isSuperAdmin ? "grid-cols-4" : "grid-cols-3"} bg-[#f0dfc7] p-1`}><TabsTrigger value="requests">申请</TabsTrigger><TabsTrigger value="orders">订单</TabsTrigger><TabsTrigger value="inventory">库存</TabsTrigger>{isSuperAdmin ? <TabsTrigger value="suppliers">供应商</TabsTrigger> : null}</TabsList>
          <TabsContent value="requests" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><p className="font-semibold">采购申请</p><p className="text-xs text-[#8f7566]">分类、权限与状态由服务端统一校验。</p></div><Button size="sm" className="bg-[#6d3421] hover:bg-[#542516]" onClick={() => setRequestOpen(true)}><PackagePlus className="mr-1 h-4 w-4" />新申请</Button></div>{requests.data?.length ? requests.data.map(request => { const status = requestStatus(request.status); return <Card key={request.id} className="border-0 shadow-sm"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{request.requestNo}</p><p className="mt-1 text-xs text-[#8f7566]">{request.description}</p></div><span className={`rounded-full px-2 py-1 text-[11px] ${status.tone}`}>{status.label}</span></div><div className="mt-3 flex items-center justify-between"><span className="text-sm text-[#7e4329]">{formatMoney(request.amount)}</span>{isSuperAdmin ? <div className="flex gap-2">{request.status === "draft" ? <Button size="sm" variant="outline" onClick={() => transitionRequest.mutate({ id: request.id, projectId: selectedProjectId, targetStatus: "submitted" })}>提交</Button> : null}{request.status === "submitted" ? <Button size="sm" variant="outline" onClick={() => transitionRequest.mutate({ id: request.id, projectId: selectedProjectId, targetStatus: "approved" })}>批准</Button> : null}{request.status === "approved" ? <Button size="sm" variant="outline" onClick={() => openCreateOrder(request)}>建订单</Button> : null}</div> : null}</div></CardContent></Card>; }) : <EmptyState text="当前项目暂无采购申请。" />}</TabsContent>
          <TabsContent value="orders" className="mt-4 space-y-3"><div><p className="font-semibold">采购订单</p><p className="text-xs text-[#8f7566]">订单只能由已批准申请创建；收货将同步回写申请状态。</p></div>{orders.data?.length ? orders.data.map(order => { const status = orderStatus(order.status); return <Card key={order.id} className="border-0 shadow-sm"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{order.orderNo}</p><p className="mt-1 text-xs text-[#8f7566]">{new Date(order.orderedAt).toLocaleString("zh-CN")}　{order.supplierId ? `供应商 #${order.supplierId}` : "未关联供应商"}</p></div><span className={`rounded-full px-2 py-1 text-[11px] ${status.tone}`}>{status.label}</span></div><div className="mt-3 flex items-center justify-between"><span className="text-sm text-[#7e4329]">{formatMoney(order.amount)}</span>{isSuperAdmin ? <div className="flex gap-2">{order.status === "draft" ? <Button size="sm" variant="outline" onClick={() => transitionOrder.mutate({ id: order.id, projectId: selectedProjectId, targetStatus: "confirmed" })}>确认</Button> : null}{order.status === "confirmed" ? <Button size="sm" variant="outline" onClick={() => transitionOrder.mutate({ id: order.id, projectId: selectedProjectId, targetStatus: "received" })}>收货</Button> : null}</div> : null}</div></CardContent></Card>; }) : <EmptyState text="暂无采购订单；请从已批准采购申请创建。" />}</TabsContent>
          <TabsContent value="inventory" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><p className="font-semibold">库存余额</p><p className="text-xs text-[#8f7566]">余额来自每一笔不可变的收发流水。</p></div><Button size="sm" className="bg-[#6d3421] hover:bg-[#542516]" onClick={() => setInventoryOpen(true)}><Archive className="mr-1 h-4 w-4" />登记</Button></div>{inventoryBalances.length ? inventoryBalances.map(item => <Card key={`${item.itemName}-${item.unit}`} className="border-0 shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><p className="font-semibold">{item.itemName}</p><p className="text-xs text-[#8f7566]">库存成本 {formatMoney(item.totalAmount)}</p></div><p className="text-lg font-semibold text-[#7e4329]">{item.balanceQuantity}<span className="ml-1 text-xs font-normal">{item.unit}</span></p></CardContent></Card>) : <EmptyState text="当前项目暂无库存收发流水。" />}</TabsContent>
          <TabsContent value="suppliers" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><p className="font-semibold">供应商名录</p><p className="text-xs text-[#8f7566]">前端仅展示已脱敏联系方式。</p></div><Button size="sm" className="bg-[#6d3421] hover:bg-[#542516]" onClick={() => setSupplierOpen(true)}><PackagePlus className="mr-1 h-4 w-4" />新增</Button></div>{suppliers.data?.length ? suppliers.data.map(supplier => <Card key={supplier.id} className="border-0 shadow-sm"><CardContent className="p-4"><p className="font-semibold">{supplier.name}</p><p className="mt-1 text-xs text-[#8f7566]">{supplier.contactName ?? "未登记联系人"}　{supplier.contactPhoneMasked ?? "未登记联系方式"}</p></CardContent></Card>) : <EmptyState text="暂无有效供应商。" />}</TabsContent>
        </Tabs>
      </>}
    </main>
    <Dialog open={requestOpen} onOpenChange={setRequestOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>新建采购申请</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>采购类别</Label><Select value={requestDraft.categoryId} onValueChange={categoryId => setRequestDraft(current => ({ ...current, categoryId }))}><SelectTrigger className="mt-1"><SelectValue placeholder="选择固定类别" /></SelectTrigger><SelectContent>{categories.data?.map(category => <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>)}</SelectContent></Select></div><div><Label>申请金额</Label><Input className="mt-1" inputMode="decimal" value={requestDraft.amount} onChange={event => setRequestDraft(current => ({ ...current, amount: event.target.value }))} /></div><div><Label>采购说明</Label><Input className="mt-1" value={requestDraft.description} onChange={event => setRequestDraft(current => ({ ...current, description: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setRequestOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitRequest} disabled={saveRequest.isPending}>保存</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={orderOpen} onOpenChange={setOrderOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>从批准申请创建订单</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>采购申请</Label><Select value={orderDraft.requestId} onValueChange={requestId => { const request = requests.data?.find(item => item.id === Number(requestId)); setOrderDraft(current => ({ ...current, requestId, amount: request ? String(request.amount) : current.amount })); }}><SelectTrigger className="mt-1"><SelectValue placeholder="选择已批准申请" /></SelectTrigger><SelectContent>{requests.data?.filter(request => request.status === "approved").map(request => <SelectItem key={request.id} value={String(request.id)}>{request.requestNo} · {formatMoney(request.amount)}</SelectItem>)}</SelectContent></Select></div><div><Label>供应商（可选）</Label><Select value={orderDraft.supplierId || "none"} onValueChange={supplierId => setOrderDraft(current => ({ ...current, supplierId: supplierId === "none" ? "" : supplierId }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">暂不关联供应商</SelectItem>{suppliers.data?.map(supplier => <SelectItem key={supplier.id} value={String(supplier.id)}>{supplier.name}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-2"><div><Label>订单金额</Label><Input className="mt-1" inputMode="decimal" value={orderDraft.amount} onChange={event => setOrderDraft(current => ({ ...current, amount: event.target.value }))} /></div><div><Label>下单时间</Label><Input className="mt-1" type="datetime-local" value={orderDraft.orderedAt} onChange={event => setOrderDraft(current => ({ ...current, orderedAt: event.target.value }))} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setOrderOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitOrder} disabled={createOrder.isPending}>创建订单</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={inventoryOpen} onOpenChange={setInventoryOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>登记库存流水</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>收发类型</Label><Select value={inventoryDraft.transactionType} onValueChange={value => setInventoryDraft(current => ({ ...current, transactionType: value as "inbound" | "outbound" | "return" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inbound">入库</SelectItem><SelectItem value="outbound">领用</SelectItem><SelectItem value="return">退库</SelectItem></SelectContent></Select></div>{inventoryDraft.transactionType === "inbound" ? <div className="grid grid-cols-2 gap-2"><div><Label>关联申请（可选）</Label><Select value={inventoryDraft.requestId || "none"} onValueChange={requestId => setInventoryDraft(current => ({ ...current, requestId: requestId === "none" ? "" : requestId }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不关联申请</SelectItem>{requests.data?.filter(request => ["approved", "ordered", "received"].includes(request.status)).map(request => <SelectItem key={request.id} value={String(request.id)}>{request.requestNo}</SelectItem>)}</SelectContent></Select></div><div><Label>关联订单（可选）</Label><Select value={inventoryDraft.purchaseOrderId || "none"} onValueChange={purchaseOrderId => setInventoryDraft(current => ({ ...current, purchaseOrderId: purchaseOrderId === "none" ? "" : purchaseOrderId }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不关联订单</SelectItem>{orders.data?.filter(order => ["confirmed", "received"].includes(order.status)).map(order => <SelectItem key={order.id} value={String(order.id)}>{order.orderNo}</SelectItem>)}</SelectContent></Select></div></div> : null}<div><Label>物料名称</Label><Input className="mt-1" value={inventoryDraft.itemName} onChange={event => setInventoryDraft(current => ({ ...current, itemName: event.target.value }))} /></div><div className="grid grid-cols-3 gap-2"><div><Label>单位</Label><Input className="mt-1" value={inventoryDraft.unit} onChange={event => setInventoryDraft(current => ({ ...current, unit: event.target.value }))} /></div><div><Label>数量</Label><Input className="mt-1" inputMode="decimal" value={inventoryDraft.quantity} onChange={event => setInventoryDraft(current => ({ ...current, quantity: event.target.value }))} /></div><div><Label>单价</Label><Input className="mt-1" inputMode="decimal" value={inventoryDraft.unitCost} onChange={event => setInventoryDraft(current => ({ ...current, unitCost: event.target.value }))} /></div></div><div><Label>发生时间</Label><Input className="mt-1" type="datetime-local" value={inventoryDraft.occurredAt} onChange={event => setInventoryDraft(current => ({ ...current, occurredAt: event.target.value }))} /></div><div><Label>备注</Label><Input className="mt-1" value={inventoryDraft.remarks} onChange={event => setInventoryDraft(current => ({ ...current, remarks: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setInventoryOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitInventory} disabled={saveInventory.isPending}>登记</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={settlementOpen} onOpenChange={setSettlementOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>登记采购结算</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>采购订单</Label><Select value={settlementDraft.orderId} onValueChange={orderId => { const order = orders.data?.find(item => item.id === Number(orderId)); const remainingAmount = settlements.data?.totalsByOrder[orderId]?.remainingAmount ?? Number(order?.amount ?? 0); setSettlementDraft(current => ({ ...current, orderId, amount: String(remainingAmount) })); }}><SelectTrigger className="mt-1"><SelectValue placeholder="选择已收货订单" /></SelectTrigger><SelectContent>{orders.data?.filter(order => ["received", "closed"].includes(order.status) && (settlements.data?.totalsByOrder[String(order.id)]?.remainingAmount ?? Number(order.amount)) > 0).map(order => <SelectItem key={order.id} value={String(order.id)}>{order.orderNo} · 待结算 {formatMoney(settlements.data?.totalsByOrder[String(order.id)]?.remainingAmount ?? Number(order.amount))}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-2"><div><Label>本次结算金额</Label><Input className="mt-1" inputMode="decimal" value={settlementDraft.amount} onChange={event => setSettlementDraft(current => ({ ...current, amount: event.target.value }))} /></div><div><Label>结算时间</Label><Input className="mt-1" type="datetime-local" value={settlementDraft.settledAt} onChange={event => setSettlementDraft(current => ({ ...current, settledAt: event.target.value }))} /></div></div><div><Label>备注</Label><Input className="mt-1" value={settlementDraft.remarks} onChange={event => setSettlementDraft(current => ({ ...current, remarks: event.target.value }))} placeholder="可选" /></div><p className="rounded-lg bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">结算金额由服务端校验订单待结算余额，并自动写入项目成本流水和审计日志。</p></div><DialogFooter><Button variant="outline" onClick={() => setSettlementOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitSettlement} disabled={recordSettlement.isPending}>{recordSettlement.isPending ? "正在登记…" : "登记结算"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>新增供应商</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>供应商名称</Label><Input className="mt-1" value={supplierDraft.name} onChange={event => setSupplierDraft(current => ({ ...current, name: event.target.value }))} /></div><div className="grid grid-cols-2 gap-2"><div><Label>联系人</Label><Input className="mt-1" value={supplierDraft.contactName} onChange={event => setSupplierDraft(current => ({ ...current, contactName: event.target.value }))} /></div><div><Label>脱敏电话</Label><Input className="mt-1" placeholder="****1234" value={supplierDraft.contactPhoneMasked} onChange={event => setSupplierDraft(current => ({ ...current, contactPhoneMasked: event.target.value }))} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setSupplierOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitSupplier} disabled={saveSupplier.isPending}>保存</Button></DialogFooter></DialogContent></Dialog>
  </div></div>;
}

/** 统一的业务空态，避免在未授权或无数据时留下误导性的占位数字。 */
function EmptyState({ text }: { text: string }) { return <Card className="border-dashed border-[#e3cbb4] bg-[#fffaf4]"><CardContent className="p-7 text-center text-sm text-[#8f7566]">{text}</CardContent></Card>; }
