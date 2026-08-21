ALTER TABLE `transport_sites`
  ADD COLUMN `minimumTransitMinutes` int NOT NULL DEFAULT 10,
  ADD COLUMN `minimumTransitEnabled` boolean NOT NULL DEFAULT true,
  ADD COLUMN `unloadGeofenceMeters` int NOT NULL DEFAULT 300,
  ADD COLUMN `unloadGeofenceEnabled` boolean NOT NULL DEFAULT true;

-- 同一卸土点可能被多条路线复用。迁移时采用该卸土点最新维护的路线规则，
-- 使历史项目平滑收敛为“卸土点统一规则”；未配置路线的地点保持安全默认值。
UPDATE `transport_sites` AS site
INNER JOIN (
  SELECT route.`unloadSiteId`, route.`minimumTransitMinutes`, route.`minimumTransitEnabled`, route.`unloadGeofenceMeters`, route.`unloadGeofenceEnabled`
  FROM `transport_route_presets` AS route
  INNER JOIN (
    SELECT `unloadSiteId`, MAX(`id`) AS `latestRouteId`
    FROM `transport_route_presets`
    GROUP BY `unloadSiteId`
  ) AS latest ON latest.`latestRouteId` = route.`id`
) AS route_rule ON route_rule.`unloadSiteId` = site.`id`
SET
  site.`minimumTransitMinutes` = route_rule.`minimumTransitMinutes`,
  site.`minimumTransitEnabled` = route_rule.`minimumTransitEnabled`,
  site.`unloadGeofenceMeters` = route_rule.`unloadGeofenceMeters`,
  site.`unloadGeofenceEnabled` = route_rule.`unloadGeofenceEnabled`
WHERE site.`siteType` = 'unload';
