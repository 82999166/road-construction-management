import { trpc } from "@/lib/trpc";
import { Bell } from "lucide-react";
import { useLocation } from "wouter";

type PortalMessagesButtonProps = {
  isAuthenticated: boolean;
};

export function PortalMessagesButton({
  isAuthenticated,
}: PortalMessagesButtonProps) {
  return isAuthenticated ? (
    <AuthenticatedPortalMessagesButton isAuthenticated={isAuthenticated} />
  ) : null;
}

function AuthenticatedPortalMessagesButton({
  isAuthenticated,
}: PortalMessagesButtonProps) {
  const [, navigate] = useLocation();
  const unread = trpc.messages.unreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
    refetchInterval: 30_000,
  });
  const count = unread.error ? undefined : unread.data?.count;
  const hasCount =
    typeof count === "number" && Number.isInteger(count) && count >= 0;

  return (
    <button
      type="button"
      aria-label={hasCount ? `消息，${count} 条未读` : "消息"}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium transition-colors hover:bg-white/20"
      onClick={() => navigate("/mobile/messages")}
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      消息
      {hasCount ? (
        <span
          aria-hidden="true"
          className="rounded-full bg-[#c9854a] px-1.5 text-[10px] text-white"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}
