CREATE TABLE "finance_discrepancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"period_key" text NOT NULL,
	"kind" text NOT NULL,
	"order_id" text,
	"bank_order_id" text,
	"operation_ids" jsonb NOT NULL,
	"operation_count" integer NOT NULL,
	"expected_kopecks" bigint,
	"actual_kopecks" bigint,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_periods" ADD COLUMN "discrepancy_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_periods" ADD COLUMN "reconcile_state" text;--> statement-breakpoint
ALTER TABLE "finance_periods" ADD COLUMN "reconcile_note" text;--> statement-breakpoint
CREATE INDEX "finance_discrepancies_period_idx" ON "finance_discrepancies" USING btree ("telegram_user_id","period_key");