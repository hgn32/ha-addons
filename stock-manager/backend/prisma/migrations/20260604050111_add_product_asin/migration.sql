-- CreateTable
CREATE TABLE "ProductAsin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "product_id" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductAsin_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductAsin_asin_key" ON "ProductAsin"("asin");

-- CreateIndex
CREATE INDEX "ProductAsin_product_id_idx" ON "ProductAsin"("product_id");
