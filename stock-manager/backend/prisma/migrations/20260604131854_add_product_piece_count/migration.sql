-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "volume" TEXT NOT NULL DEFAULT '',
    "piece_count" INTEGER NOT NULL DEFAULT 1,
    "maker" TEXT NOT NULL DEFAULT '',
    "jan_code" TEXT NOT NULL DEFAULT '',
    "amazon_asin" TEXT NOT NULL DEFAULT '',
    "amazon_url" TEXT NOT NULL DEFAULT '',
    "category_id" TEXT NOT NULL DEFAULT '',
    "location_id" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "photo" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Product" ("amazon_asin", "amazon_url", "category_id", "created_at", "id", "jan_code", "location_id", "maker", "name", "note", "photo", "quantity", "sort_order", "volume") SELECT "amazon_asin", "amazon_url", "category_id", "created_at", "id", "jan_code", "location_id", "maker", "name", "note", "photo", "quantity", "sort_order", "volume" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
