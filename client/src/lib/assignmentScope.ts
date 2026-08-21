/**
 * 人员角色授权只能按“部门范围”或“具体项目范围”二选一保存。
 * 若选择具体项目，项目范围始终优先，以防历史双范围组合被误投影为部门授权。
 */
export function getAssignmentScopeSaveInput(input: { organizationId: string; projectId: string }) {
  const projectId = Number(input.projectId);
  if (Number.isSafeInteger(projectId) && projectId > 0) return { organizationId: null, projectId };
  const organizationId = Number(input.organizationId);
  return { organizationId: Number.isSafeInteger(organizationId) && organizationId > 0 ? organizationId : null, projectId: null };
}
