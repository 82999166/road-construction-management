import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FinancePagination,
  useFinancePagination,
} from "@/components/FinanceWorkspaceNavigation";
import AdministratorAuthorizationEditor from "@/components/AdministratorAuthorizationEditor";
import { KeyRound, Plus, Search, ShieldCheck, UsersRound } from "lucide-react";

type AccountStatus = "active" | "disabled";
type LoginMode = "pc" | "mobile" | "both";
type AdministratorAccount = {
  id: number;
  name: string | null;
  localUsername: string | null;
  localAccountStatus: string | null;
  localLoginMode: string | null;
  role: string;
  lastSignedIn: Date | string | null;
};
type Draft = {
  username: string;
  displayName: string;
  status: AccountStatus;
  loginMode: LoginMode;
  password: string;
  confirmation: string;
  currentPassword: string;
};
type Editor = {
  kind: "create" | "edit" | "reset" | "own";
  target: AdministratorAccount | null;
  initial: Draft;
};
type AuthorizationTarget = { userId: number; name: string };
type FieldErrors = Partial<Record<keyof Draft, string>>;

export interface AdministratorManagementProps {
  currentUserId: number;
  canChangeOwnPassword: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

const selectClass =
  "min-h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const emptyDraft = (): Draft => ({
  username: "",
  displayName: "",
  status: "active",
  loginMode: "pc",
  password: "",
  confirmation: "",
  currentPassword: "",
});

function normalizePhone(value: string) {
  return value
    .trim()
    .replace(/[\s()-]/g, "")
    .replace(/^(?:\+86|0086|86)(?=1[3-9]\d{9}$)/, "");
}

function friendlyError(error: unknown, operation: Editor["kind"] | "list") {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED")
    return operation === "own"
      ? "当前密码不正确或登录已失效，请核对当前密码；仍失败时请重新登录后重试。"
      : "登录已失效，请重新登录后重试。";
  if (code === "FORBIDDEN")
    return "无权执行此操作。请确认超级管理员身份，或重新登录。";
  if (code === "CONFLICT")
    return "该手机号已被使用或账号数据已变更，请核对手机号并刷新列表后重试。";
  if (code === "NOT_FOUND") return "账号已不存在，请关闭弹窗并刷新列表。";
  if (code === "BAD_REQUEST")
    return operation === "own"
      ? "密码修改失败，请检查当前密码和新密码后重试。"
      : "提交内容不符合要求，请检查手机号、姓名和密码后重试。";
  if (operation === "list") return "管理员列表加载失败，请检查网络后重试。";
  if (operation === "own") return "密码修改失败，请检查当前密码和网络后重试。";
  return "操作未完成，请检查网络和输入后重试；不会自动重复提交。";
}

function signedInLabel(value: AdministratorAccount["lastSignedIn"]) {
  if (!value) return "暂无登录记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "暂无登录记录"
    : date.toLocaleString("zh-CN");
}

export default function AdministratorManagement({
  currentUserId,
  canChangeOwnPassword,
  onDirtyChange,
}: AdministratorManagementProps) {
  const list = trpc.administratorManagement.list.useQuery(undefined, {
    retry: false,
  });
  const utils = trpc.useUtils();
  const create = trpc.administratorManagement.create.useMutation({
    gcTime: 0,
    retry: false,
  });
  const update = trpc.administratorManagement.update.useMutation({
    gcTime: 0,
    retry: false,
  });
  const resetPassword = trpc.administratorManagement.resetPassword.useMutation({
    gcTime: 0,
    retry: false,
  });
  // The existing tRPC procedure is changeLocalPassword; its server function is changeLocalManagerPassword.
  const changeOwnPassword = trpc.auth.changeLocalPassword.useMutation({
    gcTime: 0,
    retry: false,
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [notice, setNotice] = useState("");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // Synchronous guard also blocks a second submit/close before React rerenders.
  const submitting = useRef(false);
  const [authorization, setAuthorization] =
    useState<AuthorizationTarget | null>(null);
  const [createdAccount, setCreatedAccount] =
    useState<AuthorizationTarget | null>(null);

  const accounts = useMemo(() => {
    // The server whitelist excludes drivers. Keep a defensive guard for unexpected/stale fixtures.
    return (list.data ?? []).filter(
      account =>
        (account as { loginMethod?: string | null }).loginMethod !==
        "local_driver"
    );
  }, [list.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const phoneTerm = normalizePhone(term);
    return accounts.filter(
      account =>
        (status === "all" || account.localAccountStatus === status) &&
        (!term ||
          (account.name ?? "").toLocaleLowerCase().includes(term) ||
          (account.localUsername ?? "").includes(phoneTerm || term))
    );
  }, [accounts, search, status]);
  const pagination = useFinancePagination(
    filtered,
    JSON.stringify([search, status])
  );
  const pending =
    busy ||
    create.isPending ||
    update.isPending ||
    resetPassword.isPending ||
    changeOwnPassword.isPending;
  const dirty =
    editor !== null &&
    (Object.keys(draft) as (keyof Draft)[]).some(
      key => draft[key] !== editor.initial[key]
    );

  // Parent workspace guard handles sidebar/history navigation. An open authorization
  // editor is conservatively dirty: its separate component owns the draft/pending state.
  useEffect(() => {
    onDirtyChange?.(Boolean(editor) || Boolean(authorization) || pending);
  }, [editor, authorization, pending, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function clearEditor() {
    // Passwords live only in transient component state; clear all sensitive values on exit.
    setDraft(emptyDraft());
    setEditor(null);
    setErrors({});
    setSubmitError("");
    setDiscardConfirm(false);
  }

  function requestClose() {
    if (submitting.current || pending) return;
    if (dirty) setDiscardConfirm(true);
    else clearEditor();
  }

  function openEditor(
    kind: Editor["kind"],
    target: AdministratorAccount | null = null
  ) {
    if (submitting.current || pending || editor || authorization) return;
    if ((kind === "edit" || kind === "reset") && target?.role !== "user")
      return;
    if (kind === "own" && !canChangeOwnPassword) return;
    const initial =
      kind === "edit" && target
        ? {
            ...emptyDraft(),
            username: target.localUsername ?? "",
            displayName: target.name ?? "",
            status:
              target.localAccountStatus === "disabled"
                ? ("disabled" as const)
                : ("active" as const),
            loginMode: (["pc", "mobile", "both"].includes(
              target.localLoginMode ?? ""
            )
              ? target.localLoginMode
              : "both") as LoginMode,
          }
        : emptyDraft();
    setDraft(initial);
    setEditor({ kind, target, initial });
    setErrors({});
    setSubmitError("");
    setDiscardConfirm(false);
    setNotice("");
  }

  function changeField<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (submitting.current || pending) return;
    setDraft(previous => ({ ...previous, [key]: value }));
    setErrors(previous => ({ ...previous, [key]: undefined }));
    setSubmitError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor || submitting.current || pending || discardConfirm) return;
    const validation: FieldErrors = {};
    const isAccount = editor.kind === "create" || editor.kind === "edit";
    const hasNewPassword = editor.kind !== "edit";
    if (isAccount) {
      if (!/^1[3-9]\d{9}$/.test(normalizePhone(draft.username)))
        validation.username = "请输入有效的中国大陆手机号。";
      if (
        draft.displayName.trim().length < 2 ||
        draft.displayName.trim().length > 128
      )
        validation.displayName = "姓名需为 2–128 个字符。";
    }
    if (hasNewPassword) {
      if (draft.password.length < 8 || draft.password.length > 128)
        validation.password = "密码需为 8–128 位。";
      if (draft.confirmation !== draft.password || !draft.confirmation)
        validation.confirmation = "两次输入的密码不一致，请重新确认。";
    }
    if (
      editor.kind === "own" &&
      (!draft.currentPassword || draft.currentPassword.length > 256)
    )
      validation.currentPassword = "请输入当前密码（最多 256 位）。";
    setErrors(validation);
    setSubmitError("");
    if (Object.keys(validation).length) return;

    submitting.current = true;
    setBusy(true);
    const operation = editor.kind;
    const mutation =
      operation === "create"
        ? create
        : operation === "edit"
          ? update
          : operation === "reset"
            ? resetPassword
            : changeOwnPassword;
    try {
      if (operation === "create") {
        const result = await create.mutateAsync({
          username: normalizePhone(draft.username),
          displayName: draft.displayName.trim(),
          initialPassword: draft.password,
          status: draft.status,
          loginMode: draft.loginMode,
        });
        setCreatedAccount({
          userId: result.userId,
          name: draft.displayName.trim(),
        });
        setNotice(
          "账号已创建。下一步请分配岗位、项目和操作权限；创建账号不代表已授权。"
        );
      } else if (operation === "edit" && editor.target?.role === "user") {
        await update.mutateAsync({
          userId: editor.target.id,
          username: normalizePhone(draft.username),
          displayName: draft.displayName.trim(),
          status: draft.status,
          loginMode: draft.loginMode,
        });
        setNotice("账号资料已保存，岗位和操作权限未改变。");
      } else if (operation === "reset" && editor.target?.role === "user") {
        await resetPassword.mutateAsync({
          userId: editor.target.id,
          newPassword: draft.password,
        });
        setNotice(
          "新密码已设置，请通过安全方式通知本人。本界面不读取或显示旧密码。"
        );
      } else if (operation === "own" && canChangeOwnPassword) {
        await changeOwnPassword.mutateAsync({
          currentPassword: draft.currentPassword,
          newPassword: draft.password,
        });
        setNotice("我的密码已修改，请妥善保管新密码。");
      } else {
        throw new Error("Target is not editable");
      }
      clearEditor();
      // Refresh errors are rendered by the query, never misreported as a failed mutation.
      if (operation !== "own")
        void utils.administratorManagement.list
          .invalidate()
          .catch(() => undefined);
    } catch (error) {
      setSubmitError(friendlyError(error, operation));
    } finally {
      // Remove submitted password variables from the mutation observer/cache after settling.
      mutation.reset();
      submitting.current = false;
      setBusy(false);
    }
  }

  const accountForm = editor?.kind === "create" || editor?.kind === "edit";
  const title =
    editor?.kind === "create"
      ? "添加 PC 管理员"
      : editor?.kind === "edit"
        ? "编辑管理员账号"
        : editor?.kind === "reset"
          ? "重置管理员密码"
          : "修改我的密码";
  const hasQueryError = list.isError || Boolean(list.error);

  function fieldError(key: keyof Draft) {
    return errors[key] ? (
      <p
        id={`administrator-${key}-error`}
        role="alert"
        className="mt-1 text-xs text-destructive"
      >
        {errors[key]}
      </p>
    ) : null;
  }

  return (
    <section
      aria-label="管理员管理"
      className="w-full min-w-0 space-y-4 text-foreground"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UsersRound className="size-5 shrink-0" aria-hidden="true" />
            PC 管理员管理
          </h2>
          <p className="text-sm text-muted-foreground">
            集中管理普通管理员账号、登录终端与分权配置，不包含司机账号。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canChangeOwnPassword && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !!editor || !!authorization}
              onClick={() => openEditor("own")}
            >
              <KeyRound className="size-4" aria-hidden="true" />
              修改我的密码
            </Button>
          )}
          <Button
            size="sm"
            disabled={
              pending ||
              !!editor ||
              !!authorization ||
              hasQueryError ||
              list.isLoading
            }
            onClick={() => openEditor("create")}
          >
            <Plus className="size-4" aria-hidden="true" />
            新增管理员
          </Button>
        </div>
      </header>
      <div className="rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed">
        <p>
          新建账号默认为 PC 普通管理员，使用原普通管理入口登录；PC
          端采用超级管理员菜单界面布局，但仅显示已授权菜单。终端类型不代替岗位或项目授权。
        </p>
        <p className="text-muted-foreground">
          PC
          超级后台入口仍由服务端二次校验超级管理员身份，不能通过修改终端类型获得超级权限。
        </p>
        {!canChangeOwnPassword && (
          <p className="mt-1 text-muted-foreground">
            当前登录方式不支持在此修改密码；第三方登录密码请到对应登录服务修改。
          </p>
        )}
      </div>
      {notice && (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          {notice}
        </p>
      )}
      {createdAccount && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/25 bg-primary/5 p-3 text-sm">
          <span className="min-w-0 break-words">
            {createdAccount.name}：下一步，分配岗位 / 项目 / 操作权限。
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || !!editor || !!authorization}
              onClick={() => setAuthorization(createdAccount)}
            >
              下一步：分配权限
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreatedAccount(null)}
            >
              稍后配置
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-3 rounded-lg border bg-card p-3 text-card-foreground sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label
            className="min-w-0 flex-1 basis-64 space-y-1 text-sm"
            htmlFor="administrator-search"
          >
            <span className="flex items-center gap-1">
              <Search className="size-3.5" aria-hidden="true" />
              姓名 / 手机号
            </span>
            <Input
              id="administrator-search"
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="搜索姓名或登录手机号"
            />
          </label>
          <label
            htmlFor="administrator-status-filter"
            className="w-full space-y-1 text-sm sm:w-36"
          >
            <span>账号状态</span>
            <select
              id="administrator-status-filter"
              className={selectClass}
              value={status}
              onChange={event => setStatus(event.target.value)}
            >
              <option value="all">全部状态</option>
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={list.isFetching}
            onClick={() => {
              void list.refetch();
            }}
          >
            刷新列表
          </Button>
        </div>
        {list.isLoading ? (
          <p
            role="status"
            className="py-10 text-center text-sm text-muted-foreground"
          >
            正在加载管理员账号…
          </p>
        ) : hasQueryError ? (
          <div
            role="alert"
            className="space-y-3 rounded-md bg-destructive/5 p-4 text-sm"
          >
            <p>{friendlyError(list.error, "list")}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={list.isFetching}
              onClick={() => {
                void list.refetch();
              }}
            >
              重试加载
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <p>
              {accounts.length === 0
                ? "暂无管理员账号。可新增普通管理员后分配权限。"
                : "没有匹配的管理员，请调整姓名、手机号或状态筛选。"}
            </p>
            {accounts.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                }}
              >
                清除筛选
              </Button>
            )}
          </div>
        ) : (
          <table
            className="block w-full table-fixed text-left text-sm sm:table"
            aria-label="管理员账号列表"
          >
            <thead className="hidden bg-muted/50 text-xs text-muted-foreground sm:table-header-group">
              <tr>
                <th scope="col" className="w-[25%] p-2 font-medium">
                  姓名 / 手机号
                </th>
                <th scope="col" className="w-[18%] p-2 font-medium">
                  账号 / 终端
                </th>
                <th scope="col" className="w-[24%] p-2 font-medium">
                  最近登录
                </th>
                <th scope="col" className="p-2 font-medium">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {pagination.pageRows.map(account => {
                const editable = account.role === "user";
                return (
                  <tr
                    key={account.id}
                    className="block border-b last:border-0 hover:bg-muted/20 sm:table-row"
                  >
                    <td className="block min-w-0 break-words px-2 pb-1 pt-3 align-top sm:table-cell sm:py-2">
                      <div className="font-medium">
                        {account.name || "未填写姓名"}
                        {account.id === currentUserId && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            （本人）
                          </span>
                        )}
                      </div>
                      <div className="break-all text-xs text-muted-foreground">
                        {account.localUsername || "未设置登录手机号"}
                      </div>
                      {!editable && (
                        <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                          {account.role === "admin"
                            ? "超级管理员 · 只读"
                            : "受保护账号 · 只读"}
                        </span>
                      )}
                    </td>
                    <td className="block min-w-0 px-2 py-1 align-top sm:table-cell sm:py-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs ${account.localAccountStatus === "active" ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"}`}
                      >
                        {account.localAccountStatus === "active"
                          ? "启用"
                          : account.localAccountStatus === "disabled"
                            ? "停用"
                            : "待确认"}
                      </span>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {account.localLoginMode === "pc"
                          ? "仅电脑端"
                          : account.localLoginMode === "mobile"
                            ? "仅手机端"
                            : account.localLoginMode === "both"
                              ? "电脑和手机"
                              : "终端待确认"}
                      </div>
                    </td>
                    <td className="block min-w-0 break-words px-2 py-1 text-xs text-muted-foreground sm:table-cell sm:py-2">
                      <span className="sm:hidden">最近登录：</span>
                      {signedInLabel(account.lastSignedIn)}
                    </td>
                    <td className="block px-2 pb-3 pt-1 align-top sm:table-cell sm:py-2">
                      {editable ? (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            aria-label={`编辑${account.name || "管理员"}`}
                            disabled={pending || !!editor || !!authorization}
                            onClick={() => openEditor("edit", account)}
                          >
                            编辑
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            aria-label={`配置${account.name || "管理员"}权限`}
                            disabled={pending || !!editor || !!authorization}
                            onClick={() =>
                              setAuthorization({
                                userId: account.id,
                                name: account.name || "管理员",
                              })
                            }
                          >
                            权限配置
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            aria-label={`重置${account.name || "管理员"}密码`}
                            disabled={pending || !!editor || !!authorization}
                            onClick={() => openEditor("reset", account)}
                          >
                            重置密码
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          不允许编辑、授权或重置密码
                          {account.id === currentUserId && canChangeOwnPassword
                            ? "；请使用上方“修改我的密码”。"
                            : "。"}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!list.isLoading && !hasQueryError && (
          <FinancePagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            label="管理员账号"
          />
        )}
      </div>
      <Dialog
        open={!!editor}
        onOpenChange={open => {
          if (!open) requestClose();
        }}
      >
        {editor && (
          <DialogContent
            showCloseButton={false}
            className="sm:max-w-4xl xl:max-w-4xl 2xl:max-w-4xl sm:max-h-[calc(100dvh-2rem)]"
            onEscapeKeyDown={event => {
              event.preventDefault();
              requestClose();
            }}
            onInteractOutside={event => {
              event.preventDefault();
              requestClose();
            }}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {accountForm
                  ? "管理员账号与员工主档关联保持不变；账号编辑不会改变岗位、项目或操作权限。"
                  : editor.kind === "reset"
                    ? `为${editor.target?.name || "管理员"}设置新密码。本界面不读取、不显示旧密码，也无需输入旧密码。`
                    : "修改本人的本地管理账号密码，需要验证当前密码。"}
              </DialogDescription>
            </DialogHeader>
            <form noValidate onSubmit={submit} className="min-w-0 space-y-4">
              <fieldset
                disabled={pending || discardConfirm}
                className="min-w-0 space-y-4 disabled:opacity-70"
              >
                {accountForm && (
                  <>
                    <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3 text-sm">
                      <ShieldCheck
                        className="size-4 shrink-0"
                        aria-hidden="true"
                      />
                      账号身份：普通管理员（固定，不可任命超级管理员）
                    </div>
                    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="administrator-username"
                          className="mb-1 block text-sm font-medium"
                        >
                          登录手机号
                        </label>
                        <Input
                          id="administrator-username"
                          type="tel"
                          inputMode="tel"
                          autoComplete="off"
                          maxLength={32}
                          value={draft.username}
                          onChange={event =>
                            changeField("username", event.target.value)
                          }
                          aria-invalid={!!errors.username}
                          aria-describedby={
                            errors.username
                              ? "administrator-username-error"
                              : undefined
                          }
                        />
                        {fieldError("username")}
                      </div>
                      <div>
                        <label
                          htmlFor="administrator-displayName"
                          className="mb-1 block text-sm font-medium"
                        >
                          姓名
                        </label>
                        <Input
                          id="administrator-displayName"
                          autoComplete="off"
                          maxLength={128}
                          value={draft.displayName}
                          onChange={event =>
                            changeField("displayName", event.target.value)
                          }
                          aria-invalid={!!errors.displayName}
                          aria-describedby={
                            errors.displayName
                              ? "administrator-displayName-error"
                              : undefined
                          }
                        />
                        {fieldError("displayName")}
                      </div>
                      <div>
                        <label
                          htmlFor="administrator-account-status"
                          className="mb-1 block text-sm font-medium"
                        >
                          账号状态
                        </label>
                        <select
                          id="administrator-account-status"
                          className={selectClass}
                          value={draft.status}
                          onChange={event =>
                            changeField(
                              "status",
                              event.target.value as AccountStatus
                            )
                          }
                        >
                          <option value="active">启用</option>
                          <option value="disabled">停用</option>
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor="administrator-login-mode"
                          className="mb-1 block text-sm font-medium"
                        >
                          允许登录的终端
                        </label>
                        <select
                          id="administrator-login-mode"
                          className={selectClass}
                          value={draft.loginMode}
                          onChange={event =>
                            changeField(
                              "loginMode",
                              event.target.value as LoginMode
                            )
                          }
                        >
                          <option value="both">电脑和手机</option>
                          <option value="pc">仅电脑端</option>
                          <option value="mobile">仅手机端</option>
                        </select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      普通管理员从原普通管理入口登录。启用账号和允许电脑登录均不代表获得超级后台权限。
                    </p>
                  </>
                )}
                {editor.kind === "own" && (
                  <div>
                    <label
                      htmlFor="administrator-currentPassword"
                      className="mb-1 block text-sm font-medium"
                    >
                      当前密码
                    </label>
                    <Input
                      id="administrator-currentPassword"
                      type="password"
                      autoComplete="current-password"
                      maxLength={256}
                      value={draft.currentPassword}
                      onChange={event =>
                        changeField("currentPassword", event.target.value)
                      }
                      aria-invalid={!!errors.currentPassword}
                      aria-describedby={
                        errors.currentPassword
                          ? "administrator-currentPassword-error"
                          : undefined
                      }
                    />
                    {fieldError("currentPassword")}
                  </div>
                )}
                {editor.kind !== "edit" && (
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="administrator-password"
                        className="mb-1 block text-sm font-medium"
                      >
                        {editor.kind === "create" ? "初始密码" : "新密码"}
                      </label>
                      <Input
                        id="administrator-password"
                        type="password"
                        autoComplete="new-password"
                        maxLength={128}
                        value={draft.password}
                        onChange={event =>
                          changeField("password", event.target.value)
                        }
                        aria-invalid={!!errors.password}
                        aria-describedby={
                          errors.password
                            ? "administrator-password-error"
                            : "administrator-password-hint"
                        }
                      />
                      {fieldError("password")}
                      <p
                        id="administrator-password-hint"
                        className="mt-1 text-xs text-muted-foreground"
                      >
                        8–128 位；建议组合字母、数字和符号。
                      </p>
                    </div>
                    <div>
                      <label
                        htmlFor="administrator-confirmation"
                        className="mb-1 block text-sm font-medium"
                      >
                        确认{editor.kind === "create" ? "初始密码" : "新密码"}
                      </label>
                      <Input
                        id="administrator-confirmation"
                        type="password"
                        autoComplete="new-password"
                        maxLength={128}
                        value={draft.confirmation}
                        onChange={event =>
                          changeField("confirmation", event.target.value)
                        }
                        aria-invalid={!!errors.confirmation}
                        aria-describedby={
                          errors.confirmation
                            ? "administrator-confirmation-error"
                            : undefined
                        }
                      />
                      {fieldError("confirmation")}
                    </div>
                  </div>
                )}
              </fieldset>
              {submitError && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {submitError} 可修改后再次提交，或取消退出。
                </p>
              )}
              {discardConfirm ? (
                <div
                  role="alertdialog"
                  aria-label="确认放弃未保存修改"
                  className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  <p>
                    存在未保存的修改，确定放弃并退出吗？退出后将清除本次输入的密码。
                  </p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => setDiscardConfirm(false)}
                    >
                      继续编辑
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={pending}
                      onClick={() => {
                        if (!submitting.current && !pending) clearEditor();
                      }}
                    >
                      放弃修改并退出
                    </Button>
                  </div>
                </div>
              ) : (
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={requestClose}
                  >
                    取消
                  </Button>
                  <Button type="submit" disabled={pending}>
                    {pending
                      ? "正在提交…"
                      : editor.kind === "create"
                        ? "创建账号"
                        : editor.kind === "edit"
                          ? "保存账号"
                          : "确认设置密码"}
                  </Button>
                </DialogFooter>
              )}
              {pending && (
                <p
                  role="status"
                  className="text-center text-xs text-muted-foreground"
                >
                  正在提交，请稍候；此时不可重复操作或关闭弹窗。
                </p>
              )}
            </form>
          </DialogContent>
        )}
      </Dialog>
      {authorization && (
        <AdministratorAuthorizationEditor
          key={authorization.userId}
          userId={authorization.userId}
          name={authorization.name}
          onClose={() => setAuthorization(null)}
          onSaved={() => {
            setAuthorization(null);
            if (createdAccount?.userId === authorization.userId)
              setCreatedAccount(null);
            setNotice("权限配置已保存；实际访问以服务端权限校验为准。");
          }}
        />
      )}
    </section>
  );
}
