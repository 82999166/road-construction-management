/** 空、非整数或非正项目号一律不作为业务查询范围，避免前端误把缺省条件视为全项目。 */
export function getBusinessWorkspaceProjectState(value: string) {
  const projectId = Number(value);
  return {
    projectId: Number.isSafeInteger(projectId) && projectId > 0 ? projectId : 0,
    hasProject: Number.isSafeInteger(projectId) && projectId > 0,
  };
}

/** 投递审计仅在当前被点击的通知卡片内展开，避免跳转至页面下方的独立区域。 */
export function isInlineBroadcastDeliveryExpanded(selectedBroadcastId: number | undefined, broadcastId: number) {
  return selectedBroadcastId === broadcastId;
}

/** 权限页范围选择须区分加载中、尚未建立任何项目/组织范围和可正常选择三种状态。 */
export function getDepartmentScopePickerState(
  isLoading: boolean,
  organizationCount: number,
  projectCount = 0
) {
  if (isLoading) {
    return {
      disabled: true,
      placeholder: "正在加载项目与组织节点…",
      needsScopeSetup: false,
    };
  }
  if (organizationCount + projectCount === 0) {
    return {
      disabled: true,
      placeholder: "暂无项目或部门范围",
      needsScopeSetup: true,
    };
  }
  return {
    disabled: false,
    placeholder: "选择已有项目或部门/项目部",
    needsScopeSetup: false,
  };
}
