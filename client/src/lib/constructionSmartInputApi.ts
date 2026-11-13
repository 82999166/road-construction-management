import { useCallback, useMemo } from "react";
import { hashKey } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import type {
  ConstructionAssistMode,
  ConstructionSmartField,
} from "./constructionSmartInput";

export function constructionAudioMime(
  mime: string
): "audio/webm" | "audio/ogg" | "audio/mp4" {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base === "audio/webm" || base === "audio/ogg" || base === "audio/mp4")
    return base;
  throw new Error("当前录音格式不支持，请使用手机输入法麦克风");
}

/** 仍使用应用已有 tRPC provider；显式 refetch 避免沿用另一登录用户的缓存数据。 */
export function useConstructionSmartInputApi(
  projectId: number,
  userId: number,
  field: ConstructionSmartField,
  keyword: string
) {
  const statusInput = useMemo(() => ({ projectId }), [projectId]);
  const historyInput = useMemo(
    () => ({ projectId, field, keyword: keyword.trim() || undefined }),
    [projectId, field, keyword]
  );
  const queryKeyHashFn = useCallback(
    (key: readonly unknown[]) => `${userId}:${hashKey(key)}`,
    [userId]
  );
  const queryOptions = {
    enabled: false,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryKeyHashFn,
    trpc: { abortOnUnmount: true },
  } as const;
  const status = trpc.constructionAssistant.status.useQuery(
    statusInput,
    queryOptions
  );
  const history = trpc.constructionAssistant.history.useQuery(
    historyInput,
    queryOptions
  );
  const forgetMutation = trpc.constructionAssistant.forget.useMutation();
  const assistMutation = trpc.constructionAssistant.assist.useMutation();
  const transcribeMutation =
    trpc.constructionAssistant.transcribe.useMutation();

  const readStatus = useCallback(async () => {
    const result = await status.refetch({ throwOnError: true });
    if (!result.data) throw new Error("状态读取失败，请重试");
    return result.data;
  }, [status.refetch]);
  const readHistory = useCallback(async () => {
    const result = await history.refetch({ throwOnError: true });
    if (!result.data) throw new Error("最近内容读取失败，请重试");
    return result.data;
  }, [history.refetch]);
  const forget = useCallback(
    (id?: number) => forgetMutation.mutateAsync({ projectId, id }),
    [projectId, forgetMutation.mutateAsync]
  );
  const assist = useCallback(
    (content: string, mode: ConstructionAssistMode, instruction?: string) =>
      assistMutation.mutateAsync({
        projectId,
        field,
        content,
        mode,
        instruction,
      }),
    [projectId, field, assistMutation.mutateAsync]
  );
  const transcribe = useCallback(
    (input: { audioBase64: string; mimeType: string }) =>
      transcribeMutation.mutateAsync({
        projectId,
        audioBase64: input.audioBase64,
        mimeType: constructionAudioMime(input.mimeType),
      }),
    [projectId, transcribeMutation.mutateAsync]
  );
  return useMemo(
    () => ({ readStatus, readHistory, forget, assist, transcribe }),
    [readStatus, readHistory, forget, assist, transcribe]
  );
}
