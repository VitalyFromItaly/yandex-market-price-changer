CREATE TABLE "accounting_cost_settings" (
	"telegram_user_id" text PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
