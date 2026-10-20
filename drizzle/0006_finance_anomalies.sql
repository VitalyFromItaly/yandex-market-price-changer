CREATE TABLE "finance_anomalies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"period_key" text NOT NULL,
	"kind" text NOT NULL,
	"anomaly_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"operation_ids" jsonb NOT NULL,
	"operation_count" integer NOT NULL,
	"amount_kopecks" bigint,
	"sku" text,
	"order_id" text,
	"threshold" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_anomaly_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"anomaly_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_periods" ADD COLUMN "anomalies_checked_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_anomalies_key_uq" ON "finance_anomalies" USING btree ("marketplace","telegram_user_id","anomaly_key");--> statement-breakpoint
CREATE INDEX "finance_anomalies_period_idx" ON "finance_anomalies" USING btree ("telegram_user_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_anomaly_reviews_key_uq" ON "finance_anomaly_reviews" USING btree ("marketplace","telegram_user_id","anomaly_key");