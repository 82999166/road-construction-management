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
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

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
  const runtimeDir = typeof import.meta.dirname === "string" ? import.meta.dirname : process.cwd();
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
