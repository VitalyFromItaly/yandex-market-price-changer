CREATE TABLE "finance_tax_settings" (
	"telegram_user_id" text PRIMARY KEY NOT NULL,
	"regime" text NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"recognition" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
