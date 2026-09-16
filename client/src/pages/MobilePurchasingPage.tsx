import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CurrentFilterPrintActions } from "@/components/CurrentFilterPrintActions";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MobileAccessGate } from "@/components/MobileAccessGate";
import { useManagementPermissions } from "@/hooks/useManagementPermissions";
import { downloadCurrentFilteredCsv, escapePrintHtml, openA4LandscapePrintDocument } from "@/lib/a4Print";
import { formatChinaDateTime, toDeviceDateTimeInput } from "@/lib/businessTime";
import { trpc } from "@/lib/trpc";
import { Archive, ArrowLeft, Camera, CircleHelp, HardHat, PackagePlus, Printer, ReceiptText, RefreshCw, ShoppingCart, Warehouse } from "lucide-react";
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
  return { label: labels[status] ?? "待处理", tone };
}

function orderStatus(status: string) {
  const labels: Record<string, string> = { draft: "草稿", pending_approval: "待审核", confirmed: "已通过", approved: "已通过", ordered: "已通过", received: "已收货", stocked: "已收货", closed: "已结算", cancelled: "已作废", void: "已作废" };
  const tone = status === "received" || status === "closed" ? "bg-emerald-50 text-emerald-700" : status === "confirmed" ? "bg-amber-50 text-amber-700" : status === "void" ? "bg-stone-100 text-stone-600" : "bg-[#f8ead8] text-[#94603a]";
  return { label: labels[status] ?? "待处理", tone };
}

function createInventoryDraft() {
  return { transactionType: "inbound" as "inbound" | "outbound" | "return", requestId: "", purchaseOrderId: "", itemName: "", unit: "件", quantity: "", unitCost: "", occurredAt: toDeviceDateTimeInput(), remarks: "" };
}

function createOrderDraft() {
  return { requestId: "", supplierId: "", amount: "", orderedAt: toDeviceDateTimeInput() };
}

function createSmallDirectDraft() {
  return { categoryId: "", itemDescription: "", quantity: "", unitPrice: "", amountMode: "auto" as "auto" | "manual", manualAmount: "", evidenceId: "", hasInvoice: false, invoiceEvidenceId: "", orderedAt: toDeviceDateTimeInput() };
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取单据照片失败"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

/** 上传前将单据照片压缩至最长边 1920px、JPEG 质量 0.82；PDF 保持原文件以保留票面与电子签章。 */
async function optimizePurchaseImage(file: File) {
  if (!file.type.startsWith("image/") || typeof document === "undefined") return file;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    const objectUrl = URL.createObjectURL(file);
    element.onload = () => { URL.revokeObjectURL(objectUrl); resolve(element); };
    element.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("读取单据照片失败")); };
    element.src = objectUrl;
  });
  const scale = Math.min(1, 1920 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }) : file;
}

/** 采购仓储移动端：所有可见数据均由项目、组织和岗位范围在服务端过滤。 */
export default function MobilePurchasingPage() {
  const { isAuthenticated, loading, authLoadingTimedOut, refresh } = useAuth();
  const { isSuperAdmin } = useManagementPermissions();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState<number>();
  const [tab, setTab] = useState("requests");
  const [orderPrintStatus, setOrderPrintStatus] = useState("all");
  const [orderUploaderId, setOrderUploaderId] = useState("all");
  const [requestOpen, setRequestOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [smallDirectOpen, setSmallDirectOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [requestDraft, setRequestDraft] = useState({ categoryId: "", amount: "", description: "" });
  const [orderDraft, setOrderDraft] = useState(createOrderDraft);
  const [settlementDraft, setSettlementDraft] = useState({ orderId: "", amount: "", settledAt: toDeviceDateTimeInput(), remarks: "" });
  const [inventoryDraft, setInventoryDraft] = useState(createInventoryDraft);
  const [supplierDraft, setSupplierDraft] = useState({ name: "", contactName: "", contactPhoneMasked: "" });
  const [smallDirectDraft, setSmallDirectDraft] = useState(createSmallDirectDraft);

  const projects = trpc.purchasing.projectOptions.useQuery(undefined, { enabled: isAuthenticated, retry: 2, retryDelay: attempt => Math.min(1_000 * (attempt + 1), 3_000), refetchOnMount: "always" });
  useEffect(() => { if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id); }, [projectId, projects.data]);
  const selectedProjectId = projectId ?? 0;
  const projectInput = useMemo(() => ({ projectId: selectedProjectId }), [selectedProjectId]);
  const categories = trpc.purchasing.categories.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const purchasingCapabilities = trpc.purchasing.capabilities.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const suppliers = trpc.purchasing.listSuppliers.useQuery(undefined, { enabled: isAuthenticated && isSuperAdmin, retry: false });
  const requests = trpc.purchasing.listRequests.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const orders = trpc.purchasing.listOrders.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const settlements = trpc.purchasing.listSettlements.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const inventory = trpc.purchasing.listInventory.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  const purchaseEvidences = trpc.purchasing.listPurchaseEvidences.useQuery(projectInput, { enabled: isAuthenticated && Boolean(selectedProjectId), retry: false });
  /** 未选择项目时路由返回空数组；页面统一转换为余额列表以保持渲染类型安全。 */
  const inventoryBalances = Array.isArray(inventory.data) ? [] : inventory.data?.balances ?? [];
  const selectedOrder = orders.data?.find(order => order.id === selectedOrderId) ?? null;
  const activeProjectName = projects.data?.find(project => project.id === selectedProjectId)?.name ?? "请选择项目";
  const uploaderOptions = useMemo(() => {
    const unique = new Map<number, string>();
    (orders.data ?? []).forEach(order => {
      const id = order.documentUploadedBy ?? order.createdBy;
      const name = order.documentUploadedByName ?? order.createdByName ?? `管理员 #${id}`;
      if (id) unique.set(id, name);
    });
    return Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [orders.data]);
  const filteredOrders = useMemo(() => (orders.data ?? []).filter(order => {
    const statusMatched = orderPrintStatus === "all" || order.status === orderPrintStatus;
    const uploaderMatched = orderUploaderId === "all" || String(order.documentUploadedBy ?? order.createdBy) === orderUploaderId;
    return statusMatched && uploaderMatched;
  }), [orderPrintStatus, orderUploaderId, orders.data]);
  const printPurchaseReceipts = () => {
    if (!filteredOrders.length) return toast.error("当前筛选下没有可打印的采购详单");
    const tickets = filteredOrders.map((order, index) => {
      const attachment = order.documentAttachment;
      const uploaderName = order.documentUploadedByName ?? order.createdByName ?? `管理员 #${order.documentUploadedBy ?? order.createdBy}`;
      return `<section class="receipt-page"><div class="receipt-left"><h1>采购票据详单</h1><p class="receipt-no">${escapePrintHtml(order.orderNo)}</p><div class="receipt-grid"><div><small>采购模式</small><b>${escapePrintHtml(order.procurementMode === "small_direct" ? "小额直接采购" : "采购申请转订单")}</b></div><div><small>物资说明</small><b>${escapePrintHtml(order.itemDescription || "采购申请关联订单")}</b></div><div><small>数量</small><b>${escapePrintHtml(order.quantity ?? "—")}</b></div><div><small>单价</small><b>${order.unitPrice == null ? "—" : `¥${escapePrintHtml(Number(order.unitPrice).toFixed(2))}`}</b></div><div><small>订单金额</small><b>¥${escapePrintHtml(Number(order.amount).toFixed(2))}</b></div><div><small>当前状态</small><b>${escapePrintHtml(orderStatus(order.status).label)}</b></div></div><p class="receipt-meta">下单时间：${escapePrintHtml(formatChinaDateTime(order.orderedAt))}</p><p class="receipt-meta">上传人：${escapePrintHtml(uploaderName)}</p><p class="receipt-meta">第 ${index + 1} / ${filteredOrders.length} 张</p></div><div class="receipt-right">${attachment?.url ? `<img src="${escapePrintHtml(attachment.url)}" alt="采购票据 ${escapePrintHtml(order.orderNo)}" />` : "<span>未上传票据图片</span>"}</div></section>`;
    }).join("");
    const printWindow = window.open("", "_blank");
    if (!printWindow) return toast.error("浏览器阻止了打印页，请允许弹出窗口后重试");
    printWindow.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>采购票据详单</title><style>*{box-sizing:border-box}html,body{margin:0;background:#eee;color:#241914;font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif}.receipt-page{display:grid;grid-template-columns:1fr 1fr;width:210mm;height:148.5mm;margin:8mm auto;padding:7mm;border:1px solid #bca58e;background:#fff;break-after:page;page-break-after:always}.receipt-page:last-child{break-after:auto;page-break-after:auto}.receipt-left{padding:2mm 6mm 2mm 1mm;border-right:1px solid #d9c8b8}.receipt-left h1{margin:0;font-size:19px;letter-spacing:2px}.receipt-no{margin:3mm 0 6mm;color:#80543d;font-size:12px;font-weight:700}.receipt-grid{display:grid;grid-template-columns:1fr 1fr;gap:3mm}.receipt-grid div{min-height:15mm;padding:3mm;background:#faf5ef}.receipt-grid small{display:block;color:#987e6d;font-size:9px}.receipt-grid b{display:block;margin-top:1.5mm;font-size:12px;word-break:break-all}.receipt-meta{margin:4mm 0 0;color:#6e5546;font-size:10px;line-height:1.5}.receipt-right{display:flex;align-items:center;justify-content:center;min-width:0;padding-left:6mm}.receipt-right img{display:block;width:92mm;height:128mm;object-fit:contain}.receipt-right span{color:#a28c7c;font-size:12px}@media print{body{background:#fff}.receipt-page{width:210mm;height:148.5mm;margin:0;border:0;padding:7mm}@page{size:A4 portrait;margin:0}}</style></head><body>${tickets}<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},180)}</script></body></html>`);
    printWindow.document.close();
  };
  const printCurrentPurchasingTab = () => {
    const createdAt = escapePrintHtml(formatChinaDateTime(new Date()));
    if (tab === "orders") {
      const rows = filteredOrders.map((order, index) => `<tr><td class="center">${index + 1}</td><td>${escapePrintHtml(order.orderNo)}</td><td>${escapePrintHtml(order.itemDescription || "采购申请关联订单")}</td><td>${escapePrintHtml(formatChinaDateTime(order.orderedAt))}</td><td class="right">${escapePrintHtml(order.quantity ?? "—")}</td><td class="right">${order.unitPrice === null || order.unitPrice === undefined ? "—" : `¥${escapePrintHtml(Number(order.unitPrice).toFixed(2))}`}</td><td class="right">¥${escapePrintHtml(Number(order.amount).toFixed(2))}</td><td>${escapePrintHtml(orderStatus(order.status).label)}</td></tr>`).join("");
      const total = filteredOrders.filter(order => !["void", "cancelled"].includes(order.status)).reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
      openA4LandscapePrintDocument({ title: "采购订单明细表", bodyHtml: `<h1>采购订单明细表</h1><p class="sub">项目：${escapePrintHtml(activeProjectName)}　|　状态：${escapePrintHtml(orderPrintStatus === "all" ? "全部（不含作废金额）" : orderStatus(orderPrintStatus).label)}　|　生成时间：${createdAt}</p><hr class="rule"><table><thead><tr><th>序号</th><th>订单号</th><th>物资/说明</th><th>下单时间</th><th>数量</th><th>单价</th><th>金额</th><th>状态</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="center">当前筛选范围暂无采购订单</td></tr>'}<tr class="summary"><td colspan="6">合计：订单 ${filteredOrders.length} 笔</td><td class="right">¥${escapePrintHtml(total.toFixed(2))}</td><td>—</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>审核人：________________</span></div>` });
      return;
    }
    if (tab === "inventory") {
      const rows = inventoryBalances.map((item, index) => `<tr><td class="center">${index + 1}</td><td>${escapePrintHtml(item.itemName)}</td><td class="right">${escapePrintHtml(item.balanceQuantity)}</td><td>${escapePrintHtml(item.unit)}</td><td class="right">¥${escapePrintHtml(Number(item.totalAmount ?? 0).toFixed(2))}</td></tr>`).join("");
      const total = inventoryBalances.reduce((sum, item) => sum + Number(item.totalAmount ?? 0), 0);
      openA4LandscapePrintDocument({ title: "库存余额明细表", bodyHtml: `<h1>库存余额明细表</h1><p class="sub">项目：${escapePrintHtml(activeProjectName)}　|　生成时间：${createdAt}</p><hr class="rule"><table><thead><tr><th>序号</th><th>物料名称</th><th>库存数量</th><th>单位</th><th>库存成本</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="center">当前项目暂无库存余额</td></tr>'}<tr class="summary"><td colspan="4">合计：物料 ${inventoryBalances.length} 项</td><td class="right">¥${escapePrintHtml(total.toFixed(2))}</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>审核人：________________</span></div>` });
      return;
    }
    const rows = (requests.data ?? []).map((request, index) => `<tr><td class="center">${index + 1}</td><td>${escapePrintHtml(request.requestNo)}</td><td>${escapePrintHtml(request.description)}</td><td class="right">¥${escapePrintHtml(Number(request.amount).toFixed(2))}</td><td>${escapePrintHtml(requestStatus(request.status).label)}</td></tr>`).join("");
    const total = (requests.data ?? []).filter(request => request.status !== "rejected").reduce((sum, request) => sum + Number(request.amount ?? 0), 0);
    openA4LandscapePrintDocument({ title: "采购申请明细表", bodyHtml: `<h1>采购申请明细表</h1><p class="sub">项目：${escapePrintHtml(activeProjectName)}　|　生成时间：${createdAt}</p><hr class="rule"><table><thead><tr><th>序号</th><th>申请单号</th><th>采购说明</th><th>申请金额</th><th>状态</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="center">当前项目暂无采购申请</td></tr>'}<tr class="summary"><td colspan="3">合计：申请 ${requests.data?.length ?? 0} 笔</td><td class="right">¥${escapePrintHtml(total.toFixed(2))}</td><td>—</td></tr></tbody></table><div class="footer"><span>制表人：________________</span><span>审核人：________________</span></div>` });
  };
  const exportCurrentPurchasingTab = () => {
    if (tab === "orders") return downloadCurrentFilteredCsv("采购订单-当前筛选.csv", ["订单号", "物资/说明", "下单时间", "数量", "单价", "金额", "状态"], filteredOrders.map(order => [order.orderNo, order.itemDescription || "采购申请关联订单", formatChinaDateTime(order.orderedAt), order.quantity ?? "", order.unitPrice ?? "", order.amount, orderStatus(order.status).label]));
    if (tab === "inventory") return downloadCurrentFilteredCsv("库存余额-当前筛选.csv", ["物料名称", "库存数量", "单位", "库存成本"], inventoryBalances.map(item => [item.itemName, item.balanceQuantity, item.unit, item.totalAmount]));
    return downloadCurrentFilteredCsv("采购申请-当前筛选.csv", ["申请单号", "采购说明", "申请金额", "状态"], (requests.data ?? []).map(request => [request.requestNo, request.description, request.amount, requestStatus(request.status).label]));
  };
  const refreshData = async () => {
    await Promise.all([
      utils.purchasing.listRequests.invalidate(),
      utils.purchasing.listOrders.invalidate(),
      utils.purchasing.listSettlements.invalidate(),
      utils.purchasing.listInventory.invalidate(),
      utils.purchasing.listPurchaseEvidences.invalidate(),
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
  const recordSettlement = trpc.purchasing.recordSettlement.useMutation({ onSuccess: async data => { toast.success(`结算已登记，订单待结算 ${formatMoney(data.remainingAmount)}`); setSettlementOpen(false); setSettlementDraft({ orderId: "", amount: "", settledAt: toDeviceDateTimeInput(), remarks: "" }); await refreshData(); }, onError: error => toast.error(error.message) });
  const saveInventory = trpc.purchasing.saveInventoryTransaction.useMutation({
    onSuccess: async () => { toast.success("库存收发流水已登记"); setInventoryOpen(false); setInventoryDraft(createInventoryDraft()); await refreshData(); },
    onError: error => toast.error(error.message),
  });
  const saveSupplier = trpc.purchasing.saveSupplier.useMutation({
    onSuccess: async () => { toast.success("供应商资料已保存"); setSupplierOpen(false); setSupplierDraft({ name: "", contactName: "", contactPhoneMasked: "" }); await refreshData(); },
    onError: error => toast.error(error.message),
  });
  const createSmallDirectOrder = trpc.purchasing.createSmallDirectOrder.useMutation({
    onSuccess: async result => { toast.success(result.requiresSupervisorApproval ? `清单采购已上报主管确认（金额 ¥${result.amount.toFixed(2)}）` : `清单采购已直接入账（金额 ¥${result.amount.toFixed(2)}）`); setSmallDirectOpen(false); setSmallDirectDraft(createSmallDirectDraft()); await refreshData(); },
    onError: error => toast.error(error.message),
  });
  const uploadPurchaseDocument = trpc.purchasing.uploadPurchaseDocument.useMutation({ onError: error => toast.error(error.message) });

  function submitRequest() {
    if (!selectedProjectId || !requestDraft.categoryId || !requestDraft.amount || !requestDraft.description.trim()) return toast.error("请填写采购类别、申请金额和说明");
    saveRequest.mutate({ projectId: selectedProjectId, categoryId: Number(requestDraft.categoryId), amount: Number(requestDraft.amount), description: requestDraft.description.trim() });
  }

  function openCreateOrder(request: { id: number; amount: string | number }) {
    setOrderDraft({ requestId: String(request.id), supplierId: "", amount: String(request.amount), orderedAt: toDeviceDateTimeInput() });
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
    setSettlementDraft({ orderId: order ? String(order.id) : "", amount: balance === "" ? "" : String(balance), settledAt: toDeviceDateTimeInput(), remarks: "" });
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

  function submitSmallDirectOrder() {
    const useManualAmount = smallDirectDraft.amountMode === "manual";
    if (!selectedProjectId || !smallDirectDraft.categoryId || !smallDirectDraft.itemDescription.trim() || !smallDirectDraft.evidenceId || (useManualAmount ? !smallDirectDraft.manualAmount : (!smallDirectDraft.quantity || !smallDirectDraft.unitPrice))) return toast.error(useManualAmount ? "请上传单据照片后填写类别、物资名称和手动金额" : "请上传单据照片后填写类别、物资名称、数量和单价");
    if (smallDirectDraft.hasInvoice && !smallDirectDraft.invoiceEvidenceId) return toast.error("请选择已归档的发票照片或 PDF");
    createSmallDirectOrder.mutate({ projectId: selectedProjectId, categoryId: Number(smallDirectDraft.categoryId), itemDescription: smallDirectDraft.itemDescription.trim(), supplierId: null, quantity: smallDirectDraft.quantity ? Number(smallDirectDraft.quantity) : undefined, unitPrice: smallDirectDraft.unitPrice ? Number(smallDirectDraft.unitPrice) : undefined, amount: useManualAmount ? Number(smallDirectDraft.manualAmount) : undefined, evidenceId: Number(smallDirectDraft.evidenceId), hasInvoice: smallDirectDraft.hasInvoice, invoiceEvidenceId: smallDirectDraft.hasInvoice ? Number(smallDirectDraft.invoiceEvidenceId) : null, orderedAt: new Date(smallDirectDraft.orderedAt).toISOString() });
  }

  async function uploadPurchaseDocumentFile(file: File | undefined, attachmentKind: "document" | "invoice" = "document") {
    if (!file) return;
    if (!selectedProjectId) return toast.error("请先选择项目");
    if (!(["image/jpeg", "image/png", "application/pdf"] as string[]).includes(file.type)) return toast.error("仅支持 JPG、PNG 或 PDF 附件");
    const optimized = file.type === "application/pdf" ? file : await optimizePurchaseImage(file);
    if (optimized.size > (optimized.type === "application/pdf" ? 15 : 5) * 1024 * 1024) return toast.error(optimized.type === "application/pdf" ? "发票 PDF 不能超过 15MB" : "压缩后单据照片仍超过 5MB，请重新拍摄或裁剪");
    try {
      const result = await uploadPurchaseDocument.mutateAsync({ projectId: selectedProjectId, fileName: optimized.name, mimeType: optimized.type as "image/jpeg" | "image/png" | "application/pdf", base64Data: await fileToBase64(optimized), description: attachmentKind === "invoice" ? "采购发票附件" : "采购清单、送货单或验收单照片", attachmentKind });
      if (!result.id) throw new Error("单据归档未返回编号");
      setSmallDirectDraft(current => attachmentKind === "invoice" ? ({ ...current, invoiceEvidenceId: String(result.id) }) : ({ ...current, evidenceId: String(result.id) }));
      await refreshData();
      toast.success(attachmentKind === "invoice" ? "采购发票附件已归档" : "采购单据照片已归档");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "单据照片上传失败");
    }
  }

  if (loading || !isAuthenticated || projects.isLoading) return <MobileAccessGate isAuthenticated={isAuthenticated} isLoading={loading || (isAuthenticated && projects.isLoading)} authLoadingTimedOut={authLoadingTimedOut} loadingText="正在加载采购仓储权限…" title="采购仓储" description="请使用企业统一身份进入已授权项目的采购和库存数据。" Icon={ShoppingCart} onRetry={() => { void refresh(); void projects.refetch(); }} />;

  return <div className="min-h-screen bg-[#f8f1e7] text-[#3b2118]"><div className="mx-auto min-h-screen max-w-xl bg-[#fdf7ee] pb-10 shadow-[0_0_50px_rgba(74,42,29,.12)]">
    <header className="relative overflow-hidden bg-[#3a2117] px-5 pb-6 pt-5 text-[#fff7ea] print:hidden"><div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,238,215,.32)_1px,transparent_1px),linear-gradient(90deg,rgba(255,238,215,.32)_1px,transparent_1px)] [background-size:24px_24px]" /><div className="relative flex items-center justify-between"><Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => navigate("/mobile")}><ArrowLeft className="h-5 w-5" /></Button><div className="text-center"><p className="text-sm font-semibold">采购仓储</p><p className="mt-0.5 text-[11px] text-[#e8cfb2]">申请 · 订单 · 收发 · 库存台账</p></div><Button size="icon" variant="ghost" className="rounded-full text-white hover:bg-white/10 hover:text-white" onClick={() => toast.info("采购类别固定为 12 类；库存余额由不可变收发流水汇总。")}><CircleHelp className="h-5 w-5" /></Button></div><div className="relative mt-5 flex items-end justify-between"><div><p className="text-xs text-[#e8cfb2]">当前项目</p><p className="mt-1 text-lg font-semibold">{activeProjectName}</p></div><Warehouse className="h-6 w-6 text-[#e7b779]" /></div></header>
    <main className="space-y-4 px-5 py-5">
      <section className="hidden print:block"><h1 className="text-center text-xl font-semibold">采购仓储业务台账</h1><p className="mt-2 text-center text-sm">项目：{activeProjectName}　生成时间：{formatChinaDateTime(new Date())}</p><div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm"><div>采购申请<p className="mt-1 font-semibold">{requests.data?.length ?? 0} 笔</p></div><div>采购订单<p className="mt-1 font-semibold">{orders.data?.length ?? 0} 笔</p></div><div>库存品目<p className="mt-1 font-semibold">{inventoryBalances.length} 项</p></div></div></section>
      {projects.isError ? <Card className="border-0"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#ad6335]" /><h2 className="mt-3 font-semibold">项目授权加载失败</h2><p className="mt-2 text-xs leading-5 text-[#765544]">未能取得采购仓储项目范围，请检查网络后重新获取；这不等同于没有项目权限。</p><Button className="mt-4 gap-1 bg-[#6d3421] hover:bg-[#542516]" onClick={() => void projects.refetch()}><RefreshCw className="h-4 w-4" />重新获取授权项目</Button></CardContent></Card> : !projects.data?.length ? <Card className="border-0"><CardContent className="p-8 text-center"><HardHat className="mx-auto h-8 w-8 text-[#ad6335]" /><h2 className="mt-3 font-semibold">暂无授权项目</h2><p className="mt-2 text-xs leading-5 text-[#765544]">请在后台同时配置该账号的采购仓储操作权限与有效项目范围；配置后可直接重新获取，不必退出登录。</p><Button variant="outline" className="mt-4 gap-1 border-[#d6ae8e] text-[#7e4329]" onClick={() => void projects.refetch()}><RefreshCw className="h-4 w-4" />重新获取授权项目</Button></CardContent></Card> : <>
        <Select value={projectId ? String(projectId) : undefined} onValueChange={value => setProjectId(Number(value))}><SelectTrigger className="h-11 border-[#e9d8c6] bg-white print:hidden"><SelectValue placeholder="选择已授权项目" /></SelectTrigger><SelectContent>{projects.data.map(project => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select>
        <section className="space-y-3 rounded-2xl bg-[#f0dfc7] px-4 py-3 print:hidden"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">采购仓储台账</p><p className="text-xs text-[#7d563d]">订单、收货与入库均由项目范围和岗位权限控制；导出和打印严格使用当前项目、标签与状态筛选。</p></div>{tab === "orders" ? <Select value={orderPrintStatus} onValueChange={setOrderPrintStatus}><SelectTrigger className="h-9 w-[132px] bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部订单</SelectItem>{["draft", "pending_approval", "confirmed", "received", "closed", "void"].map(value => <SelectItem key={value} value={value}>{orderStatus(value).label}</SelectItem>)}</SelectContent></Select> : null}</div><div className="flex flex-wrap items-center gap-2">{tab === "orders" ? <><Select value={orderUploaderId} onValueChange={setOrderUploaderId}><SelectTrigger className="h-9 w-[160px] bg-white"><SelectValue placeholder="按上传人筛选" /></SelectTrigger><SelectContent><SelectItem value="all">全部上传人</SelectItem>{uploaderOptions.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={!filteredOrders.length} onClick={printPurchaseReceipts}><Printer className="mr-1 h-4 w-4" />打印半A4票据</Button></> : null}<CurrentFilterPrintActions disabled={tab === "orders" ? !filteredOrders.length : tab === "inventory" ? !inventoryBalances.length : !(requests.data?.length)} onPrint={printCurrentPurchasingTab} onExport={exportCurrentPurchasingTab} /></div></section>
        {isSuperAdmin ? <section className="flex items-center justify-between gap-3 rounded-2xl border border-[#ead3bb] bg-[#fffaf4] px-4 py-3 print:hidden"><div><p className="font-semibold text-[#6d3421]">采购结算</p><p className="mt-1 text-xs text-[#8f7566]">仅已收货订单可登记实际付款；余额由财务流水在服务端汇总。</p></div><Button size="sm" className="shrink-0 bg-[#6d3421] hover:bg-[#542516]" disabled={!orders.data?.some(order => ["received", "closed"].includes(order.status) && (settlements.data?.totalsByOrder[String(order.id)]?.remainingAmount ?? Number(order.amount)) > 0)} onClick={() => openSettlement()}>登记结算</Button></section> : null}
        <section className="flex items-center justify-between gap-3 rounded-2xl border border-[#ead3bb] bg-[#fffaf4] px-4 py-3 print:hidden"><div><p className="font-semibold text-[#6d3421]">清单采购录入</p><p className="mt-1 text-xs leading-5 text-[#8f7566]">直接拍摄采购清单、送货单或验收单并归档；金额可按数量×单价自动计算，也可手动填写。</p></div><Button size="sm" className="shrink-0 bg-[#6d3421] hover:bg-[#542516]" onClick={() => setSmallDirectOpen(true)}><ReceiptText className="mr-1 h-4 w-4" />录入</Button></section>
        <Tabs value={tab} onValueChange={setTab} className="print:hidden"><TabsList className={`grid h-auto w-full ${isSuperAdmin ? "grid-cols-4" : "grid-cols-3"} bg-[#f0dfc7] p-1`}><TabsTrigger value="requests">申请</TabsTrigger><TabsTrigger value="orders">订单</TabsTrigger><TabsTrigger value="inventory">库存</TabsTrigger>{isSuperAdmin ? <TabsTrigger value="suppliers">供应商</TabsTrigger> : null}</TabsList>
          <TabsContent value="requests" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><p className="font-semibold">采购申请</p><p className="text-xs text-[#8f7566]">分类、权限与状态由服务端统一校验。</p></div><Button size="sm" className="bg-[#6d3421] hover:bg-[#542516]" onClick={() => setRequestOpen(true)}><PackagePlus className="mr-1 h-4 w-4" />新申请</Button></div>{requests.data?.length ? requests.data.map(request => { const status = requestStatus(request.status); return <Card key={request.id} className="border-0 shadow-sm"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{request.requestNo}</p><p className="mt-1 text-xs text-[#8f7566]">{request.description}</p></div><span className={`rounded-full px-2 py-1 text-[11px] ${status.tone}`}>{status.label}</span></div><div className="mt-3 flex items-center justify-between"><span className="text-sm text-[#7e4329]">{formatMoney(request.amount)}</span>{isSuperAdmin ? <div className="flex gap-2">{request.status === "draft" ? <Button size="sm" variant="outline" onClick={() => transitionRequest.mutate({ id: request.id, projectId: selectedProjectId, targetStatus: "submitted" })}>提交</Button> : null}{request.status === "submitted" ? <Button size="sm" variant="outline" onClick={() => transitionRequest.mutate({ id: request.id, projectId: selectedProjectId, targetStatus: "approved" })}>批准</Button> : null}{request.status === "approved" ? <Button size="sm" variant="outline" onClick={() => openCreateOrder(request)}>建订单</Button> : null}</div> : null}</div></CardContent></Card>; }) : <EmptyState text="当前项目暂无采购申请。" />}</TabsContent>
          <TabsContent value="orders" className="mt-4 space-y-3"><div><p className="font-semibold">采购订单</p><p className="text-xs text-[#8f7566]">订单只能由已批准申请创建；收货将同步回写申请状态。</p></div>{filteredOrders.length ? filteredOrders.map(order => { const status = orderStatus(order.status); return <Card key={order.id} className="border-0 shadow-sm"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{order.orderNo}</p><p className="mt-1 text-xs text-[#8f7566]">{formatChinaDateTime(order.orderedAt)}　{order.supplierId ? `供应商 #${order.supplierId}` : "未关联供应商"}　上传人：{order.documentUploadedByName ?? order.createdByName ?? `管理员 #${order.documentUploadedBy ?? order.createdBy}`}</p></div><span className={`rounded-full px-2 py-1 text-[11px] ${status.tone}`}>{status.label}</span></div><div className="mt-3 flex items-center justify-between"><div><span className="text-sm text-[#7e4329]">{formatMoney(order.amount)}</span><Button size="sm" variant="outline" className="ml-2 border-[#d6ae8e] text-[#7e4329]" onClick={() => setSelectedOrderId(order.id)}>详情</Button></div>{isSuperAdmin ? <div className="flex gap-2">{order.status === "draft" ? <Button size="sm" variant="outline" onClick={() => transitionOrder.mutate({ id: order.id, projectId: selectedProjectId, targetStatus: "confirmed" })}>确认</Button> : null}{order.status === "confirmed" ? <Button size="sm" variant="outline" onClick={() => transitionOrder.mutate({ id: order.id, projectId: selectedProjectId, targetStatus: "received" })}>收货</Button> : null}</div> : null}</div></CardContent></Card>; }) : <EmptyState text="当前筛选下暂无采购订单。" />}</TabsContent>
          <TabsContent value="inventory" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><p className="font-semibold">库存余额</p><p className="text-xs text-[#8f7566]">余额来自每一笔不可变的收发流水。</p></div><Button size="sm" className="bg-[#6d3421] hover:bg-[#542516]" onClick={() => setInventoryOpen(true)}><Archive className="mr-1 h-4 w-4" />登记</Button></div>{inventoryBalances.length ? inventoryBalances.map(item => <Card key={`${item.itemName}-${item.unit}`} className="border-0 shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><p className="font-semibold">{item.itemName}</p><p className="text-xs text-[#8f7566]">库存成本 {formatMoney(item.totalAmount)}</p></div><p className="text-lg font-semibold text-[#7e4329]">{item.balanceQuantity}<span className="ml-1 text-xs font-normal">{item.unit}</span></p></CardContent></Card>) : <EmptyState text="当前项目暂无库存收发流水。" />}</TabsContent>
          <TabsContent value="suppliers" className="mt-4 space-y-3"><div className="flex items-center justify-between"><div><p className="font-semibold">供应商名录</p><p className="text-xs text-[#8f7566]">前端仅展示已脱敏联系方式。</p></div><Button size="sm" className="bg-[#6d3421] hover:bg-[#542516]" onClick={() => setSupplierOpen(true)}><PackagePlus className="mr-1 h-4 w-4" />新增</Button></div>{suppliers.data?.length ? suppliers.data.map(supplier => <Card key={supplier.id} className="border-0 shadow-sm"><CardContent className="p-4"><p className="font-semibold">{supplier.name}</p><p className="mt-1 text-xs text-[#8f7566]">{supplier.contactName ?? "未登记联系人"}　{supplier.contactPhoneMasked ?? "未登记联系方式"}</p></CardContent></Card>) : <EmptyState text="暂无有效供应商。" />}</TabsContent>
        </Tabs>
      </>}
    </main>
    <Dialog open={Boolean(selectedOrder)} onOpenChange={open => { if (!open) setSelectedOrderId(null); }}><DialogContent className="max-h-[88dvh] max-w-[calc(100%-2rem)] overflow-y-auto rounded-2xl"><DialogHeader><DialogTitle>采购订单详情 · {selectedOrder?.orderNo}</DialogTitle></DialogHeader><div className="space-y-3 text-sm"><div className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-[#f9eddf] p-3"><p className="text-[11px] text-[#8f7566]">采购模式</p><p className="mt-1 font-medium">{selectedOrder?.procurementMode === "small_direct" ? "小额直接采购" : "采购申请转订单"}</p></div><div className="rounded-xl bg-[#f9eddf] p-3"><p className="text-[11px] text-[#8f7566]">当前状态</p><p className="mt-1 font-medium">{selectedOrder ? orderStatus(selectedOrder.status).label : "—"}</p></div></div><div className="rounded-xl border border-[#ead3bb] bg-white p-3"><p className="text-[11px] text-[#8f7566]">物资说明</p><p className="mt-1 font-medium">{selectedOrder?.itemDescription || "采购申请关联订单"}</p><p className="mt-2 text-xs leading-5 text-[#8f7566]">下单时间：{selectedOrder ? formatChinaDateTime(selectedOrder.orderedAt) : "—"}</p><p className="text-xs leading-5 text-[#8f7566]">数量：{selectedOrder?.quantity ?? "—"}　单价：{selectedOrder?.unitPrice === null || selectedOrder?.unitPrice === undefined ? "—" : formatMoney(selectedOrder.unitPrice)}　金额：{selectedOrder ? formatMoney(selectedOrder.amount) : "—"}</p></div><div className="rounded-xl border border-[#ead3bb] bg-white p-3"><p className="font-medium">采购单据</p>{selectedOrder?.documentAttachment ? <a className="mt-2 block break-all text-sm font-medium text-[#7e4329] underline" href={selectedOrder.documentAttachment.url} target="_blank" rel="noreferrer">查看/下载采购单据：{selectedOrder.documentAttachment.fileName}</a> : <p className="mt-2 text-xs text-[#8f7566]">未关联采购单据。</p>}</div><div className="rounded-xl border border-[#ead3bb] bg-white p-3"><p className="font-medium">发票附件</p>{selectedOrder?.hasInvoice ? (selectedOrder.invoiceAttachment ? <a className="mt-2 block break-all text-sm font-medium text-[#7e4329] underline" href={selectedOrder.invoiceAttachment.url} target="_blank" rel="noreferrer">查看/下载发票附件：{selectedOrder.invoiceAttachment.fileName}</a> : <p className="mt-2 text-xs text-[#8f7566]">已登记发票，但未找到归档附件。</p>) : <p className="mt-2 text-xs text-[#8f7566]">本单未登记发票。</p>}</div></div><DialogFooter><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={() => setSelectedOrderId(null)}>关闭</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={requestOpen} onOpenChange={setRequestOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>新建采购申请</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>采购类别</Label><Select value={requestDraft.categoryId} onValueChange={categoryId => setRequestDraft(current => ({ ...current, categoryId }))}><SelectTrigger className="mt-1"><SelectValue placeholder="选择固定类别" /></SelectTrigger><SelectContent>{categories.data?.map(category => <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>)}</SelectContent></Select></div><div><Label>申请金额</Label><Input className="mt-1" inputMode="decimal" value={requestDraft.amount} onChange={event => setRequestDraft(current => ({ ...current, amount: event.target.value }))} /></div><div><Label>采购说明</Label><Input className="mt-1" value={requestDraft.description} onChange={event => setRequestDraft(current => ({ ...current, description: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setRequestOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitRequest} disabled={saveRequest.isPending}>保存</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={smallDirectOpen} onOpenChange={setSmallDirectOpen}>
      <DialogContent className="max-h-[88dvh] max-w-[calc(100%-2rem)] overflow-y-auto rounded-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <DialogHeader><DialogTitle>清单采购录入</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">按采购清单、送货单或验收单填写采购信息。单据照片仅用于审计留档，不生成水印；金额可以由数量×单价自动计算，也可以直接手动填写。</div>
          <div><Label>采购类别</Label><Select value={smallDirectDraft.categoryId} onValueChange={categoryId => setSmallDirectDraft(current => ({ ...current, categoryId }))}><SelectTrigger className="mt-1"><SelectValue placeholder="选择固定类别" /></SelectTrigger><SelectContent>{categories.data?.map(category => <SelectItem key={category.id} value={String(category.id)}>{category.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>物资名称 / 说明</Label><Input className="mt-1" value={smallDirectDraft.itemDescription} maxLength={500} onFocus={event => event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" })} onChange={event => setSmallDirectDraft(current => ({ ...current, itemDescription: event.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-2"><div><Label>数量</Label><Input className="mt-1" inputMode="decimal" value={smallDirectDraft.quantity} onFocus={event => event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" })} onChange={event => setSmallDirectDraft(current => ({ ...current, quantity: event.target.value }))} /></div><div><Label>单价</Label><Input className="mt-1" inputMode="decimal" value={smallDirectDraft.unitPrice} onFocus={event => event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" })} onChange={event => setSmallDirectDraft(current => ({ ...current, unitPrice: event.target.value }))} /></div></div>
          <div className="grid grid-cols-2 gap-2"><div><Label>金额方式</Label><Select value={smallDirectDraft.amountMode} onValueChange={amountMode => setSmallDirectDraft(current => ({ ...current, amountMode: amountMode as "auto" | "manual" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">数量 × 单价自动计算</SelectItem><SelectItem value="manual">手动填写金额</SelectItem></SelectContent></Select></div><div><Label>{smallDirectDraft.amountMode === "manual" ? "手动金额（元）" : "自动金额（元）"}</Label><Input className="mt-1" inputMode="decimal" readOnly={smallDirectDraft.amountMode === "auto"} value={smallDirectDraft.amountMode === "manual" ? smallDirectDraft.manualAmount : (smallDirectDraft.quantity && smallDirectDraft.unitPrice ? String(Number(smallDirectDraft.quantity) * Number(smallDirectDraft.unitPrice)) : "")} placeholder={smallDirectDraft.amountMode === "manual" ? "直接输入金额" : "填写数量和单价后计算"} onChange={event => setSmallDirectDraft(current => ({ ...current, manualAmount: event.target.value }))} /></div></div>
          <div><Label>下单时间</Label><Input className="mt-1" type="datetime-local" value={smallDirectDraft.orderedAt} onFocus={event => event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" })} onChange={event => setSmallDirectDraft(current => ({ ...current, orderedAt: event.target.value }))} /></div>
          <div className="border-t border-[#ead3bb] pt-3"><Label>单据照片（采购清单 / 送货单 / 验收单）</Label><p className="mt-1 text-[11px] leading-4 text-[#8f7566]">仅用手机后置相机拍摄并上传，照片会自动压缩至最长边 1920px、JPEG 质量 0.82；压缩后单张不得超过 5MB。</p><label className="mt-2 flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#d6ae8e] bg-[#fffaf4] p-3 text-center"><input className="sr-only" type="file" accept="image/jpeg,image/png" capture="environment" disabled={uploadPurchaseDocument.isPending} onChange={event => { void uploadPurchaseDocumentFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /><Camera className="h-5 w-5 text-[#8a4b25]" /><span className="mt-1 text-xs font-medium text-[#8a4b25]">{uploadPurchaseDocument.isPending ? "正在上传单据照片…" : "拍摄并上传单据照片"}</span></label><div className="mt-2"><Label>已归档单据照片</Label><Select value={smallDirectDraft.evidenceId} onValueChange={evidenceId => setSmallDirectDraft(current => ({ ...current, evidenceId }))}><SelectTrigger className="mt-1"><SelectValue placeholder="上传后选择单据照片" /></SelectTrigger><SelectContent>{purchaseEvidences.data?.map(evidence => <SelectItem key={evidence.id} value={String(evidence.id)}>{evidence.fileName} · {evidence.description}</SelectItem>)}</SelectContent></Select></div></div>
          <div className="rounded-xl border border-[#ead3bb] bg-[#fffaf4] p-3"><Label>发票情况</Label><Select value={smallDirectDraft.hasInvoice ? "yes" : "no"} onValueChange={value => setSmallDirectDraft(current => ({ ...current, hasInvoice: value === "yes", invoiceEvidenceId: value === "yes" ? current.invoiceEvidenceId : "" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="no">无发票（默认）</SelectItem><SelectItem value="yes">有发票，需归档附件</SelectItem></SelectContent></Select>{smallDirectDraft.hasInvoice ? <div className="mt-3 space-y-2 border-t border-[#ead3bb] pt-3"><p className="text-[11px] leading-4 text-[#8f7566]">发票照片必须用后置相机直拍；电子发票可单独选择 PDF（不超过 15MB）。保存采购订单前必须关联其中一份发票附件。</p><div className="grid grid-cols-2 gap-2"><label className="flex min-h-16 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#d6ae8e] bg-white p-2 text-center"><input className="sr-only" type="file" accept="image/jpeg,image/png" capture="environment" disabled={uploadPurchaseDocument.isPending} onChange={event => { void uploadPurchaseDocumentFile(event.target.files?.[0], "invoice"); event.currentTarget.value = ""; }} /><Camera className="h-4 w-4 text-[#8a4b25]" /><span className="mt-1 text-[11px] font-medium text-[#8a4b25]">拍摄发票照片</span></label><label className="flex min-h-16 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#d6ae8e] bg-white p-2 text-center"><input className="sr-only" type="file" accept="application/pdf" disabled={uploadPurchaseDocument.isPending} onChange={event => { void uploadPurchaseDocumentFile(event.target.files?.[0], "invoice"); event.currentTarget.value = ""; }} /><ReceiptText className="h-4 w-4 text-[#8a4b25]" /><span className="mt-1 text-[11px] font-medium text-[#8a4b25]">选择电子发票 PDF</span></label></div><div><Label>已归档发票附件</Label><Select value={smallDirectDraft.invoiceEvidenceId || "UNSELECTED_INVOICE"} onValueChange={invoiceEvidenceId => setSmallDirectDraft(current => ({ ...current, invoiceEvidenceId: invoiceEvidenceId === "UNSELECTED_INVOICE" ? "" : invoiceEvidenceId }))}><SelectTrigger className="mt-1"><SelectValue placeholder="上传后选择发票附件" /></SelectTrigger><SelectContent><SelectItem value="UNSELECTED_INVOICE">请选择</SelectItem>{purchaseEvidences.data?.filter(evidence => evidence.description.includes("发票")).map(evidence => <SelectItem key={evidence.id} value={String(evidence.id)}>{evidence.fileName} · {evidence.description}</SelectItem>)}</SelectContent></Select></div></div> : <p className="mt-2 text-[11px] leading-4 text-[#8f7566]">默认不添加发票；如后续取得发票，请重新按有发票记录采购单。</p>}</div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setSmallDirectOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitSmallDirectOrder} disabled={createSmallDirectOrder.isPending || uploadPurchaseDocument.isPending}>{createSmallDirectOrder.isPending ? "正在保存…" : "保存清单采购"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={orderOpen} onOpenChange={setOrderOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>从批准申请创建订单</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>采购申请</Label><Select value={orderDraft.requestId} onValueChange={requestId => { const request = requests.data?.find(item => item.id === Number(requestId)); setOrderDraft(current => ({ ...current, requestId, amount: request ? String(request.amount) : current.amount })); }}><SelectTrigger className="mt-1"><SelectValue placeholder="选择已批准申请" /></SelectTrigger><SelectContent>{requests.data?.filter(request => request.status === "approved").map(request => <SelectItem key={request.id} value={String(request.id)}>{request.requestNo} · {formatMoney(request.amount)}</SelectItem>)}</SelectContent></Select></div><div><Label>供应商（可选）</Label><Select value={orderDraft.supplierId || "none"} onValueChange={supplierId => setOrderDraft(current => ({ ...current, supplierId: supplierId === "none" ? "" : supplierId }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">暂不关联供应商</SelectItem>{suppliers.data?.map(supplier => <SelectItem key={supplier.id} value={String(supplier.id)}>{supplier.name}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-2"><div><Label>订单金额</Label><Input className="mt-1" inputMode="decimal" value={orderDraft.amount} onChange={event => setOrderDraft(current => ({ ...current, amount: event.target.value }))} /></div><div><Label>下单时间</Label><Input className="mt-1" type="datetime-local" value={orderDraft.orderedAt} onChange={event => setOrderDraft(current => ({ ...current, orderedAt: event.target.value }))} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setOrderOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitOrder} disabled={createOrder.isPending}>创建订单</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={inventoryOpen} onOpenChange={setInventoryOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>登记库存流水</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>收发类型</Label><Select value={inventoryDraft.transactionType} onValueChange={value => setInventoryDraft(current => ({ ...current, transactionType: value as "inbound" | "outbound" | "return" }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inbound">入库</SelectItem><SelectItem value="outbound">领用</SelectItem><SelectItem value="return">退库</SelectItem></SelectContent></Select></div>{inventoryDraft.transactionType === "inbound" ? <div className="grid grid-cols-2 gap-2"><div><Label>关联申请（可选）</Label><Select value={inventoryDraft.requestId || "none"} onValueChange={requestId => setInventoryDraft(current => ({ ...current, requestId: requestId === "none" ? "" : requestId }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不关联申请</SelectItem>{requests.data?.filter(request => ["approved", "ordered", "received"].includes(request.status)).map(request => <SelectItem key={request.id} value={String(request.id)}>{request.requestNo}</SelectItem>)}</SelectContent></Select></div><div><Label>关联订单（可选）</Label><Select value={inventoryDraft.purchaseOrderId || "none"} onValueChange={purchaseOrderId => setInventoryDraft(current => ({ ...current, purchaseOrderId: purchaseOrderId === "none" ? "" : purchaseOrderId }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不关联订单</SelectItem>{orders.data?.filter(order => ["confirmed", "received"].includes(order.status)).map(order => <SelectItem key={order.id} value={String(order.id)}>{order.orderNo}</SelectItem>)}</SelectContent></Select></div></div> : null}<div><Label>物料名称</Label><Input className="mt-1" value={inventoryDraft.itemName} onChange={event => setInventoryDraft(current => ({ ...current, itemName: event.target.value }))} /></div><div className="grid grid-cols-3 gap-2"><div><Label>单位</Label><Input className="mt-1" value={inventoryDraft.unit} onChange={event => setInventoryDraft(current => ({ ...current, unit: event.target.value }))} /></div><div><Label>数量</Label><Input className="mt-1" inputMode="decimal" value={inventoryDraft.quantity} onChange={event => setInventoryDraft(current => ({ ...current, quantity: event.target.value }))} /></div><div><Label>单价</Label><Input className="mt-1" inputMode="decimal" value={inventoryDraft.unitCost} onChange={event => setInventoryDraft(current => ({ ...current, unitCost: event.target.value }))} /></div></div><div><Label>发生时间</Label><Input className="mt-1" type="datetime-local" value={inventoryDraft.occurredAt} onChange={event => setInventoryDraft(current => ({ ...current, occurredAt: event.target.value }))} /></div><div><Label>备注</Label><Input className="mt-1" value={inventoryDraft.remarks} onChange={event => setInventoryDraft(current => ({ ...current, remarks: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setInventoryOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitInventory} disabled={saveInventory.isPending}>登记</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={settlementOpen} onOpenChange={setSettlementOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>登记采购结算</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>采购订单</Label><Select value={settlementDraft.orderId} onValueChange={orderId => { const order = orders.data?.find(item => item.id === Number(orderId)); const remainingAmount = settlements.data?.totalsByOrder[orderId]?.remainingAmount ?? Number(order?.amount ?? 0); setSettlementDraft(current => ({ ...current, orderId, amount: String(remainingAmount) })); }}><SelectTrigger className="mt-1"><SelectValue placeholder="选择已收货订单" /></SelectTrigger><SelectContent>{orders.data?.filter(order => ["received", "closed"].includes(order.status) && (settlements.data?.totalsByOrder[String(order.id)]?.remainingAmount ?? Number(order.amount)) > 0).map(order => <SelectItem key={order.id} value={String(order.id)}>{order.orderNo} · 待结算 {formatMoney(settlements.data?.totalsByOrder[String(order.id)]?.remainingAmount ?? Number(order.amount))}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-2"><div><Label>本次结算金额</Label><Input className="mt-1" inputMode="decimal" value={settlementDraft.amount} onChange={event => setSettlementDraft(current => ({ ...current, amount: event.target.value }))} /></div><div><Label>结算时间</Label><Input className="mt-1" type="datetime-local" value={settlementDraft.settledAt} onChange={event => setSettlementDraft(current => ({ ...current, settledAt: event.target.value }))} /></div></div><div><Label>备注</Label><Input className="mt-1" value={settlementDraft.remarks} onChange={event => setSettlementDraft(current => ({ ...current, remarks: event.target.value }))} placeholder="可选" /></div><p className="rounded-lg bg-[#f9eddf] p-3 text-xs leading-5 text-[#80543d]">结算金额由服务端校验订单待结算余额，并自动写入项目成本流水和审计日志。</p></div><DialogFooter><Button variant="outline" onClick={() => setSettlementOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitSettlement} disabled={recordSettlement.isPending}>{recordSettlement.isPending ? "正在登记…" : "登记结算"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}><DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl"><DialogHeader><DialogTitle>新增供应商</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>供应商名称</Label><Input className="mt-1" value={supplierDraft.name} onChange={event => setSupplierDraft(current => ({ ...current, name: event.target.value }))} /></div><div className="grid grid-cols-2 gap-2"><div><Label>联系人</Label><Input className="mt-1" value={supplierDraft.contactName} onChange={event => setSupplierDraft(current => ({ ...current, contactName: event.target.value }))} /></div><div><Label>脱敏电话</Label><Input className="mt-1" placeholder="****1234" value={supplierDraft.contactPhoneMasked} onChange={event => setSupplierDraft(current => ({ ...current, contactPhoneMasked: event.target.value }))} /></div></div></div><DialogFooter><Button variant="outline" onClick={() => setSupplierOpen(false)}>取消</Button><Button className="bg-[#6d3421] hover:bg-[#542516]" onClick={submitSupplier} disabled={saveSupplier.isPending}>保存</Button></DialogFooter></DialogContent></Dialog>
  </div></div>;
}

/** 统一的业务空态，避免在未授权或无数据时留下误导性的占位数字。 */
function EmptyState({ text }: { text: string }) { return <Card className="border-dashed border-[#e3cbb4] bg-[#fffaf4]"><CardContent className="p-7 text-center text-sm text-[#8f7566]">{text}</CardContent></Card>; }
