-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "epic_id" TEXT,
ADD COLUMN     "is_epic" BOOLEAN NOT NULL DEFAULT false;
