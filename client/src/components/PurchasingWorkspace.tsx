import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BusinessWorkspaceNavigation } from "./BusinessWorkspaceNavigation";
import {
  FinancePagination,
  useFinancePagination,
} from "./FinanceWorkspaceNavigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { trpc } from "@/lib/trpc";
import { downloadCurrentFilteredCsv } from "@/lib/a4Print";
import {
  formatChinaDateTime,
  toChinaDateInput,
  toDeviceDateTimeInput,
} from "@/lib/businessTime";
import { getUserFacingErrorMessage } from "@/lib/userFacingError";
import {
  PURCHASING_TABS,
  createPurchasingFilter,
  matchesPurchasingFilter,
  printPurchasingHalfA4,
  printPurchasingRows,
  purchasingStatusLabel as statusLabel,
  type PurchasingTab,
} from "@/lib/purchasingWorkspace";
import { amountToChineseUppercase } from "@shared/purchasingRules";
import { formatAmount, formatQuantity } from "@shared/numberFormat";

export interface PurchasingWorkspaceProps {
  projectId: number;
  projectName: string;
  active?: boolean;
  isSuperAdmin: boolean;
  onOpenLegacyImport?: () => void;
  onDownloadLegacyTemplate?: () => void;
  onOpenMobileEntry?: () => void;
  /** Includes in-flight writes/uploads; parent must confirm before project/module unmount. */
  onDirtyChange?: (dirty: boolean) => void;
}
type FormKind =
  | "request"
  | "order"
  | "basis"
  | "inbound"
  | "outbound"
  | "return"
  | "payment"
  | "document"
  | "invoice"
  | "supplier";
const emptyDraft = () => ({
  orderId: "",
  requestId: "",
  categoryId: "",
  supplierId: "",
  itemName: "",
  description: "",
  unit: "件",
  quantity: "",
  unitCost: "0",
  amount: "",
  occurredAt: toDeviceDateTimeInput(),
  reason: "",
  remarks: "",
  evidenceId: "",
  originalOutboundId: "",
  contactName: "",
  contactPhoneMasked: "",
  organizationId: "",
  unifiedSocialCreditCode: "",
  supplierStatus: "active",
});
const money = (v: unknown) => `¥${formatAmount(v as number | string | null | undefined)}`;
export function PurchasingEvidencePreview({
  file,
  label,
}: {
  file: { url: string; fileName?: string | null; mimeType?: string | null };
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {label} · {file.fileName}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            当前项目授权的短时站内预览，不进入导出。
          </p>
          {file.mimeType === "application/pdf" ||
          /\.pdf$/i.test(file.fileName ?? "") ? (
            <iframe
              title={file.fileName ?? label}
              src={file.url}
              className="h-[65dvh] w-full"
            />
          ) : (
            <img
              alt={file.fileName ?? label}
              src={file.url}
              className="max-h-[65dvh] max-w-full object-contain"
            />
          )}
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>关闭预览</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function PurchasingWorkspace({
  projectId,
  projectName,
  active = true,
  isSuperAdmin,
  onOpenLegacyImport,
  onDownloadLegacyTemplate,
  onOpenMobileEntry,
  onDirtyChange,
}: PurchasingWorkspaceProps) {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<PurchasingTab>("overview");
  const [filters, setFilters] = useState(
    () =>
      Object.fromEntries(
        PURCHASING_TABS.map(t => [t.value, createPurchasingFilter(t.value)])
      ) as Record<PurchasingTab, ReturnType<typeof createPurchasingFilter>>
  );
  const [form, setForm] = useState<FormKind | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [draftProjectId, setDraftProjectId] = useState(projectId);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [readingUpload, setReadingUpload] = useState(false);
  const previousProject = useRef(projectId);
  const initialDraft = useRef(JSON.stringify(draft));
  const formRevision = useRef(0);
  const liveProject = useRef(projectId);
  liveProject.current = projectId;
  // Compare every editable field, including selectors, phone, unit, remarks and date.
  const dirty = form !== null && JSON.stringify(draft) !== initialDraft.current;
  useEffect(() => {
    if (previousProject.current === projectId) return;
    previousProject.current = projectId;
    if (dirty)
      toast.warning(
        "项目已切换：未保存表单仍属于原项目，请返回原项目或放弃草稿；禁止写入新项目。"
      );
    else {
      setForm(null);
      setDraft(emptyDraft());
      setDraftProjectId(projectId);
    }
  }, [projectId, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const input = useMemo(() => ({ projectId }), [projectId]);
  const enabled = active && projectId > 0;
  const capabilities = trpc.purchasing.capabilities.useQuery(undefined, {
    enabled: active,
    retry: false,
  });
  const categories = trpc.purchasing.categories.useQuery(undefined, {
    enabled: active,
    retry: false,
  });
  const orders = trpc.purchasing.listOrders.useQuery(input, {
    enabled:
      enabled &&
      (tab !== "suppliers" ||
        [
          "order",
          "basis",
          "inbound",
          "payment",
          "document",
          "invoice",
        ].includes(form ?? "")),
    retry: false,
  });
  const requests = trpc.purchasing.listRequests.useQuery(input, {
    enabled:
      enabled &&
      (["overview", "orders"].includes(tab) ||
        form === "order" ||
        form === "request"),
    retry: false,
  });
  const inventory = trpc.purchasing.listInventory.useQuery(input, {
    enabled:
      enabled &&
      (["overview", "receipts", "inventory"].includes(tab) ||
        ["inbound", "outbound", "return"].includes(form ?? "")),
    retry: false,
  });
  const settlements = trpc.purchasing.listSettlements.useQuery(input, {
    enabled: enabled && ["overview", "settlements"].includes(tab),
    retry: false,
  });
  const suppliers = trpc.purchasing.listSuppliers.useQuery(undefined, {
    enabled:
      active &&
      isSuperAdmin &&
      (tab === "suppliers" || form === "order" || form === "supplier"),
    retry: false,
  });
  const evidences = trpc.purchasing.listPurchaseEvidences.useQuery(input, {
    enabled:
      enabled &&
      form !== null &&
      ["inbound", "document", "invoice"].includes(form),
    retry: false,
  });
  const inventoryData = Array.isArray(inventory.data)
    ? undefined
    : inventory.data;
  const stock = inventoryData?.transactions ?? [];
  const balances = inventoryData?.balances ?? [];
  const orderRows = orders.data ?? [];
  const f = filters[tab];
  const resetKey = JSON.stringify([projectId, tab, f]);
  const filteredOrders = orderRows.filter(o =>
    matchesPurchasingFilter(
      {
        text: `${o.orderNo} ${o.itemDescription ?? ""} ${o.assetLabel ?? ""}`,
        status: tab === "receipts" ? o.receiptStatus : o.status,
        date: o.orderedAt,
        categoryId: o.categoryId,
        purchaser: o.purchaserName,
        uploader: o.documentUploadedByName ?? o.createdByName,
        hasInvoice: o.hasInvoice,
      },
      f
    )
  );
  const filteredRequests = (requests.data ?? []).filter(r =>
    matchesPurchasingFilter(
      {
        text: `${r.requestNo} ${r.description}`,
        status: r.status,
        date: r.createdAt,
        categoryId: r.categoryId,
      },
      f
    )
  );
  const filteredStock = stock.filter(r =>
    matchesPurchasingFilter(
      {
        text: `${r.transactionNo} ${r.itemName} ${r.remarks ?? ""}`,
        status: r.transactionType,
        date: r.occurredAt,
      },
      f
    )
  );
  const filteredBalances = balances.filter(
    r => !f.search || `${r.itemName} ${r.unit}`.includes(f.search)
  );
  const filteredPayments = (settlements.data?.records ?? []).filter(r =>
    matchesPurchasingFilter(
      {
        text: `${r.recordNo} ${r.sourceId ?? ""} ${r.remarks ?? ""}`,
        status: r.settlementStatus,
        date: r.occurredAt,
      },
      f
    )
  );
  const filteredSuppliers = (suppliers.data ?? []).filter(r =>
    matchesPurchasingFilter(
      {
        text: `${r.name} ${r.contactName ?? ""} ${r.unifiedSocialCreditCode ?? ""}`,
        status: r.status,
      },
      f,
      true
    )
  );
  const orderPage = useFinancePagination(filteredOrders, resetKey);
  const requestPage = useFinancePagination(filteredRequests, resetKey);
  const stockPage = useFinancePagination(filteredStock, resetKey);
  const balancePage = useFinancePagination(filteredBalances, resetKey);
  const paymentPage = useFinancePagination(filteredPayments, resetKey);
  const supplierPage = useFinancePagination(filteredSuppliers, resetKey);
  const invoiceOrders = orderRows.filter(o => o.status !== "void");
  const invoicePage = useFinancePagination(
    invoiceOrders,
    JSON.stringify([projectId, "invoice-orders"])
  );
  const canApprove = capabilities.data?.canApprove === true;
  const canStock = capabilities.data?.canManageInventory === true;
  const canPay = capabilities.data?.canRecordPayment === true;
  const permissionNote = !canStock
    ? "当前账号可查看库存，但未获“仓储收发”写入权限"
    : "库存写入逐次由服务端校验岗位和项目";
  async function refresh() {
    await Promise.all([
      utils.purchasing.listOrders.invalidate(),
      utils.purchasing.listRequests.invalidate(),
      utils.purchasing.listInventory.invalidate(),
      utils.purchasing.listSettlements.invalidate(),
      utils.purchasing.listPurchaseEvidences.invalidate(),
      utils.purchasing.listSuppliers.invalidate(),
    ]);
  }
  const failure = (error: unknown) =>
    toast.error(getUserFacingErrorMessage(error, "采购操作未完成"));
  const completed = async () => {
    toast.success("采购业务已保存，历史记录不会批量重算");
    formRevision.current++;
    setForm(null);
    setDraft(emptyDraft());
    setUploadedFileName("");
    await refresh();
  };
  const saveRequest = trpc.purchasing.saveRequest.useMutation({
    onSuccess: completed,
    onError: failure,
  });
  const createOrder = trpc.purchasing.createOrder.useMutation({
    onSuccess: completed,
    onError: failure,
  });
  const transitionRequest = trpc.purchasing.transitionRequest.useMutation({
    onSuccess: refresh,
    onError: failure,
  });
  const transitionOrder = trpc.purchasing.transitionOrder.useMutation({
    onSuccess: refresh,
    onError: failure,
  });
  const configureBasis = trpc.purchasing.configureReceiptBasis.useMutation({
    onSuccess: completed,
    onError: failure,
  });
  const saveStock = trpc.purchasing.saveInventoryTransaction.useMutation({
    onSuccess: completed,
    onError: failure,
  });
  const pay = trpc.purchasing.recordSettlement.useMutation({
    onSuccess: completed,
    onError: failure,
  });
  const bindEvidence = trpc.purchasing.bindOrderEvidence.useMutation({
    onSuccess: completed,
    onError: failure,
  });
  const upload = trpc.purchasing.uploadPurchaseDocument.useMutation({
    onError: failure,
  });
  const saveSupplier = trpc.purchasing.saveSupplier.useMutation({
    onSuccess: completed,
    onError: failure,
  });
  const pending =
    readingUpload ||
    [
      saveRequest,
      createOrder,
      transitionRequest,
      transitionOrder,
      configureBasis,
      saveStock,
      pay,
      bindEvidence,
      upload,
      saveSupplier,
    ].some(m => m.isPending);
  const guarded = dirty || pending;
  useEffect(() => {
    onDirtyChange?.(guarded);
  }, [guarded, onDirtyChange]);
  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange]
  );
  function open(
    kind: FormKind,
    orderId?: number,
    values: Partial<ReturnType<typeof emptyDraft>> = {}
  ) {
    if (pending) return false;
    if (dirty && !window.confirm("放弃当前未保存的采购表单？")) return false;
    if (kind === "supplier" && !isSuperAdmin) return false;
    const o = orderRows.find(o => o.id === orderId);
    const next = {
      ...emptyDraft(),
      orderId: o ? String(o.id) : "",
      requestId: o?.requestId ? String(o.requestId) : "",
      itemName: o?.inventoryItemName ?? "",
      unit: o?.inventoryUnit ?? "件",
      quantity: o?.receiptExpectedQuantity
        ? String(
            Math.max(0, Number(o.receiptExpectedQuantity) - o.receivedQuantity)
          )
        : (o?.quantity ?? ""),
      unitCost: o?.unitPrice ?? "0",
      amount: o ? String(o.remainingAmount) : "",
      ...values,
    };
    initialDraft.current = JSON.stringify(next);
    formRevision.current++;
    setDraft(next);
    setDraftProjectId(projectId);
    setUploadedFileName("");
    setForm(kind);
    return true;
  }
  function close() {
    if (pending) return;
    if (dirty && !window.confirm("放弃未保存的采购表单？")) return;
    formRevision.current++;
    setForm(null);
    setDraft(emptyDraft());
    setUploadedFileName("");
  }
  function changeOrder(id: string) {
    if (pending) return;
    setUploadedFileName("");
    const o = orderRows.find(o => String(o.id) === id);
    setDraft(d => ({
      ...d,
      orderId: id,
      evidenceId: "",
      requestId: o?.requestId ? String(o.requestId) : "",
      itemName: o?.inventoryItemName ?? "",
      unit: o?.inventoryUnit ?? "件",
      quantity: o?.receiptExpectedQuantity
        ? String(
            Math.max(0, Number(o.receiptExpectedQuantity) - o.receivedQuantity)
          )
        : (o?.quantity ?? ""),
      unitCost: o?.unitPrice ?? "0",
      amount: o ? String(o.remainingAmount) : "",
    }));
  }
  async function uploadFile(file?: File) {
    if (!file || !form || pending) return;
    if (["document", "invoice"].includes(form) && !draft.orderId)
      return toast.error("请先选择要绑定的采购订单，再上传附件");
    const revision = formRevision.current;
    const uploadProjectId = draftProjectId;
    if (draftProjectId !== projectId)
      return toast.error("表单属于原项目，不能在新项目上传或绑定");
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type))
      return toast.error("仅支持 JPG/PNG/PDF");
    if (file.size > (file.type === "application/pdf" ? 15 : 5) * 1024 * 1024)
      return toast.error("图片最多5MB，PDF最多15MB");
    try {
      setReadingUpload(true);
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await upload.mutateAsync({
        projectId: uploadProjectId,
        fileName: file.name,
        mimeType: file.type as "image/jpeg" | "image/png" | "application/pdf",
        base64Data,
        description:
          form === "invoice" ? "采购发票原件补传" : "采购原单据/验收凭证补传",
        attachmentKind: form === "invoice" ? "invoice" : "document",
      });
      if (
        formRevision.current !== revision ||
        liveProject.current !== uploadProjectId
      ) {
        toast.warning(
          "附件已归档原项目，当前草稿已变化；请回原项目选择归档附件完成绑定"
        );
        return;
      }
      setDraft(d => ({ ...d, evidenceId: String(result.id) }));
      setUploadedFileName(file.name);
      await utils.purchasing.listPurchaseEvidences.invalidate();
      toast.success("已受控归档；请保存完成订单/入库绑定");
    } catch (error) {
      failure(error);
    } finally {
      setReadingUpload(false);
    }
  }
  function submit() {
    if (!form || !projectId || pending) return;
    if (draftProjectId !== projectId)
      return toast.error("未保存表单属于原项目，请返回原项目或放弃后重新填写");
    const amount = Number(draft.amount),
      quantity = Number(draft.quantity),
      unitCost = Number(draft.unitCost);
    const date = new Date(draft.occurredAt);
    if (Number.isNaN(date.getTime())) return toast.error("请填写有效业务时间");
    if (form === "request")
      return saveRequest.mutate({
        id: draft.requestId ? Number(draft.requestId) : undefined,
        projectId,
        categoryId: Number(draft.categoryId),
        amount,
        description: draft.description,
      });
    if (form === "order")
      return createOrder.mutate({
        projectId,
        requestId: Number(draft.requestId),
        supplierId: draft.supplierId ? Number(draft.supplierId) : null,
        amount,
        orderedAt: date.toISOString(),
      });
    if (form === "basis")
      return configureBasis.mutate({
        projectId,
        orderId: Number(draft.orderId),
        itemName: draft.itemName,
        unit: draft.unit,
        expectedQuantity: quantity,
        reason: draft.reason,
      });
    if (["inbound", "outbound", "return"].includes(form))
      return saveStock.mutate({
        projectId,
        purchaseOrderId:
          form === "inbound" && draft.orderId ? Number(draft.orderId) : null,
        requestId:
          form === "inbound" && draft.orderId && draft.requestId
            ? Number(draft.requestId)
            : null,
        evidenceId: draft.evidenceId ? Number(draft.evidenceId) : null,
        originalOutboundId:
          form === "return" ? Number(draft.originalOutboundId) : null,
        exceptionReason: draft.reason.trim() || null,
        transactionType: form as "inbound" | "outbound" | "return",
        itemName: draft.itemName,
        unit: draft.unit,
        quantity,
        unitCost,
        occurredAt: date.toISOString(),
        remarks: draft.remarks || null,
      });
    if (form === "payment")
      return pay.mutate({
        projectId,
        orderId: Number(draft.orderId),
        amount,
        settledAt: date.toISOString(),
        remarks: draft.remarks || null,
      });
    if (form === "document" || form === "invoice")
      return bindEvidence.mutate({
        projectId,
        orderId: Number(draft.orderId),
        evidenceId: Number(draft.evidenceId),
        attachmentKind: form,
        reason: draft.reason,
      });
    if (form === "supplier") {
      if (!isSuperAdmin) return toast.error("供应商维护仅限超级管理员");
      return saveSupplier.mutate({
        id: draft.supplierId ? Number(draft.supplierId) : undefined,
        organizationId: draft.organizationId
          ? Number(draft.organizationId)
          : null,
        unifiedSocialCreditCode: draft.unifiedSocialCreditCode || null,
        name: draft.itemName,
        contactName: draft.contactName || null,
        contactPhoneMasked: draft.contactPhoneMasked || null,
        status: draft.supplierStatus as "active" | "disabled",
      });
    }
  }
  const scope = `${projectName} · ${PURCHASING_TABS.find(t => t.value === tab)?.label} · ${tab === "suppliers" ? "档案不限制创建日期" : `${f.dateFrom || "不限起日"}至${f.dateTo || "不限止日"}`} · 检索${f.search || "全部"} · 状态${statusLabel(f.status)} · 类别${f.categoryId === "all" ? "全部" : (categories.data?.find(category => String(category.id) === f.categoryId)?.name ?? "未登记")} · 采购者${f.purchaser || "全部"} · 上传人${f.uploader || "全部"} · 发票${f.invoice === "all" ? "全部" : f.invoice === "yes" ? "声明有发票" : "无发票"}`;
  const orderHeaders = [
    "订单号",
    "物资",
    "采购者",
    "类别",
    "日期",
    "订单金额",
    "业务状态",
    "实物验收",
    "实际付款",
    "未付余额",
    "发票归档",
  ];
  const orderCells = filteredOrders.map(o => [
    o.orderNo,
    o.itemDescription,
    o.purchaserName,
    o.categoryName,
    formatChinaDateTime(o.orderedAt),
    formatAmount(o.amount),
    statusLabel(o.status),
    `${statusLabel(o.receiptStatus)} (${formatQuantity(o.receivedQuantity)}/${o.receiptExpectedQuantity == null ? "未核验" : formatQuantity(o.receiptExpectedQuantity)})`,
    formatAmount(o.paidAmount),
    formatAmount(o.remainingAmount),
    o.invoiceEvidenceId ? "已绑定" : o.hasInvoice ? "声明有票待补传" : "无票",
  ]);
  const stockHeaders = [
    "流水号",
    "类型",
    "物料",
    "单位",
    "数量",
    "记账成本单价",
    "流水估值金额",
    "业务时间",
    "成本版本",
    "原领用ID",
    "订单ID",
    "授权例外原因",
  ];
  const stockCells = filteredStock.map(r => [
    r.transactionNo,
    statusLabel(r.transactionType),
    r.itemName,
    r.unit,
    formatQuantity(r.quantity),
    formatAmount(r.costingUnitCost ?? r.unitCost),
    formatAmount(r.amount),
    formatChinaDateTime(r.occurredAt),
    r.costRuleVersion,
    r.originalOutboundId,
    r.purchaseOrderId,
    r.exceptionReason,
  ]);
  const paymentHeaders = [
    "原采购结算凭证号",
    "订单ID",
    "实际付款金额",
    "实际付款时间",
    "流水状态",
    "备注",
  ];
  const paymentCells = filteredPayments.map(r => [
    r.recordNo,
    r.sourceId,
    formatAmount(r.amount),
    formatChinaDateTime(r.occurredAt),
    statusLabel(r.settlementStatus),
    r.remarks,
  ]);
  const supplierHeaders = [
    "供应商名称",
    "统一社会信用代码",
    "联系人",
    "联系电话",
    "档案状态",
  ];
  const supplierCells = filteredSuppliers.map(r => [
    r.name,
    r.unifiedSocialCreditCode,
    r.contactName,
    r.contactPhoneMasked,
    statusLabel(r.status),
  ]);
  const requestHeaders = ["申请号", "说明", "申请金额", "审批/申请状态"];
  const requestCells = filteredRequests.map(r => [
    r.requestNo,
    r.description,
    formatAmount(r.amount),
    statusLabel(r.status),
  ]);
  function outputOverview(print: boolean) {
    const today = toChinaDateInput(new Date());
    const rows = [
      [
        "当天采购订单金额",
        today,
        orderRows
          .filter(
            o => toChinaDateInput(o.orderedAt) === today && o.status !== "void"
          )
          .reduce((s, o) => s + Number(o.amount), 0),
      ],
      [
        "全部未付余额",
        "全部有效订单",
        orderRows
          .filter(o => o.status !== "void")
          .reduce((s, o) => s + o.remainingAmount, 0),
      ],
      [
        "本月实际付款",
        today.slice(0, 7),
        (settlements.data?.records ?? [])
          .filter(
            r =>
              ["paid", "partial"].includes(r.settlementStatus) &&
              toChinaDateInput(r.occurredAt).slice(0, 7) === today.slice(0, 7)
          )
          .reduce((s, r) => s + Number(r.amount), 0),
      ],
      [
        "累计库存历史/版本估值",
        "累计原始流水+版本化新规则，不重算历史",
        balances.reduce((s, r) => s + r.totalAmount, 0),
      ],
    ];
    if (print)
      printPurchasingRows(
        "采购总览",
        `${projectName} · 当天/当月/累计独立口径，金额不可相加`,
        ["指标", "范围", "金额"],
        rows
      );
    else
      downloadCurrentFilteredCsv(
        "采购总览-当前范围.csv",
        ["指标", "范围", "金额"],
        rows
      );
  }
  function output(
    print: boolean,
    kind: "current" | "requests" | "balances" = "current"
  ) {
    if (tab === "suppliers" && !isSuperAdmin) return;
    let title: string =
        PURCHASING_TABS.find(t => t.value === tab)?.label ?? "采购台账",
      headers = orderHeaders,
      cells: (string | number | null | undefined)[][] = orderCells;
    if (kind === "requests") {
      title = "采购申请";
      headers = requestHeaders;
      cells = requestCells;
    } else if (kind === "balances") {
      title = "累计库存余额";
      headers = ["物料", "单位", "累计数量", "累计历史/版本化估值", "规则说明"];
      cells = filteredBalances.map(r => [
        r.itemName,
        r.unit,
        formatQuantity(r.balanceQuantity),
        formatAmount(r.totalAmount),
        r.valuationLabel,
      ]);
    } else if (tab === "inventory") {
      headers = stockHeaders;
      cells = stockCells;
    } else if (tab === "settlements") {
      headers = paymentHeaders;
      cells = paymentCells;
    } else if (tab === "suppliers") {
      headers = supplierHeaders;
      cells = supplierCells;
    }
    if (print)
      printPurchasingRows(
        title,
        kind === "balances"
          ? `${projectName} · 累计余额（不按流水日期截断），物料检索：${f.search || "全部"}`
          : scope,
        headers,
        cells
      );
    else downloadCurrentFilteredCsv(`${title}-全部筛选.csv`, headers, cells);
  }
  function field(
    key: keyof ReturnType<typeof emptyDraft>,
    label: string,
    type = "text",
    readOnly = false
  ) {
    return (
      <div className="min-w-0">
        <Label>{label}</Label>
        <Input
          aria-label={label}
          className="mt-1 w-full min-w-0"
          type={type}
          value={draft[key]}
          readOnly={readOnly}
          disabled={pending || draftProjectId !== projectId}
          onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
        />
      </div>
    );
  }
  function selectField(
    key: keyof ReturnType<typeof emptyDraft>,
    label: string,
    options: { value: string; label: string }[],
    onChange?: (v: string) => void
  ) {
    return (
      <div className="min-w-0">
        <Label>{label}</Label>
        <select
          aria-label={label}
          className="mt-1 min-h-10 w-full min-w-0 max-w-full rounded-md border bg-background p-2 text-sm"
          value={draft[key]}
          disabled={pending || draftProjectId !== projectId}
          onChange={e =>
            onChange
              ? onChange(e.target.value)
              : setDraft(d => ({ ...d, [key]: e.target.value }))
          }
        >
          <option value="">请选择</option>
          {options.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  function pagination(
    p: ReturnType<typeof useFinancePagination>,
    label: string
  ) {
    return (
      <FinancePagination
        page={p.page}
        pageSize={p.pageSize}
        total={p.total}
        onPageChange={p.setPage}
        onPageSizeChange={p.setPageSize}
        label={label}
      />
    );
  }
  const currentQueries =
    tab === "suppliers"
      ? isSuperAdmin
        ? [suppliers]
        : []
      : tab === "inventory" || tab === "receipts"
        ? [orders, inventory]
        : tab === "orders"
          ? [orders, requests]
          : tab === "settlements"
            ? [orders, settlements]
            : [orders, requests, inventory, settlements];
  const queryError = currentQueries.find(q => q.isError);
  const loading = currentQueries.some(q => q.isLoading);
  return (
    <section
      aria-label="采购仓储闭环工作区"
      className="w-full min-w-0 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">采购与仓储 · 可追溯业务闭环</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            申请审批、订单业务、实物验收与实际付款分别记录；订单成本、实际付款、库存估值不可相加。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (pending) return;
              if (
                dirty &&
                !window.confirm("打开原手机入口前放弃未保存采购表单？")
              )
                return;
              if (dirty) {
                formRevision.current++;
                setForm(null);
                setDraft(emptyDraft());
              }
              if (onOpenMobileEntry) onOpenMobileEntry();
              else
                window.location.assign(
                  `/mobile/purchasing?projectId=${projectId}`
                );
            }}
          >
            清单采购 / 原手机入口
          </Button>
          {onDownloadLegacyTemplate && (
            <Button variant="outline" onClick={onDownloadLegacyTemplate}>
              下载原导入模板
            </Button>
          )}
          {onOpenLegacyImport && isSuperAdmin && (
            <Button variant="outline" onClick={onOpenLegacyImport}>
              Excel历史导入
            </Button>
          )}
          <Button variant="outline" onClick={() => void refresh()}>
            刷新
          </Button>
        </div>
      </div>
      <BusinessWorkspaceNavigation
        tabs={PURCHASING_TABS}
        value={tab}
        onValueChange={setTab}
        label="采购仓储工作区栏目"
      />
      <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5">
        {scope}
        。屏幕合计、标准打印和导出使用同一全部筛选范围；分页只控制屏幕。库存余额为累计快照，不受流水日期截断。历史导入为草稿、附件补传不自动过审。
      </p>
      {tab !== "overview" && (
        <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
          <Input
            aria-label="采购检索"
            placeholder="物料/单号/说明检索"
            value={f.search}
            onChange={e =>
              setFilters(fs => ({
                ...fs,
                [tab]: { ...f, search: e.target.value },
              }))
            }
          />
          <select
            aria-label="采购状态筛选"
            className="min-h-10 min-w-0 rounded-md border bg-background p-2 text-sm"
            value={f.status}
            onChange={e =>
              setFilters(fs => ({
                ...fs,
                [tab]: { ...f, status: e.target.value },
              }))
            }
          >
            {[
              "all",
              ...(tab === "inventory"
                ? ["inbound", "outbound", "return"]
                : tab === "receipts"
                  ? ["pending", "partial", "received", "legacy_unverified"]
                  : tab === "settlements"
                    ? ["paid", "partial", "void"]
                    : tab === "suppliers"
                      ? ["active", "disabled"]
                      : [
                          "draft",
                          "submitted",
                          "approved",
                          "confirmed",
                          "received",
                          "closed",
                          "void",
                          "rejected",
                        ]),
            ].map(v => (
              <option key={v} value={v}>
                {v === "all" ? "全部状态" : statusLabel(v)}
              </option>
            ))}
          </select>
          {tab !== "suppliers" && (
            <>
              <Input
                aria-label="采购起始日期"
                type="date"
                value={f.dateFrom}
                onChange={e =>
                  setFilters(fs => ({
                    ...fs,
                    [tab]: { ...f, dateFrom: e.target.value },
                  }))
                }
              />
              <Input
                aria-label="采购截止日期"
                type="date"
                value={f.dateTo}
                onChange={e =>
                  setFilters(fs => ({
                    ...fs,
                    [tab]: { ...f, dateTo: e.target.value },
                  }))
                }
              />
            </>
          )}
          {["orders", "receipts"].includes(tab) && (
            <>
              <select
                aria-label="采购类别筛选"
                className="min-h-10 min-w-0 rounded-md border bg-background p-2 text-sm"
                value={f.categoryId}
                onChange={e =>
                  setFilters(fs => ({
                    ...fs,
                    [tab]: { ...f, categoryId: e.target.value },
                  }))
                }
              >
                <option value="all">全部类别</option>
                {(categories.data ?? []).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Input
                aria-label="采购者筛选"
                placeholder="采购者"
                value={f.purchaser}
                onChange={e =>
                  setFilters(fs => ({
                    ...fs,
                    [tab]: { ...f, purchaser: e.target.value },
                  }))
                }
              />
              <Input
                aria-label="上传管理员筛选"
                placeholder="上传管理员"
                value={f.uploader}
                onChange={e =>
                  setFilters(fs => ({
                    ...fs,
                    [tab]: { ...f, uploader: e.target.value },
                  }))
                }
              />
              <select
                aria-label="发票筛选"
                className="min-w-0 rounded-md border bg-background p-2 text-sm"
                value={f.invoice}
                onChange={e =>
                  setFilters(fs => ({
                    ...fs,
                    [tab]: { ...f, invoice: e.target.value },
                  }))
                }
              >
                <option value="all">全部发票情况</option>
                <option value="yes">声明有发票</option>
                <option value="no">无发票</option>
              </select>
            </>
          )}
          <Button
            variant="outline"
            onClick={() =>
              setFilters(fs => ({
                ...fs,
                [tab]: {
                  ...createPurchasingFilter(tab),
                  dateFrom: "",
                  dateTo: "",
                },
              }))
            }
          >
            全部历史范围
          </Button>
        </div>
      )}
      {!projectId ? (
        <p role="status">请选择已授权项目。</p>
      ) : queryError ? (
        <p role="alert" className="text-destructive">
          {getUserFacingErrorMessage(
            queryError.error,
            "当前栏目数据加载失败，请重试"
          )}
        </p>
      ) : loading ? (
        <p role="status">正在加载当前栏目…</p>
      ) : (
        <>
          {tab === "overview" ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => outputOverview(true)}>
                  总览标准A4打印
                </Button>
                <Button variant="outline" onClick={() => outputOverview(false)}>
                  总览当前范围导出
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  [
                    "当天采购订单金额",
                    money(
                      orderRows
                        .filter(
                          o =>
                            toChinaDateInput(o.orderedAt) ===
                              toChinaDateInput(new Date()) &&
                            o.status !== "void"
                        )
                        .reduce((s, o) => s + Number(o.amount), 0)
                    ),
                  ],
                  [
                    "全部未付余额",
                    money(
                      orderRows
                        .filter(o => o.status !== "void")
                        .reduce((s, o) => s + o.remainingAmount, 0)
                    ),
                  ],
                  [
                    "本月实际付款",
                    money(
                      (settlements.data?.records ?? [])
                        .filter(
                          r =>
                            ["paid", "partial"].includes(r.settlementStatus) &&
                            toChinaDateInput(r.occurredAt).slice(0, 7) ===
                              toChinaDateInput(new Date()).slice(0, 7)
                        )
                        .reduce((s, r) => s + Number(r.amount), 0)
                    ),
                  ],
                  [
                    "累计库存历史/版本估值",
                    money(balances.reduce((s, r) => s + r.totalAmount, 0)),
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="min-w-0 rounded-xl border bg-card p-4"
                  >
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-2 break-words text-lg font-semibold">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setTab("orders");
                    setFilters(fs => ({
                      ...fs,
                      orders: {
                        ...fs.orders,
                        dateFrom: "",
                        dateTo: "",
                        status: "draft",
                      },
                    }));
                  }}
                >
                  待审核订单{" "}
                  {orderRows.filter(o => o.status === "draft").length}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setTab("receipts");
                    setFilters(fs => ({
                      ...fs,
                      receipts: {
                        ...fs.receipts,
                        dateFrom: "",
                        dateTo: "",
                        status: "legacy_unverified",
                      },
                    }));
                  }}
                >
                  历史验收待核验{" "}
                  {
                    orderRows.filter(
                      o => o.receiptStatus === "legacy_unverified"
                    ).length
                  }
                </Button>
                <Button variant="outline" onClick={() => setTab("inventory")}>
                  负库存/负估值 {balances.filter(b => b.hasNegative).length}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                总览口径：当天订单、全部未付余额、本月采购结算、累计库存分别独立；不与成本双算。历史关闭订单仍按原采购结算核验实付款。
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={tab === "suppliers" && !isSuperAdmin}
                  onClick={() => output(true)}
                >
                  标准A4打印全部筛选
                </Button>
                <Button
                  variant="outline"
                  disabled={tab === "suppliers" && !isSuperAdmin}
                  onClick={() => output(false)}
                >
                  导出全部筛选
                </Button>
                {tab === "orders" && (
                  <Button onClick={() => open("request")}>新建采购申请</Button>
                )}
                {tab === "inventory" && canStock && (
                  <>
                    <Button onClick={() => open("outbound")}>
                      登记领用出库
                    </Button>
                    <Button variant="outline" onClick={() => open("return")}>
                      引用原领用退库
                    </Button>
                    <Button variant="outline" onClick={() => open("inbound")}>
                      登记入库
                    </Button>
                  </>
                )}
                {tab === "receipts" && canStock && (
                  <Button onClick={() => open("inbound")}>订单验收入库</Button>
                )}
                {tab === "settlements" && canPay && (
                  <Button onClick={() => open("payment")}>
                    登记原采购结算实际付款
                  </Button>
                )}
                {tab === "suppliers" && isSuperAdmin && (
                  <Button onClick={() => open("supplier")}>新增供应商</Button>
                )}
              </div>
              {tab === "orders" && (
                <section className="space-y-3 rounded-lg border p-3">
                  <h3 className="font-semibold">
                    采购申请 · 全部筛选 {filteredRequests.length} 条
                  </h3>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => output(true, "requests")}
                    >
                      申请打印
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => output(false, "requests")}
                    >
                      申请导出
                    </Button>
                  </div>
                  {requestPage.pageRows.map(r => (
                    <article
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"
                    >
                      <div>
                        <b>{r.requestNo}</b>
                        <p className="text-sm">
                          {r.description} · {money(r.amount)} ·{" "}
                          {statusLabel(r.status)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {["draft", "rejected"].includes(r.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              open("request", undefined, {
                                requestId: String(r.id),
                                categoryId: String(r.categoryId),
                                description: r.description,
                                amount: String(r.amount),
                              })
                            }
                          >
                            编辑原申请
                          </Button>
                        )}
                        {r.status === "rejected" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              transitionRequest.mutate({
                                id: r.id,
                                projectId,
                                targetStatus: "draft",
                              })
                            }
                          >
                            退回申请转草稿
                          </Button>
                        )}
                        {r.status === "stocked" && canApprove && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "关闭原申请？须先完成关联订单实际付款和关闭，服务端再次校验。"
                                )
                              )
                                transitionRequest.mutate({
                                  id: r.id,
                                  projectId,
                                  targetStatus: "closed",
                                });
                            }}
                          >
                            关闭原申请
                          </Button>
                        )}
                        {r.status === "draft" && (
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              transitionRequest.mutate({
                                id: r.id,
                                projectId,
                                targetStatus: "submitted",
                              })
                            }
                          >
                            提交审批
                          </Button>
                        )}
                        {r.status === "submitted" && canApprove && (
                          <>
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() =>
                                transitionRequest.mutate({
                                  id: r.id,
                                  projectId,
                                  targetStatus: "approved",
                                })
                              }
                            >
                              批准申请
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                transitionRequest.mutate({
                                  id: r.id,
                                  projectId,
                                  targetStatus: "rejected",
                                })
                              }
                            >
                              退回
                            </Button>
                          </>
                        )}
                        {r.status === "approved" && canApprove && (
                          <Button
                            size="sm"
                            onClick={() =>
                              open("order", undefined, {
                                requestId: String(r.id),
                                amount: String(r.amount),
                              })
                            }
                          >
                            从申请创建订单
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                  {!filteredRequests.length && (
                    <p className="text-sm text-muted-foreground">
                      当前筛选暂无申请；可选择全部历史范围。
                    </p>
                  )}
                  {pagination(requestPage, "采购申请")}
                </section>
              )}
              {["orders", "receipts"].includes(tab) && (
                <section className="space-y-3">
                  <h3 className="font-semibold">
                    {tab === "receipts" ? "订单验收依据及实际入库" : "采购订单"}{" "}
                    · 全部筛选 {filteredOrders.length} 条 · 有效订单金额{" "}
                    {money(
                      filteredOrders
                        .filter(o => o.status !== "void")
                        .reduce((s, o) => s + Number(o.amount), 0)
                    )}
                  </h3>
                  {orderPage.pageRows.map(o => (
                    <article
                      key={o.id}
                      className="min-w-0 rounded-lg border px-3 py-2"
                    >
                      <div className="grid min-w-0 gap-x-3 gap-y-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.7fr)] lg:items-center">
                        <b
                          className="min-w-0 break-words text-sm lg:truncate"
                          title={`${o.orderNo} · ${o.itemDescription || "采购申请关联订单"}`}
                        >
                          {o.orderNo} ·{" "}
                          {o.itemDescription || "采购申请关联订单"}
                        </b>
                        <span className="text-sm">
                          {money(o.amount)} · {statusLabel(o.status)}
                        </span>
                        <p className="min-w-0 text-xs">
                          实物验收：{statusLabel(o.receiptStatus)} ·{" "}
                          {formatQuantity(o.receivedQuantity)}/
                          {o.receiptExpectedQuantity == null ? "尚未登记" : formatQuantity(o.receiptExpectedQuantity)}{" "}
                          {o.inventoryUnit}　 实际付款：{money(o.paidAmount)} ·
                          未付 {money(o.remainingAmount)}
                        </p>
                        <p className="min-w-0 text-xs text-muted-foreground lg:col-span-2 lg:truncate">
                          {o.purchaserName} · {o.categoryName} ·{" "}
                          {formatChinaDateTime(o.orderedAt)}
                        </p>
                      </div>
                      <details className="text-xs lg:-mt-4 lg:ml-auto lg:w-fit">
                        <summary className="cursor-pointer text-xs">
                          业务详情、附件和操作
                        </summary>
                        <div className="mt-3 space-y-2">
                          <p className="text-xs">
                            申请 #{o.requestId ?? "无（直接/历史采购）"} ·
                            原采购数量 {o.quantity == null ? "未记录" : formatQuantity(o.quantity)} · 单价{" "}
                            {o.unitPrice == null ? "未记录" : money(o.unitPrice)} · 关联资产{" "}
                            {o.assetLabel ?? "无"}
                          </p>
                          <p className="text-xs">
                            验收依据：
                            {o.receiptBasisReason ??
                              "未登记（不推断历史收货）"}{" "}
                            · 金额大写：{amountToChineseUppercase(o.amount)}
                          </p>
                          <p className="text-xs">
                            上传管理员：
                            {o.documentUploadedByName ?? o.createdByName} ·
                            现场管理员：{o.projectAdministratorName ?? "未登记"}{" "}
                            · 备注：{o.remarks ?? "未填写"} · 发票：
                            {o.invoiceEvidenceId
                              ? "已绑定"
                              : o.hasInvoice
                                ? "声明有票，待补传"
                                : "无票"}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {o.documentAttachment && (
                              <PurchasingEvidencePreview
                                file={o.documentAttachment}
                                label="原采购证据预览"
                              />
                            )}
                            {o.invoiceAttachment && (
                              <PurchasingEvidencePreview
                                file={o.invoiceAttachment}
                                label="发票站内预览"
                              />
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => open("document", o.id)}
                            >
                              补传原采购证据
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => open("invoice", o.id)}
                            >
                              上传绑定发票
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                try {
                                  printPurchasingHalfA4(o);
                                } catch (e) {
                                  failure(e);
                                }
                              }}
                            >
                              原半A4报销详单
                            </Button>
                            {o.status === "draft" && canApprove && (
                              <Button
                                size="sm"
                                disabled={pending}
                                onClick={() =>
                                  transitionOrder.mutate({
                                    id: o.id,
                                    projectId,
                                    targetStatus: "confirmed",
                                  })
                                }
                              >
                                逐单审核通过
                              </Button>
                            )}
                            {!["void", "closed"].includes(o.status) &&
                              canApprove &&
                              o.receivedQuantity === 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => open("basis", o.id)}
                                >
                                  登记实物验收依据
                                </Button>
                              )}
                            {["confirmed", "received"].includes(o.status) &&
                              canStock &&
                              o.receiptExpectedQuantity &&
                              o.receivedQuantity <
                                Number(o.receiptExpectedQuantity) && (
                                <Button
                                  size="sm"
                                  onClick={() => open("inbound", o.id)}
                                >
                                  关联订单验收入库
                                </Button>
                              )}
                            {o.status === "confirmed" &&
                              !o.receiptExpectedQuantity &&
                              canStock && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={pending}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        "仅适用于非库存采购或历史人工核验收货；此动作不证明实物入库或实际付款，是否继续？"
                                      )
                                    )
                                      transitionOrder.mutate({
                                        id: o.id,
                                        projectId,
                                        targetStatus: "received",
                                      });
                                  }}
                                >
                                  非库存/历史人工确认收货
                                </Button>
                              )}
                            {["received", "closed"].includes(o.status) &&
                              canPay &&
                              o.remainingAmount > 0 && (
                                <Button
                                  size="sm"
                                  onClick={() => open("payment", o.id)}
                                >
                                  登记实际付款
                                </Button>
                              )}
                            {o.status === "received" && canApprove && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending || o.remainingAmount > 0}
                                onClick={() =>
                                  transitionOrder.mutate({
                                    id: o.id,
                                    projectId,
                                    targetStatus: "closed",
                                  })
                                }
                              >
                                余额为零后关闭
                              </Button>
                            )}
                            {["draft", "confirmed"].includes(o.status) &&
                              canApprove && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={pending}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        "作废该订单？已有入库或实际付款将被服务端阻止。"
                                      )
                                    )
                                      transitionOrder.mutate({
                                        id: o.id,
                                        projectId,
                                        targetStatus: "void",
                                      });
                                  }}
                                >
                                  作废订单
                                </Button>
                              )}
                          </div>
                        </div>
                      </details>
                    </article>
                  ))}
                  {!filteredOrders.length && (
                    <p className="text-sm text-muted-foreground">
                      当前筛选暂无订单，可查询全部历史。
                    </p>
                  )}
                  {pagination(orderPage, "采购订单")}
                </section>
              )}
              {tab === "inventory" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {permissionNote}
                  </p>
                  <section className="space-y-3 rounded-lg border p-3">
                    <h3 className="font-semibold">
                      累计库存余额 · {filteredBalances.length}{" "}
                      种物料（日期仅过滤下方收发流水）
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => output(true, "balances")}
                      >
                        累计余额打印
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => output(false, "balances")}
                      >
                        累计余额导出
                      </Button>
                    </div>
                    {balancePage.pageRows.map(b => (
                      <div
                        key={`${b.itemName}:${b.unit}`}
                        className="rounded-lg border p-3"
                      >
                        <b>
                          {b.itemName} · {formatQuantity(b.balanceQuantity)} {b.unit} ·{" "}
                          {money(b.totalAmount)}
                        </b>
                        <p
                          className={`mt-1 text-xs ${b.hasNegative ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {b.hasNegative
                            ? "历史负库存/负估值：禁止领用，负责人授权带原因入库纠正。"
                            : ""}
                          {b.valuationLabel}
                        </p>
                      </div>
                    ))}
                    {pagination(balancePage, "累计库存余额")}
                  </section>
                  <section className="space-y-3">
                    <h3 className="font-semibold">
                      全部筛选收发流水 {filteredStock.length} 条 · 入库估值{" "}
                      {money(
                        filteredStock
                          .filter(r => r.transactionType === "inbound")
                          .reduce((s, r) => s + Number(r.amount), 0)
                      )}{" "}
                      · 领用估值{" "}
                      {money(
                        filteredStock
                          .filter(r => r.transactionType === "outbound")
                          .reduce((s, r) => s + Number(r.amount), 0)
                      )}{" "}
                      · 退库估值{" "}
                      {money(
                        filteredStock
                          .filter(r => r.transactionType === "return")
                          .reduce((s, r) => s + Number(r.amount), 0)
                      )}
                    </h3>
                    {stockPage.pageRows.map(r => (
                      <article key={r.id} className="rounded-lg border p-3">
                        <b>
                          {r.transactionNo} · {statusLabel(r.transactionType)} ·{" "}
                          {r.itemName}
                        </b>
                        <p className="mt-1 text-sm">
                          {formatQuantity(r.quantity)} {r.unit} · 流水估值 {money(r.amount)} ·{" "}
                          {formatChinaDateTime(r.occurredAt)}
                        </p>
                        <details className="mt-2 text-xs">
                          <summary>追溯与计价详情</summary>
                          <p className="mt-2">
                            版本 {r.costRuleVersion} · 精确成本单价{" "}
                            {formatAmount(r.costingUnitCost ?? r.unitCost)} · 订单 #
                            {r.purchaseOrderId ?? "无"} · 原领用 #
                            {r.originalOutboundId ?? "无"} · 操作人 #
                            {r.operatorId} · 授权原因{" "}
                            {r.exceptionReason ?? "无"} · {r.remarks}
                          </p>
                          {r.evidence && (
                            <PurchasingEvidencePreview
                              file={r.evidence}
                              label="收发凭证站内预览"
                            />
                          )}
                        </details>
                        {r.transactionType === "outbound" && canStock && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() =>
                              open("return", undefined, {
                                originalOutboundId: String(r.id),
                                itemName: r.itemName,
                                unit: r.unit,
                                unitCost: r.unitCost,
                              })
                            }
                          >
                            引用此领用退库
                          </Button>
                        )}
                      </article>
                    ))}
                    {!filteredStock.length && (
                      <p className="text-sm text-muted-foreground">
                        当前日期与检索范围暂无收发流水。
                      </p>
                    )}
                    {pagination(stockPage, "库存收发流水")}
                  </section>
                </>
              )}
              {tab === "settlements" && (
                <>
                  <p className="text-sm">
                    全部筛选采购结算 {filteredPayments.length} 笔 · 实际付款{" "}
                    {money(
                      filteredPayments
                        .filter(r =>
                          ["paid", "partial"].includes(r.settlementStatus)
                        )
                        .reduce((s, r) => s + Number(r.amount), 0)
                    )}
                    。来源为原 recordSettlement +
                    financial_records，非另一个成本台账。
                  </p>
                  {paymentPage.pageRows.map(r => (
                    <article key={r.id} className="rounded-lg border p-3">
                      <b>
                        {r.recordNo} · 订单 #{r.sourceId}
                      </b>
                      <p className="mt-1 text-sm">
                        {money(r.amount)} · {formatChinaDateTime(r.occurredAt)}{" "}
                        · {statusLabel(r.settlementStatus)} · {r.remarks}
                      </p>
                    </article>
                  ))}
                  {!filteredPayments.length && (
                    <p>当前月份/筛选无实际付款记录。</p>
                  )}
                  {pagination(paymentPage, "采购实际付款流水")}
                  <h3 className="font-semibold">
                    订单原件与发票补传（全部订单，不按付款时间推断票据日期）
                  </h3>
                  {invoicePage.pageRows.map(o => (
                    <div
                      key={o.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <span>
                        {o.orderNo} ·{" "}
                        {o.invoiceEvidenceId ? "发票已绑定" : "待补传发票"}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => open("invoice", o.id)}
                        >
                          补传绑定发票
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => open("document", o.id)}
                        >
                          补传原采购证据
                        </Button>
                        {o.invoiceAttachment && (
                          <PurchasingEvidencePreview
                            file={o.invoiceAttachment}
                            label="发票站内预览"
                          />
                        )}
                        {o.documentAttachment && (
                          <PurchasingEvidencePreview
                            file={o.documentAttachment}
                            label="原采购证据预览"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                  {pagination(invoicePage, "采购票据关联订单")}
                </>
              )}
              {tab === "suppliers" &&
                (isSuperAdmin ? (
                  <>
                    <p className="text-sm">
                      供应商档案 {filteredSuppliers.length}{" "}
                      家，导出仅包含本栏目授权字段，不混用申请数据。
                    </p>
                    {supplierPage.pageRows.map(s => (
                      <article key={s.id} className="rounded-lg border p-3">
                        <b>{s.name}</b>
                        <p className="mt-1 text-sm">
                          {s.unifiedSocialCreditCode ||
                            "未填写统一社会信用代码"}{" "}
                          · {s.contactName || "未填联系人"} ·{" "}
                          {s.contactPhoneMasked || "未填联系电话"} ·{" "}
                          {statusLabel(s.status)}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          disabled={pending}
                          onClick={() =>
                            open("supplier", undefined, {
                              supplierId: String(s.id),
                              itemName: s.name,
                              organizationId:
                                s.organizationId == null
                                  ? ""
                                  : String(s.organizationId),
                              unifiedSocialCreditCode:
                                s.unifiedSocialCreditCode ?? "",
                              contactName: s.contactName ?? "",
                              contactPhoneMasked: s.contactPhoneMasked ?? "",
                              supplierStatus: s.status,
                            })
                          }
                        >
                          编辑供应商 / 启停维护
                        </Button>
                      </article>
                    ))}
                    {pagination(supplierPage, "供应商档案")}
                  </>
                ) : (
                  <p role="status">
                    供应商档案维护、打印与导出仍仅限超级管理员。
                  </p>
                ))}
            </>
          )}
        </>
      )}
      <Dialog
        open={form !== null}
        onOpenChange={v => {
          if (!v) close();
        }}
      >
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form
                ? (
                    {
                      request: "采购申请草稿",
                      order: "批准申请创建订单",
                      basis: "登记订单实物验收依据",
                      inbound: "关联订单验收入库",
                      outbound: "库存领用出库",
                      return: "引用原领用退库",
                      payment: "登记原采购结算实际付款",
                      document: "补传并绑定原采购证据",
                      invoice: "上传并绑定发票",
                      supplier: "供应商档案",
                    } as Record<FormKind, string>
                  )[form]
                : "采购业务"}
            </DialogTitle>
          </DialogHeader>
          {draftProjectId !== projectId && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
              此表单属于项目 #{draftProjectId}，当前项目 #{projectId}
              ；返回原项目或取消放弃后再填写，禁止误写。
            </p>
          )}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            {form === "request" && (
              <>
                {selectField(
                  "categoryId",
                  "采购类别",
                  (categories.data ?? []).map(c => ({
                    value: String(c.id),
                    label: c.name,
                  }))
                )}
                {field("description", "采购说明")}
                {field("amount", "申请金额", "number")}
              </>
            )}
            {form === "order" && (
              <>
                {selectField(
                  "requestId",
                  "已批准采购申请",
                  (requests.data ?? [])
                    .filter(r => r.status === "approved")
                    .map(r => ({
                      value: String(r.id),
                      label: `${r.requestNo} ${money(r.amount)}`,
                    }))
                )}
                {isSuperAdmin &&
                  selectField(
                    "supplierId",
                    "供应商（可选）",
                    (suppliers.data ?? [])
                      .filter(s => s.status === "active")
                      .map(s => ({
                        value: String(s.id),
                        label: s.name,
                      }))
                  )}
                {field("amount", "订单金额", "number")}
                {field("occurredAt", "下单时间", "datetime-local")}
              </>
            )}
            {form &&
              ["basis", "inbound", "payment", "document", "invoice"].includes(
                form
              ) &&
              selectField(
                "orderId",
                form === "inbound"
                  ? "关联采购订单（无订单仅负责人授权例外）"
                  : "采购订单",
                orderRows
                  .filter(o =>
                    form === "payment"
                      ? ["received", "closed"].includes(o.status) &&
                        o.remainingAmount > 0
                      : form === "inbound"
                        ? ["confirmed", "received"].includes(o.status)
                        : !["closed", "void"].includes(o.status) ||
                          ["document", "invoice"].includes(form ?? "")
                  )
                  .map(o => ({
                    value: String(o.id),
                    label: `${o.orderNo} · ${o.itemDescription ?? ""}`,
                  })),
                changeOrder
              )}
            {form &&
              ["basis", "inbound", "outbound", "return"].includes(form) && (
                <>
                  {form === "return" &&
                    selectField(
                      "originalOutboundId",
                      "原领用流水（必须同物料同单位）",
                      stock
                        .filter(r => r.transactionType === "outbound")
                        .map(r => ({
                          value: String(r.id),
                          label: `${r.transactionNo} ${r.itemName} ${formatQuantity(r.quantity)}${r.unit}`,
                        })),
                      id => {
                        const r = stock.find(r => String(r.id) === id);
                        setDraft(d => ({
                          ...d,
                          originalOutboundId: id,
                          itemName: r?.itemName ?? "",
                          unit: r?.unit ?? "件",
                          unitCost: r?.unitCost ?? "0",
                        }));
                      }
                    )}
                  {field(
                    "itemName",
                    "物料名称",
                    "text",
                    form === "return" ||
                      (form === "inbound" &&
                        Boolean(
                          orderRows.find(o => String(o.id) === draft.orderId)
                            ?.inventoryItemName
                        ))
                  )}
                  {field(
                    "unit",
                    "计量单位",
                    "text",
                    form === "return" ||
                      (form === "inbound" &&
                        Boolean(
                          orderRows.find(o => String(o.id) === draft.orderId)
                            ?.inventoryUnit
                        ))
                  )}
                  {field(
                    "quantity",
                    form === "basis"
                      ? "订单允许验收总数量"
                      : "本次数量（最多三位小数）",
                    "number"
                  )}
                  {form !== "basis" &&
                    field(
                      "unitCost",
                      form === "inbound"
                        ? "入库记账单价"
                        : "成本单价（服务端移动加权/原领用核算）",
                      "number",
                      form !== "inbound"
                    )}
                </>
              )}
            {form === "payment" && (
              <>
                {field("amount", "本次实际付款金额", "number")}
                <p className="text-xs leading-5">
                  未付余额{" "}
                  {money(
                    orderRows.find(o => String(o.id) === draft.orderId)
                      ?.remainingAmount
                  )}
                  ；使用原采购结算资金流水，不另记费用。
                </p>
              </>
            )}
            {form &&
              ["inbound", "outbound", "return", "payment"].includes(form) && (
                <>
                  {field("occurredAt", "业务发生时间", "datetime-local")}
                  {field("remarks", "备注")}
                </>
              )}
            {form &&
              ["basis", "inbound", "document", "invoice"].includes(form) &&
              field(
                "reason",
                form === "inbound"
                  ? "无订单/负库存例外原因（仅负责人授权）"
                  : "依据/补传原因（至少5字）"
              )}
            {form && ["inbound", "document", "invoice"].includes(form) && (
              <div className="space-y-2 sm:col-span-2">
                <Label>受控附件上传（归档后仍须保存绑定）</Label>
                <Input
                  aria-label="采购附件上传"
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  disabled={upload.isPending || draftProjectId !== projectId}
                  onChange={e => {
                    void uploadFile(e.target.files?.[0]);
                    e.currentTarget.value = "";
                  }}
                />
                <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border px-3 text-sm">
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={upload.isPending || draftProjectId !== projectId}
                    onChange={e => {
                      void uploadFile(e.target.files?.[0]);
                      e.currentTarget.value = "";
                    }}
                  />
                  拍摄采购/入库凭证
                </label>
                <p className="text-xs">
                  {uploadedFileName ||
                    (draft.evidenceId
                      ? `已选归档证据 #${draft.evidenceId}`
                      : "JPG/PNG最多5MB，PDF最多15MB")}
                </p>
                {selectField(
                  "evidenceId",
                  "已有采购归档附件（服务端校验类型和项目）",
                  (evidences.data ?? [])
                    .filter(
                      e =>
                        e.attachmentKind ===
                        (form === "invoice" ? "invoice" : "document")
                    )
                    .map(e => ({
                      value: String(e.id),
                      label: `${e.fileName} · ${e.description}`,
                    }))
                )}
              </div>
            )}
            {form === "supplier" && (
              <>
                {field("itemName", "供应商名称")}
                {field(
                  "organizationId",
                  "所属组织ID（可选，保留原组织）",
                  "number"
                )}
                {field("unifiedSocialCreditCode", "统一社会信用代码")}
                {field("contactName", "联系人")}
                {field("contactPhoneMasked", "联系电话")}
                {selectField("supplierStatus", "供应商档案状态", [
                  { value: "active", label: "启用" },
                  { value: "disabled", label: "停用" },
                ])}
              </>
            )}
          </div>
          {form && ["inbound", "outbound", "return"].includes(form) && (
            <p className="text-xs leading-5 text-muted-foreground">
              入库必须订单验收依据和凭证；无订单/历史负库存须负责人原因审计。领用不超过余额，新价为同物料同单位移动加权；退库按原领用成本和剩余可退数量，禁止重复。历史原价不重算。
            </p>
          )}
          <DialogFooter className="flex-wrap">
            <Button variant="outline" disabled={pending} onClick={close}>
              取消/放弃
            </Button>
            <Button
              disabled={pending || draftProjectId !== projectId}
              onClick={submit}
            >
              {pending ? "正在保存…" : "保存并完成业务绑定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
