-- AlterTable
ALTER TABLE "Community" ADD COLUMN     "monthlyFeeSetAt" TIMESTAMP(3),
ADD COLUMN     "monthlyFeeUsd" DECIMAL(18,2);
