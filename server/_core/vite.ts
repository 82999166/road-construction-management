import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";

export async function setupVite(app: Express, server: Server) {
  const viteModuleName = "vite";
  const viteConfigModuleName = "../../vite.config";
  const [{ createServer: createViteServer }, { default: viteConfig }] = await Promise.all([
    import(viteModuleName),
    import(viteConfigModuleName),
  ]);
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      // 开发命令始终以项目根目录运行。避免 ESM 目录元信息在 CJS 自托管构建中被清空，
      // 从而让开发和生产路径解析采用明确、可预测的边界。
      const clientTemplate = path.resolve(process.cwd(), "client", "index.html");

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // 自托管 CJS 包的入口位于 dist/index.cjs，__dirname 即 dist 目录；
  // 原生 ESM/测试环境没有 __dirname 时再回退当前工作目录。
  const runtimeDir = typeof __dirname === "string" ? __dirname : process.cwd();
  const distPath = process.env.STATIC_PUBLIC_DIR
    ? path.resolve(process.env.STATIC_PUBLIC_DIR)
    : process.env.NODE_ENV === "development"
      ? path.resolve(runtimeDir, "../..", "dist", "public")
      : path.resolve(runtimeDir, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  /** 带内容哈希的 Vite 分包可长期缓存；版本切换后不会再被 HTML 文档缓存阻塞。 */
  app.use("/assets", express.static(path.resolve(distPath, "assets"), {
    fallthrough: false,
    immutable: true,
    maxAge: "1y",
    setHeaders(res) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }));

  /** 入口 HTML 和非哈希静态文件每次都需重新校验，避免引用已删除的旧动态分包。 */
  app.use(express.static(distPath, {
    index: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-cache");
    },
  }));

  // SPA 路由回退仅用于页面路径；缺失分包必须保持 404，不能回退为 HTML 200。
  app.use("*", (req, res) => {
    if (req.path.startsWith("/assets/")) {
      res.status(404).setHeader("Cache-Control", "no-store").end();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
