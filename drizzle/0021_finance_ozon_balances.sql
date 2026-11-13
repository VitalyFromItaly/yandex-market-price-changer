CREATE TABLE "finance_ozon_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"opening_kopecks" bigint NOT NULL,
	"accrued_kopecks" bigint,
	"payments_kopecks" bigint NOT NULL,
	"closing_kopecks" bigint,
	"loaded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_ozon_balances_period_uq" ON "finance_ozon_balances" USING btree ("telegram_user_id","period_from","period_to");