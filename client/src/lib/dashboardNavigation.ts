/** 首页只精确命中；业务子页可按路径段前缀命中，不能串联近似模块名。 */
export function isDashboardMenuActive(location: string, path: string) {
  const pathname = location.split(/[?#]/, 1)[0];
  return (
    pathname === path ||
    (path !== "/" && path !== "/admin" && pathname.startsWith(`${path}/`))
  );
}

/** 取消导航不得触发路由写入；当前页重复点击也不丢弃或询问草稿。 */
export function requestDashboardNavigation(
  currentLocation: string,
  nextPath: string,
  navigate: (path: string) => void,
  beforeNavigate?: (path: string) => boolean
) {
  if (currentLocation === nextPath) return false;
  if (beforeNavigate && !beforeNavigate(nextPath)) return false;
  navigate(nextPath);
  return true;
}
