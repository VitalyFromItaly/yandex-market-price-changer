CREATE TABLE "accounting_tax_settings" (
	"telegram_user_id" text PRIMARY KEY NOT NULL,
	"base_rule" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
