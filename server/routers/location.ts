import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { makeRequest, type GeocodingResult } from "../_core/map";
import { protectedProcedure, router } from "../_core/trpc";

/** 原始经纬度只在本请求中用于反查中文地址，响应不包含坐标，避免业务页面二次展示。 */
export const locationRouter = router({
  reverseGeocode: protectedProcedure
    .input(z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }))
    .mutation(async ({ input }) => {
      try {
        const result = await makeRequest<GeocodingResult>("/maps/api/geocode/json", { latlng: `${input.latitude},${input.longitude}`, language: "zh-CN", region: "cn" });
        const first = result.results?.[0];
        if (result.status !== "OK" || !first?.formatted_address) throw new Error(result.status || "ZERO_RESULTS");
        return { address: first.formatted_address };
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "暂未能解析为中文详细地址，请检查网络或稍后重试" });
      }
    }),
});
