CREATE TABLE "finance_expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"category" text NOT NULL,
	"kind" text NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"from_day" text NOT NULL,
	"to_day" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_expense_categories_user_name_uq" ON "finance_expense_categories" USING btree ("telegram_user_id","name");--> statement-breakpoint
CREATE INDEX "finance_expenses_user_from_idx" ON "finance_expenses" USING btree ("telegram_user_id","from_day");