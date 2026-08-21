ALTER TABLE `transport_sites` ADD `minimumTransitMinutes` int DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `transport_sites` ADD `minimumTransitEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `transport_sites` ADD `unloadGeofenceMeters` int DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE `transport_sites` ADD `unloadGeofenceEnabled` boolean DEFAULT true NOT NULL;