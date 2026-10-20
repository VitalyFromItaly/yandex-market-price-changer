CREATE TABLE "finance_act_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" text NOT NULL,
	"telegram_user_id" text NOT NULL,
	"act_day" text NOT NULL,
	"total_kopecks" bigint NOT NULL,
	"sheets" jsonb NOT NULL,
	"loaded_at" timestamp with time zone NOT NULL,
	"journal_matched" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_act_services_act_uq" ON "finance_act_services" USING btree ("marketplace","telegram_user_id","act_day");--> statement-breakpoint
CREATE INDEX "finance_operations_user_act_idx" ON "finance_operations" USING btree ("telegram_user_id","act_date") WHERE "finance_operations"."superseded_at" IS NULL;