-- Retención de ISLR sobre honorarios pagados a profesionales (contador, administrador,
-- abogado, etc.) — pedido cliente 12-jul-2026 vía Reinaldo: "hacer el reporte de las retenciones".
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "supplierRif" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "retentionPct" DECIMAL(5,2);
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "retentionAmountUsd" DECIMAL(18,2);
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "retentionAmountBss" DECIMAL(18,2);
