import React from "react";
import {
  act,
  create,
  type ReactTestRenderer,
  type ReactTestInstance,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  upload: vi.fn(),
  save: vi.fn(),
  preview: vi.fn(),
  invalidate: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  rows: [] as any[],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      contract: {
        list: { invalidate: m.invalidate },
        previewAttachment: { fetch: m.preview },
      },
    }),
    contract: {
      list: { useQuery: () => ({ data: m.rows, refetch: vi.fn() }) },
      capabilities: { useQuery: () => ({ data: { canMaintain: true } }) },
      save: { useMutation: () => ({ mutateAsync: m.save, isPending: false }) },
      uploadAttachment: {
        useMutation: () => ({ mutateAsync: m.upload, isPending: false }),
      },
      transition: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
vi.mock("@/components/FullContractTemplates", () => ({ default: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: (p: any) => <button {...p} />,
}));
vi.mock("@/components/ui/input", () => ({
  Input: (p: any) => <input {...p} />,
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (p: any) => <textarea {...p} />,
}));
vi.mock("@/components/ui/label", () => ({
  Label: (p: any) => <label {...p} />,
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: (p: any) => <span {...p} />,
}));
vi.mock("@/components/ui/card", () => {
  const B = (p: any) => <div {...p} />;
  return {
    Card: B,
    CardContent: B,
    CardHeader: B,
    CardTitle: B,
    CardDescription: B,
  };
});
vi.mock("@/components/ui/table", () => {
  const B = (p: any) => <div {...p} />;
  return {
    Table: B,
    TableHeader: B,
    TableBody: B,
    TableHead: B,
    TableCell: B,
    TableRow: B,
  };
});
vi.mock("@/components/ui/select", () => {
  const B = (p: any) => <div {...p} />;
  return {
    Select: (p: any) => (
      <div
        data-select
        {...({ value: p.value, onChange: p.onValueChange } as any)}
      >
        {p.children}
      </div>
    ),
    SelectTrigger: B,
    SelectContent: B,
    SelectValue: B,
    SelectItem: B,
  };
});
vi.mock("@/components/ui/dialog", () => {
  const B = (p: any) => <div {...p} />;
  return {
    Dialog: (p: any) => (
      <div data-dialog data-open={p.open} onChange={p.onOpenChange}>
        {p.open ? p.children : null}
      </div>
    ),
    DialogContent: B,
    DialogHeader: B,
    DialogTitle: B,
    DialogDescription: B,
    DialogFooter: B,
  };
});
import ContractManagementPanel from "./ContractManagementPanel";
let tree: ReactTestRenderer | undefined;
const text = (n: ReactTestInstance | string): string =>
  typeof n === "string" ? n : n.children.map(text).join("");
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
};
class Reader {
  static instances: Reader[] = [];
  static delayed = false;
  result = "data:image/jpeg;base64,/9j/4AA=";
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    Reader.instances.push(this);
  }
  readAsDataURL() {
    if (!Reader.delayed) this.onload?.();
  }
  abort() {
    this.onabort?.();
  }
}
const root = () => tree!.root;
const button = (label: string) =>
  root()
    .findAllByType("button")
    .find(n => text(n) === label)!;
const projectSelect = () => root().findAllByProps({ "data-select": true })[0];
const fileInput = () => root().findByProps({ id: "contract-attachment" });
const counterpart = () =>
  root().findByProps({ placeholder: "输入施工队、运输公司或机械出租方" });
const file = (change: any = {}) => ({
  name: "签署合同.jpg",
  type: "image/jpeg",
  size: 100,
  ...change,
});
const choose = (selected = file()) =>
  fileInput().props.onChange({
    target: { files: [selected], value: "selected" },
  });
const submit = () =>
  root()
    .findByType("form")
    .props.onSubmit({ preventDefault() {} });
const click = async (label: string) =>
  act(async () => button(label).props.onClick());
async function mount() {
  await act(async () => {
    tree = create(
      <ContractManagementPanel
        projects={[
          { id: 2, name: "真实项目甲" },
          { id: 3, name: "真实项目乙" },
        ]}
      />
    );
  });
  await act(async () => projectSelect().props.onChange("2"));
}
async function createForm() {
  await mount();
  await click("新建外包合同");
  await act(async () =>
    counterpart().props.onChange({ target: { value: "真实相对方" } })
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  m.rows = [];
  Reader.instances = [];
  Reader.delayed = false;
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("FileReader", Reader);
  m.upload.mockResolvedValue({
    success: true,
    evidenceId: 41,
    fileName: "签署合同.jpg",
    mimeType: "image/jpeg",
  });
  m.save.mockResolvedValue({ success: true, contractId: 6 });
  m.invalidate.mockResolvedValue(undefined);
  m.preview.mockResolvedValue({
    evidenceId: 41,
    fileName: "签署合同.jpg",
    mimeType: "image/jpeg",
    url: "data:image/jpeg;base64,/9j/4AA=",
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("真实ContractManagementPanel附件行为", () => {
  it("选择→专用归档→ID显示→站内预览→save提交真实ID，不走generic或download", async () => {
    await createForm();
    await act(async () => choose());
    expect(m.upload).toHaveBeenCalledWith({
      projectId: 2,
      id: undefined,
      fileName: "签署合同.jpg",
      mimeType: "image/jpeg",
      base64Data: "data:image/jpeg;base64,/9j/4AA=",
    });
    expect(text(root())).toContain("已归档合同附件 #41");
    await click("站内查看合同附件");
    expect(m.preview).toHaveBeenCalledWith({
      projectId: 2,
      id: undefined,
      evidenceId: 41,
    });
    expect(root().findByType("img").props.src).toBe(
      "data:image/jpeg;base64,/9j/4AA="
    );
    expect(root().findAllByType("a")).toHaveLength(0);
    await act(async () => submit());
    expect(m.save.mock.calls[0][0]).toMatchObject({
      attachmentEvidenceId: 41,
      projectId: 2,
      contractAmount: 0,
      counterpartyName: "真实相对方",
    });
    expect(root().findAllByType("form")).toHaveLength(0);
    expect(m.invalidate).toHaveBeenCalledOnce();
  });
  it("保存失败保留归档ID和商务输入，重试只save不重传", async () => {
    await createForm();
    await act(async () => choose());
    m.save.mockRejectedValueOnce(new Error("事务冲突"));
    await act(async () => submit());
    expect(text(root())).toContain("#41");
    expect(counterpart().props.value).toBe("真实相对方");
    await act(async () => submit());
    expect(m.upload).toHaveBeenCalledOnce();
    expect(m.save).toHaveBeenCalledTimes(2);
    expect(m.save.mock.calls[1][0].attachmentEvidenceId).toBe(41);
  });
  it("编辑旧pointer默认omission保留，与原No/金额/模板/状态无扰动", async () => {
    m.rows = [
      {
        id: 5,
        projectId: 2,
        contractNo: "CT-真实旧正式号",
        contractType: "transport",
        counterpartyName: "原合同相对方",
        pricingMethod: "trip",
        contractAmount: "321.09",
        unitPrice: "12.34",
        status: "draft",
        attachmentEvidenceId: 28,
        contractSummary: "原摘要",
        remarks: "原备注",
      },
    ];
    await mount();
    expect(text(root())).toContain("CT-真实旧正式号");
    await click("编辑");
    expect(text(root())).toContain("#28");
    await act(async () => submit());
    expect(m.save.mock.calls[0][0]).toMatchObject({
      id: 5,
      contractAmount: 321.09,
      unitPrice: 12.34,
      contractSummary: "原摘要",
      remarks: "原备注",
    });
    expect(m.save.mock.calls[0][0]).not.toHaveProperty("attachmentEvidenceId");
    expect(m.save.mock.calls[0][0]).not.toHaveProperty("contractNo");
    expect(m.save.mock.calls[0][0]).not.toHaveProperty("status");
  });
  it("编辑新归档上传使用真实合同id，save只接上传新ID", async () => {
    m.rows = [
      {
        id: 5,
        projectId: 2,
        contractNo: "CT-旧号",
        contractType: "transport",
        counterpartyName: "原相对方",
        pricingMethod: "trip",
        contractAmount: "100",
        status: "suspended",
        attachmentEvidenceId: 28,
      },
    ];
    await mount();
    await click("编辑");
    await act(async () => choose());
    expect(m.upload.mock.calls[0][0].id).toBe(5);
    await act(async () => submit());
    expect(m.save.mock.calls[0][0]).toMatchObject({
      id: 5,
      attachmentEvidenceId: 41,
    });
  });
  it("同步上传锁覆盖React重渲染前双选择与submit，不重复归档", async () => {
    const request = deferred<any>();
    m.upload.mockReturnValue(request.promise);
    await createForm();
    await act(async () => {
      const handler = fileInput().props.onChange;
      handler({ target: { files: [file()], value: "" } });
      handler({ target: { files: [file()], value: "" } });
      submit();
    });
    expect(m.upload).toHaveBeenCalledOnce();
    expect(m.save).not.toHaveBeenCalled();
    expect(root().findByType("fieldset").props.disabled).toBe(true);
    await act(async () =>
      request.resolve({ evidenceId: 41, fileName: "合同.jpg" })
    );
  });
  it("同步save锁覆盖同tick双submit和上传，保存期间受控拒绝关闭", async () => {
    const request = deferred<any>();
    m.save.mockReturnValue(request.promise);
    await createForm();
    await act(async () => {
      const handler = root().findByType("form").props.onSubmit;
      handler({ preventDefault() {} });
      handler({ preventDefault() {} });
      choose();
    });
    expect(m.save).toHaveBeenCalledOnce();
    expect(m.upload).not.toHaveBeenCalled();
    await act(async () =>
      root().findAllByProps({ "data-dialog": true })[0].props.onChange(false)
    );
    expect(root().findAllByType("form")).toHaveLength(1);
    await act(async () => request.resolve({ success: true }));
  });
  it.each(["close", "project", "unmount"])(
    "上传中%s后迟到成功不写新表单",
    async kind => {
      const request = deferred<any>();
      m.upload.mockReturnValue(request.promise);
      await createForm();
      await act(async () => choose());
      if (kind === "close") {
        await click("取消");
        await click("新建外包合同");
      }
      if (kind === "project") {
        await act(async () => projectSelect().props.onChange("3"));
        await click("新建外包合同");
      }
      if (kind === "unmount") {
        await act(async () => tree!.unmount());
        tree = undefined;
      }
      await act(async () =>
        request.resolve({ evidenceId: 99, fileName: "迟到合同.jpg" })
      );
      if (tree) expect(text(root())).not.toContain("#99");
      expect(
        m.success.mock.calls.some(
          c => c[0] === "合同附件已归档，请保存合同完成关联"
        )
      ).toBe(false);
    }
  );
  it("取消上传中请求可重选，旧响应不能解锁或覆盖新上传", async () => {
    const old = deferred<any>(),
      next = deferred<any>();
    m.upload.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await createForm();
    await act(async () => choose());
    await click("取消本次上传");
    await act(async () => choose());
    await act(async () => old.resolve({ evidenceId: 90, fileName: "旧附件" }));
    expect(text(root())).not.toContain("#90");
    expect(root().findByType("fieldset").props.disabled).toBe(true);
    await act(async () => next.resolve({ evidenceId: 91, fileName: "新附件" }));
    expect(text(root())).toContain("#91");
  });
  it("读取阶段取消abort，未完成reader不能调用uploader", async () => {
    Reader.delayed = true;
    await createForm();
    await act(async () => choose());
    await click("取消本次上传");
    await act(async () => Reader.instances[0].onload?.());
    expect(m.upload).not.toHaveBeenCalled();
  });
  it("上传失败保留先前归档ID，提交重试不重传", async () => {
    await createForm();
    await act(async () => choose());
    m.upload.mockRejectedValueOnce(new Error("上传中断"));
    await act(async () => choose(file({ name: "替换失败.jpg" })));
    expect(text(root())).toContain("#41");
    await act(async () => submit());
    expect(m.save.mock.calls[0][0].attachmentEvidenceId).toBe(41);
  });
  it.each([
    { type: "application/pdf" },
    { size: 8 * 1024 * 1024 + 1 },
    { size: 0 },
  ])("客户端拒绝不合法文件%j", async change => {
    await createForm();
    await act(async () => choose(file(change)));
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.error).toHaveBeenCalled();
  });
  it("预览请求换项目迟到不写新项目，不打开下载", async () => {
    const request = deferred<any>();
    m.preview.mockReturnValue(request.promise);
    await createForm();
    await act(async () => choose());
    await click("站内查看合同附件");
    await act(async () => projectSelect().props.onChange("3"));
    await act(async () =>
      request.resolve({
        url: "data:image/jpeg;base64,late",
        fileName: "旧项目",
      })
    );
    expect(root().findAllByType("img")).toHaveLength(0);
  });
  it("save换项目后的迟到成功不关闭新项目表单", async () => {
    const request = deferred<any>();
    m.save.mockReturnValue(request.promise);
    await createForm();
    await act(async () => submit());
    await act(async () => projectSelect().props.onChange("3"));
    await click("新建外包合同");
    await act(async () => request.resolve({ success: true }));
    expect(root().findAllByType("form")).toHaveLength(1);
    expect(counterpart().props.value).toBe("");
  });
});
