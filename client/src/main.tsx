import { trpc } from "@/lib/trpc";
import { redirectToLoginForUnauthorizedError } from "@/lib/unauthorizedRedirect";
import { COOKIE_NAME } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getCurrentAppPath } from "./lib/authNavigation";
import "./index.css";

const queryClient = new QueryClient();

const DYNAMIC_IMPORT_RECOVERY_KEY = "yx-dynamic-import-recovery-at";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return "";
};

const isDynamicImportLoadError = (error: unknown) => {
  const message = getErrorMessage(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i.test(message);
};

const recoverFromDynamicImportLoadError = (error: unknown) => {
  if (typeof window === "undefined" || !isDynamicImportLoadError(error)) return;
  try {
    const lastReloadedAt = Number(sessionStorage.getItem(DYNAMIC_IMPORT_RECOVERY_KEY) ?? "0");
    const now = Date.now();
    if (Number.isFinite(lastReloadedAt) && now - lastReloadedAt < 60_000) return;
    sessionStorage.setItem(DYNAMIC_IMPORT_RECOVERY_KEY, String(now));
  } catch {
    // sessionStorage unavailable; still attempt one normal reload.
  }
  window.location.reload();
};

if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", event => recoverFromDynamicImportLoadError(event.reason));
  window.addEventListener("error", event => recoverFromDynamicImportLoadError(event.error ?? event.message));
}

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  // 未授权请求统一先进入站内登录页，避免网络层直接绕过用户可见的登录界面。
  redirectToLoginForUnauthorizedError(error.message, getCurrentAppPath(), (loginPath) => window.location.replace(loginPath));
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        // Preview auto-login fallback: when the browser blocks iframe cookies
        // (Safari ITP / private browsing / WebView), the runtime mirrors the
        // session into sessionStorage so we can forward it as a Bearer token.
        // The regular OAuth cookie flow keeps working and takes priority server-side.
        try {
          const raw = sessionStorage.getItem("manus-cookie");
          if (raw) {
            const prefix = `${COOKIE_NAME}=`;
            const pair = raw.split(";").find(s => s.trim().startsWith(prefix));
            const token = pair?.trim().slice(prefix.length);
            if (token) {
              return { Authorization: `Bearer ${token}` };
            }
          }
        } catch {
          // sessionStorage unavailable
        }
        return {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
