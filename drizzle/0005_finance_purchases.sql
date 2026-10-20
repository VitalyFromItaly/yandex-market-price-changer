CREATE TABLE "finance_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"supplier" text NOT NULL,
	"paid_day" text NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"lines" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_tax_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"paid_day" text NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "finance_purchases_user_paid_idx" ON "finance_purchases" USING btree ("telegram_user_id","paid_day");--> statement-breakpoint
CREATE INDEX "finance_tax_payments_user_paid_idx" ON "finance_tax_payments" USING btree ("telegram_user_id","paid_day");--> statement-breakpoint
CREATE INDEX "finance_operations_user_paid_idx" ON "finance_operations" USING btree ("telegram_user_id","paid_at") WHERE "finance_operations"."superseded_at" IS NULL;