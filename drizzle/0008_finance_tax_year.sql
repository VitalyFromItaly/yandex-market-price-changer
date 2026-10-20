CREATE TABLE "finance_tax_reconciliations" (
	"telegram_user_id" text NOT NULL,
	"year" integer NOT NULL,
	"period" text NOT NULL,
	"accountant_income_kopecks" bigint,
	"accountant_tax_kopecks" bigint,
	"checked" boolean DEFAULT false NOT NULL,
	"note" text,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_tax_reductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" text NOT NULL,
	"paid_day" text NOT NULL,
	"kind" text NOT NULL,
	"amount_kopecks" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_tax_years" (
	"year" integer PRIMARY KEY NOT NULL,
	"usn_income_limit_kopecks" bigint,
	"vat_threshold_kopecks" bigint,
	"insurance_fixed_kopecks" bigint,
	"insurance_extra_cap_kopecks" bigint,
	"reduction_limit_with_staff_bp" integer,
	"max_rate_usn_income_bp" integer,
	"max_rate_usn_income_minus_expenses_bp" integer,
	"source_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_tax_settings" ADD COLUMN "has_staff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_tax_reconciliations_key" ON "finance_tax_reconciliations" USING btree ("telegram_user_id","year","period");--> statement-breakpoint
CREATE INDEX "finance_tax_reductions_user_paid_idx" ON "finance_tax_reductions" USING btree ("telegram_user_id","paid_day");--> statement-breakpoint
-- Стартовые параметры налоговых лет (TASK-146, решение tax_year_params_global_admin).
-- Цифры внесены по памяти разработчика и помечены «сверить»; дальше их правит админ
-- через /api/finance/tax-years. ON CONFLICT DO NOTHING — повтор миграции не затрёт правку.
INSERT INTO "finance_tax_years" ("year", "usn_income_limit_kopecks", "vat_threshold_kopecks", "insurance_fixed_kopecks", "insurance_extra_cap_kopecks", "reduction_limit_with_staff_bp", "max_rate_usn_income_bp", "max_rate_usn_income_minus_expenses_bp", "source_note") VALUES
	(2025, 45000000000, 6000000000, 5365800, 30088800, 5000, 600, 1500, 'Стартовые значения TASK-146: лимит УСН 450 млн, порог НДС 60 млн, взносы 53 658 ₽, предел 1 % 300 888 ₽ — сверить с НК'),
	(2026, 49050000000, 2000000000, 5739000, 32181800, 5000, 600, 1500, 'Стартовые значения TASK-146: лимит УСН 490,5 млн, порог НДС 20 млн, взносы 57 390 ₽, предел 1 % 321 818 ₽ — сверить с НК'),
	(2027, NULL, 1500000000, 6115400, 34434500, 5000, 600, 1500, 'Стартовые значения TASK-146: лимит УСН не задан (коэффициент-дефлятор не известен), порог НДС 15 млн, взносы 61 154 ₽, предел 1 % 344 345 ₽ — сверить с НК')
ON CONFLICT ("year") DO NOTHING;
