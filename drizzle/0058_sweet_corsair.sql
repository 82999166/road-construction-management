ALTER TABLE `transport_sites` ADD `minimumTransitMinutes` int DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `transport_sites` ADD `minimumTransitEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `transport_sites` ADD `unloadGeofenceMeters` int DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE `transport_sites` ADD `unloadGeofenceEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- 每个卸土点采用其最新维护的历史路线规则；无历史路线的卸土点保留安全默认值。
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
