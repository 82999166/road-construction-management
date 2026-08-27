export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  tempAdminUsername: process.env.TEMP_ADMIN_USERNAME ?? "",
  tempAdminPassword: process.env.TEMP_ADMIN_PASSWORD ?? "",
  /** 仅用于受控应急恢复；生产环境已有永久管理员时默认关闭临时入口。 */
  tempAdminEnabled: process.env.TEMP_ADMIN_ENABLED ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  selfHostStorageDir: process.env.SELF_HOST_STORAGE_DIR ?? "",
};
