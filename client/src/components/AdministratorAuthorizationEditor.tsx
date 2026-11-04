import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { trpc } from "@/lib/trpc";
import { formatChinaDateTime } from "@/lib/businessTime";
import {
  assignmentIsCurrent,
  authorizationAssignmentIssues,
  authorizationActionLabel,
  authorizationDisplayName,
  authorizationDraftIssues,
  authorizationModuleLabel,
  buildAuthorizationInput,
  createAuthorizationDraft,
  effectiveModulePermissionIds,
  fromAuthorizationTimeInput,
  isAssignableOrganization,
  isAssignablePermission,
  isAssignableProject,
  isAssignableRole,
  modulePermissionIds,
  toAuthorizationTimeInput,
  type AuthorizationCatalog,
  type AuthorizationDraft,
} from "./administratorAuthorizationHelpers";

export type AdministratorAuthorizationEditorProps = {
  userId: number;
  name: string;
  onClose: () => void;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};
type Baseline = { ids: number[]; ready: boolean; error: boolean };
const QUERY_OPTIONS = { retry: false, refetchOnWindowFocus: false } as const;
const SELECT_CLASS =
  "h-9 w-full min-w-0 max-w-full rounded-md border bg-background px-2 text-sm";

/** 每个岗位独立 hook，岗位数量变化不改变父组件 hook 次序。 */
function RoleBaseline({
  roleId,
  name,
  onChange,
}: {
  roleId: number;
  name: string;
  onChange: (roleId: number, value: Baseline) => void;
}) {
  const query = trpc.admin.role.permissionIds.useQuery(
    { roleId },
    QUERY_OPTIONS
  );
  useEffect(() => {
    onChange(roleId, {
      ids: query.data ?? [],
      ready: Array.isArray(query.data) && !query.isFetching && !query.isError,
      error: query.isError,
    });
  }, [roleId, query.data, query.isFetching, query.isError, onChange]);
  return (
    <span className="break-words rounded border px-2 py-1 text-xs">
      {name}：
      {query.isError
        ? "岗位权限读取失败"
        : query.isFetching || !query.data
          ? "读取岗位权限中"
          : `岗位基线 ${query.data.length} 项`}
    </span>
  );
}

/** userId 切换应由父级 key 卸载；此窗口不会以后台刷新覆盖未提交输入。 */
export function AdministratorAuthorizationEditor({
  userId,
  name,
  onClose,
  onSaved,
  onDirtyChange,
}: AdministratorAuthorizationEditorProps) {
  const authorization = trpc.administratorManagement.authorization.useQuery(
    { userId },
    QUERY_OPTIONS
  );
  const roles = trpc.admin.role.list.useQuery(undefined, QUERY_OPTIONS);
  const permissions = trpc.admin.role.permissions.useQuery(
    undefined,
    QUERY_OPTIONS
  );
  const organizations = trpc.admin.organization.list.useQuery(
    undefined,
    QUERY_OPTIONS
  );
  const projects = trpc.admin.project.listAccessible.useQuery(
    undefined,
    QUERY_OPTIONS
  );
  const save = trpc.administratorManagement.saveAuthorization.useMutation();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<AuthorizationDraft | null>(null);
  const [initial, setInitial] = useState<AuthorizationDraft | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [tab, setTab] = useState<"assignments" | "permissions">("assignments");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false);
  const [baselines, setBaselines] = useState<Record<number, Baseline>>({});
  const reportBaseline = useCallback((roleId: number, baseline: Baseline) => {
    setBaselines(current => ({ ...current, [roleId]: baseline }));
  }, []);
  useEffect(() => {
    if (!draft && authorization.data && !authorization.isError) {
      const loaded = createAuthorizationDraft(authorization.data);
      setDraft(loaded);
      setInitial(loaded);
      setRevision(authorization.data.revision);
    }
  }, [authorization.data, authorization.isError, draft]);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(initial);
  const pending = submitting || save.isPending || reading;
  const dirtyCallback = useRef(onDirtyChange);
  useEffect(() => {
    dirtyCallback.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    dirtyCallback.current?.(dirty || pending);
  }, [dirty, pending]);
  useEffect(
    () => () => {
      dirtyCallback.current?.(false);
    },
    []
  );

  const catalog: AuthorizationCatalog = useMemo(
    () => ({
      roles: roles.data ?? [],
      permissions: permissions.data ?? [],
      organizations: organizations.data ?? [],
      projects: projects.data ?? [],
    }),
    [roles.data, permissions.data, organizations.data, projects.data]
  );
  const catalogQueries = [roles, permissions, organizations, projects];
  const loadFailed =
    authorization.isError || catalogQueries.some(query => query.isError);
  const loading =
    authorization.isFetching || catalogQueries.some(query => query.isFetching);
  const catalogPresent =
    catalogQueries.every(query => Array.isArray(query.data)) &&
    catalog.roles.some(isAssignableRole) &&
    catalog.permissions.some(isAssignablePermission) &&
    (catalog.organizations.some(isAssignableOrganization) ||
      catalog.projects.some(isAssignableProject));
  const issues = draft ? authorizationDraftIssues(draft, catalog) : [];
  const selectedRoles = useMemo(() => {
    const ids = new Set(draft?.assignments.map(item => item.roleId) ?? []);
    return catalog.roles.filter(
      role => ids.has(role.id) && isAssignableRole(role)
    );
  }, [draft?.assignments, catalog.roles]);
  const baselineReady = selectedRoles.every(role => baselines[role.id]?.ready);
  const baselineError = selectedRoles.some(role => baselines[role.id]?.error);
  const inheritedIds = Array.from(
    new Set(
      (draft?.assignments ?? [])
        .filter(
          item =>
            assignmentIsCurrent(item) &&
            !authorizationAssignmentIssues(item, catalog).length
        )
        .flatMap(item => baselines[item.roleId]?.ids ?? [])
    )
  );
  const editablePermissions = catalog.permissions.filter(
    isAssignablePermission
  );
  const groups = Array.from(
    new Set(editablePermissions.map(item => item.module))
  );
  const unavailablePermissionIds =
    draft?.permissionIds.filter(
      id => !editablePermissions.some(item => item.id === id)
    ) ?? [];
  const canSave =
    !!draft &&
    revision !== null &&
    !!revision &&
    !pending &&
    !loading &&
    !loadFailed &&
    catalogPresent &&
    baselineReady &&
    !baselineError &&
    !issues.length &&
    dirty;
  const requestClose = () => {
    if (lock.current || pending) return;
    if (dirty && !window.confirm("授权修改尚未保存，确定放弃修改并关闭吗？"))
      return;
    onClose();
  };
  const updateAssignment = (
    index: number,
    values: Partial<AuthorizationDraft["assignments"][number]>
  ) => {
    if (pending) return;
    setDraft(
      current =>
        current && {
          ...current,
          assignments: current.assignments.map((item, i) =>
            i === index ? { ...item, ...values } : item
          ),
        }
    );
  };
  const removeAssignment = (index: number) => {
    if (!draft || pending) return;
    if (
      draft.assignments.length === 1 &&
      !window.confirm(
        "将撤销全部岗位及数据范围；无岗位不代表全公司权限。确认清空全部岗位授予吗？"
      )
    )
      return;
    setDraft(
      current =>
        current && {
          ...current,
          assignments: current.assignments.filter((_, i) => i !== index),
        }
    );
  };
  const clearAssignments = () => {
    if (
      !draft ||
      pending ||
      !draft.assignments.length ||
      !window.confirm(
        "将撤销全部岗位及数据范围；服务器保留撤销历史。无岗位不代表全公司权限。确认清空全部岗位授予吗？"
      )
    )
      return;
    setDraft(current => current && { ...current, assignments: [] });
  };
  const clearPermissions = (module?: string) => {
    if (!draft || pending) return;
    const message = module
      ? `清空“${authorizationModuleLabel(module)}”专属权限后，将继承该模块岗位权限，不是全部禁用。确认继续吗？`
      : "清空全部专属权限后，各模块将沿用岗位权限，不是全部禁用。确认回归岗位权限吗？";
    if (!window.confirm(message)) return;
    const ids = module
      ? modulePermissionIds(module, catalog.permissions)
      : draft.permissionIds;
    setDraft(
      current =>
        current && {
          ...current,
          permissionIds: current.permissionIds.filter(id => !ids.includes(id)),
        }
    );
  };
  const togglePermission = (id: number, checked: boolean) => {
    if (!draft || pending) return;
    const permission = editablePermissions.find(item => item.id === id);
    if (!permission) return;
    const selectedInModule = draft.permissionIds.filter(item =>
      modulePermissionIds(permission.module, catalog.permissions).includes(item)
    );
    if (
      !checked &&
      selectedInModule.length === 1 &&
      !window.confirm(
        `取消最后一项“${authorizationModuleLabel(permission.module)}”专属权限将继承该模块岗位权限，不是全部禁用。确认继续吗？`
      )
    )
      return;
    setDraft(
      current =>
        current && {
          ...current,
          permissionIds: checked
            ? Array.from(new Set([...current.permissionIds, id]))
            : current.permissionIds.filter(item => item !== id),
        }
    );
  };
  const readBack = async () => {
    if (lock.current || pending) return;
    if (
      dirty &&
      !window.confirm("重新读取服务器授权将替换当前未保存修改，确定回读吗？")
    )
      return;
    lock.current = true;
    setReading(true);
    setError("");
    try {
      const [
        result,
        roleResult,
        permissionResult,
        organizationResult,
        projectResult,
      ] = await Promise.all([
        authorization.refetch(),
        roles.refetch(),
        permissions.refetch(),
        organizations.refetch(),
        projects.refetch(),
        utils.admin.role.permissionIds.invalidate(),
      ]);
      if (
        result.error ||
        !result.data ||
        [roleResult, permissionResult, organizationResult, projectResult].some(
          item => item.error || !Array.isArray(item.data)
        )
      )
        throw new Error("授权读取失败");
      const loaded = createAuthorizationDraft(result.data);
      setDraft(loaded);
      setInitial(loaded);
      setRevision(result.data.revision);
    } catch {
      setError("重新读取失败，原有输入仍保留。请稍后再次回读。");
    } finally {
      lock.current = false;
      setReading(false);
    }
  };
  const submit = async () => {
    if (!canSave || lock.current || !draft || revision === null) return;
    if (
      initial?.assignments.length &&
      !draft.assignments.length &&
      !window.confirm(
        "保存后全部岗位授予将撤销并保留历史，确认保存空岗位范围吗？"
      )
    )
      return;
    lock.current = true;
    setSubmitting(true);
    setError("");
    try {
      await save.mutateAsync(buildAuthorizationInput(userId, revision, draft));
    } catch {
      setError(
        "授权保存失败：可能授权已被他人修改、账号已停用或网络异常。您的输入和读取版本已保留；可重新读取服务器授权后核对再提交。"
      );
      lock.current = false;
      setSubmitting(false);
      return;
    }
    // 成功写入后不以失效旧 revision 再提交。回读失败仍按已保存处理，避免误报保存失败。
    setInitial(draft);
    await Promise.allSettled([
      authorization.refetch(),
      utils.administratorManagement.list.invalidate(),
    ]);
    lock.current = false;
    setSubmitting(false);
    dirtyCallback.current?.(false);
    onSaved();
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-4xl xl:max-w-4xl gap-3 overflow-x-clip"
        onEscapeKeyDown={event => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="break-words">管理员授权 · {name}</DialogTitle>
          <DialogDescription>
            PC端沿用管理后台布局，仅显示授权业务菜单。操作权限仍受岗位、部门 /
            项目范围及有效期约束；可配置劳务管理岗位，不读取工资明细，此处不配置超级角色、司机或系统治理。
          </DialogDescription>
        </DialogHeader>
        <div
          role="tablist"
          aria-label="管理员授权设置"
          className="grid grid-cols-2 gap-2"
        >
          <Button
            type="button"
            role="tab"
            aria-selected={tab === "assignments"}
            aria-controls="authorization-assignments"
            variant={tab === "assignments" ? "secondary" : "outline"}
            onClick={() => setTab("assignments")}
            className="min-w-0 px-2"
          >
            岗位与数据范围
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={tab === "permissions"}
            aria-controls="authorization-permissions"
            variant={tab === "permissions" ? "secondary" : "outline"}
            onClick={() => setTab("permissions")}
            className="min-w-0 px-2"
          >
            菜单及操作
          </Button>
        </div>
        {(loadFailed || (!loading && !catalogPresent)) && (
          <p
            role="alert"
            className="break-words rounded border border-destructive/40 p-2 text-sm text-destructive"
          >
            {loadFailed
              ? "授权或目录加载失败，禁止保存以免覆盖已有授权。"
              : "可用授权目录缺失，禁止保存。请核对岗位、权限及数据范围目录。"}
          </p>
        )}
        {loading && (
          <p role="status" className="text-sm text-muted-foreground">
            正在读取授权及目录，暂不可保存。
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="break-words rounded border border-destructive/40 p-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {baselineError && (
          <p role="alert" className="text-sm text-destructive">
            岗位权限读取失败，禁止保存。请重新读取服务器授权。
          </p>
        )}
        <div className="min-w-0 max-h-[55dvh] space-y-3 overflow-x-clip overflow-y-auto pr-1">
          {draft && tab === "assignments" && (
            <section
              id="authorization-assignments"
              role="tabpanel"
              className="min-w-0 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  可添加多个部门或项目岗位。已到期、未来生效及失效授予均保留；撤销后服务器保留历史。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending || loadFailed || !catalogPresent}
                    onClick={() =>
                      setDraft(
                        current =>
                          current && {
                            ...current,
                            assignments: [
                              ...current.assignments,
                              {
                                roleId: 0,
                                organizationId: null,
                                projectId: null,
                                validFrom: null,
                                validTo: null,
                              },
                            ],
                          }
                      )
                    }
                  >
                    新增岗位授予
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending || !draft.assignments.length}
                    onClick={clearAssignments}
                  >
                    清空全部岗位
                  </Button>
                </div>
              </div>
              {!draft.assignments.length && (
                <p className="rounded border border-dashed p-3 text-sm">
                  尚无岗位和数据范围，不代表全公司 / 全项目访问权限。
                </p>
              )}
              {draft.assignments.map((item, index) => {
                const role = catalog.roles.find(
                  value => value.id === item.roleId
                );
                const organization = catalog.organizations.find(
                  value => value.id === item.organizationId
                );
                const project = catalog.projects.find(
                  value => value.id === item.projectId
                );
                const rowIssues = authorizationAssignmentIssues(item, catalog);
                const currentScope = item.projectId
                  ? `project:${item.projectId}`
                  : item.organizationId
                    ? `organization:${item.organizationId}`
                    : "";
                const scopeAvailable = item.projectId
                  ? project && isAssignableProject(project)
                  : item.organizationId
                    ? organization && isAssignableOrganization(organization)
                    : false;
                return (
                  <fieldset
                    key={item.id ?? `new-${index}`}
                    disabled={pending}
                    className="min-w-0 rounded border p-3 space-y-2"
                  >
                    <legend className="px-1 text-sm font-medium">
                      岗位授予 {index + 1}
                      {item.id ? " · 既有记录" : " · 新增"}
                    </legend>
                    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="min-w-0 space-y-1 text-xs">
                        岗位
                        <select
                          aria-label={`岗位 ${index + 1}`}
                          value={item.roleId || ""}
                          onChange={event =>
                            updateAssignment(index, {
                              roleId: Number(event.target.value),
                            })
                          }
                          className={SELECT_CLASS}
                        >
                          <option value="">请选择岗位</option>
                          {item.roleId > 0 &&
                            (!role || !isAssignableRole(role)) && (
                              <option value={item.roleId} disabled>
                                {role &&
                                role.category === "business" &&
                                !["SUPER_ADMIN", "DRIVER"].includes(role.code)
                                  ? authorizationDisplayName(
                                      role.name,
                                      "既有岗位"
                                    )
                                  : "既有岗位"}
                                （已停用 / 不可用）
                              </option>
                            )}
                          {catalog.roles.filter(isAssignableRole).map(value => (
                            <option key={value.id} value={value.id}>
                              {authorizationDisplayName(value.name, "业务岗位")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="min-w-0 space-y-1 text-xs">
                        部门 / 项目范围
                        <select
                          aria-label={`数据范围 ${index + 1}`}
                          value={currentScope}
                          onChange={event => {
                            const [type, id] = event.target.value.split(":");
                            updateAssignment(index, {
                              organizationId:
                                type === "organization" ? Number(id) : null,
                              projectId: type === "project" ? Number(id) : null,
                            });
                          }}
                          className={SELECT_CLASS}
                        >
                          <option value="">请选择具体范围（不是全公司）</option>
                          {currentScope && !scopeAvailable && (
                            <option value={currentScope} disabled>
                              {authorizationDisplayName(
                                project?.name ?? organization?.name,
                                "既有范围"
                              )}
                              （已停用 / 不可用）
                            </option>
                          )}
                          <optgroup label="部门 / 项目部">
                            {catalog.organizations
                              .filter(isAssignableOrganization)
                              .map(value => (
                                <option
                                  key={value.id}
                                  value={`organization:${value.id}`}
                                >
                                  {authorizationDisplayName(
                                    value.name,
                                    "部门范围"
                                  )}
                                </option>
                              ))}
                          </optgroup>
                          <optgroup label="具体项目">
                            {catalog.projects
                              .filter(isAssignableProject)
                              .map(value => (
                                <option
                                  key={value.id}
                                  value={`project:${value.id}`}
                                >
                                  {authorizationDisplayName(
                                    value.name,
                                    "项目范围"
                                  )}
                                </option>
                              ))}
                          </optgroup>
                        </select>
                      </label>
                      <label className="min-w-0 space-y-1 text-xs">
                        生效时间（北京时间，可空）
                        <Input
                          aria-label={`生效时间 ${index + 1}`}
                          type="datetime-local"
                          step="1"
                          value={toAuthorizationTimeInput(item.validFrom)}
                          onChange={event =>
                            updateAssignment(index, {
                              validFrom: fromAuthorizationTimeInput(
                                event.target.value
                              ),
                            })
                          }
                          className="min-w-0 max-w-full"
                        />
                      </label>
                      <label className="min-w-0 space-y-1 text-xs">
                        结束时间（北京时间，可空）
                        <Input
                          aria-label={`结束时间 ${index + 1}`}
                          type="datetime-local"
                          step="1"
                          value={toAuthorizationTimeInput(item.validTo)}
                          onChange={event =>
                            updateAssignment(index, {
                              validTo: fromAuthorizationTimeInput(
                                event.target.value
                              ),
                            })
                          }
                          className="min-w-0 max-w-full"
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="break-words text-xs text-muted-foreground">
                        {item.validTo &&
                        new Date(item.validTo).getTime() <= Date.now()
                          ? "已到期（保留记录）"
                          : item.validFrom &&
                              new Date(item.validFrom).getTime() > Date.now()
                            ? "尚未生效"
                            : "当前有效期"}{" "}
                        · {formatChinaDateTime(item.validFrom, "未限制开始")} 至{" "}
                        {formatChinaDateTime(item.validTo, "未限制结束")}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`撤销岗位授予 ${index + 1}`}
                        disabled={pending}
                        onClick={() => removeAssignment(index)}
                      >
                        撤销此授予
                      </Button>
                    </div>
                    {rowIssues.map(message => (
                      <p
                        key={message}
                        className="break-words text-xs text-destructive"
                      >
                        {message}
                      </p>
                    ))}
                  </fieldset>
                );
              })}
            </section>
          )}
          {draft && tab === "permissions" && (
            <section
              id="authorization-permissions"
              role="tabpanel"
              className="min-w-0 space-y-3"
            >
              <div className="rounded border bg-muted/30 p-2 text-xs space-y-1">
                <p>
                  未配置专属权限的模块沿用岗位权限，不是全部禁用。勾选模块内任一项后，仅该模块按所选专属权限覆盖岗位。
                </p>
                <p>
                  下列岗位基线仅供预览；最终访问由服务端岗位有效期、数据范围及业务守卫判定，不修改岗位模板。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || !draft.permissionIds.length}
                onClick={() => clearPermissions()}
              >
                清空全部专属，回归岗位
              </Button>
              {unavailablePermissionIds.length > 0 && (
                <div className="rounded border border-destructive/40 p-2 space-y-2">
                  <p className="text-xs text-destructive">
                    存在已停用 / 不可用专属权限，原值未清空，处理前禁止保存。
                  </p>
                  {unavailablePermissionIds.map((id, index) => (
                    <div
                      key={id}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <span>
                        {authorizationDisplayName(
                          catalog.permissions.find(item => item.id === id)
                            ?.name,
                          `既有权限 ${index + 1}`
                        )}
                        （不可用）
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        aria-label={`移除不可用权限 ${index + 1}`}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "确认移除此项不可用专属权限？移除后没有专属配置的模块将沿用岗位权限。"
                            )
                          )
                            return;
                          setDraft(
                            current =>
                              current && {
                                ...current,
                                permissionIds: current.permissionIds.filter(
                                  value => value !== id
                                ),
                              }
                          );
                        }}
                      >
                        明确移除
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {groups.map(module => {
                const points = editablePermissions.filter(
                  item => item.module === module
                );
                const explicit = draft.permissionIds.filter(id =>
                  points.some(point => point.id === id)
                );
                const effective = effectiveModulePermissionIds(
                  module,
                  editablePermissions,
                  draft.permissionIds,
                  inheritedIds
                );
                return (
                  <fieldset
                    key={module}
                    disabled={pending}
                    className="min-w-0 rounded border p-3 space-y-2"
                  >
                    <legend className="px-1 text-sm font-medium">
                      {authorizationModuleLabel(module)}
                    </legend>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {explicit.length
                          ? `专属配置 ${explicit.length} 项（覆盖此模块岗位权限）`
                          : "沿用岗位权限（不是全部禁用）"}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={pending || !explicit.length}
                        aria-label={`清空${authorizationModuleLabel(module)}专属权限`}
                        onClick={() => clearPermissions(module)}
                      >
                        清空模块专属
                      </Button>
                    </div>
                    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                      {points.map(point => (
                        <label
                          key={point.id}
                          className="flex min-w-0 items-start gap-2 rounded border p-2 text-xs"
                        >
                          <Input
                            type="checkbox"
                            aria-label={`${authorizationDisplayName(point.name, "业务权限")} · ${authorizationActionLabel(point.action)}`}
                            checked={draft.permissionIds.includes(point.id)}
                            onChange={event =>
                              togglePermission(point.id, event.target.checked)
                            }
                            className="mt-0.5 size-4 w-4 shrink-0 p-0"
                          />
                          <span className="min-w-0 break-words">
                            {authorizationDisplayName(point.name, "业务权限")}
                            <span className="ml-1 text-muted-foreground">
                              · {authorizationActionLabel(point.action)}
                            </span>
                            <span className="block text-muted-foreground">
                              {explicit.length
                                ? draft.permissionIds.includes(point.id)
                                  ? "专属允许"
                                  : "专属未选"
                                : !baselineReady
                                  ? "岗位基线读取中"
                                  : effective.includes(point.id)
                                    ? "岗位继承允许"
                                    : "岗位未配置此项"}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </section>
          )}
          {selectedRoles.length > 0 && (
            <div aria-label="岗位继承权限基线" className="flex flex-wrap gap-2">
              {selectedRoles.map(role => (
                <RoleBaseline
                  key={role.id}
                  roleId={role.id}
                  name={authorizationDisplayName(role.name, "业务岗位")}
                  onChange={reportBaseline}
                />
              ))}
            </div>
          )}
        </div>
        {issues.length > 0 && (
          <p role="status" className="text-xs text-destructive">
            有 {issues.length}{" "}
            项授权需要核对；处理岗位范围或不可用专属权限后才能保存。
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void readBack()}
          >
            重新读取服务器授权
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={requestClose}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() => void submit()}
          >
            {submitting || save.isPending ? "保存中…" : "保存授权"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export default AdministratorAuthorizationEditor;
