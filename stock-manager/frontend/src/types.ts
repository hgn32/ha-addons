export interface Category {
  id: string;
  name: string;
  note: string;
  created_at: string;
}

export interface Location {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  url: string;
  note: string;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  maker: string;
  jan_code: string;
  amazon_asin: string;
  amazon_url: string;
  category_id: string;
  supplier_id: string;
  location_id: string;
  note: string;
  photo: string;
  created_at: string;
}

export interface InventoryItem extends Product {
  quantity: number;
}

export type TransactionType = "add" | "use" | "adjust";

export interface Transaction {
  id: string;
  type: TransactionType;
  product_id: string;
  quantity: number;
  unit_price: number;
  supplier_id: string;
  note: string;
  date: string;
}

export interface AmazonLogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface AmazonSettings {
  cookie_set: boolean;
  cookie_preview: string;
  cookie_length: number;
  last_sync: string;
  cron: string;
}

export interface AmazonCrawlSummary {
  fetched: number;
  auto: number;
  queued: number;
  skipped: number;
  last_sync: string;
}

export interface AmazonQueueItem {
  id: string;
  order_id: string;
  asin: string;
  jan_code: string;
  product_name: string;
  maker: string;
  product_url: string;
  image_url: string;
  purchased_at: string;
  quantity: number;
  unit_price: number;
  status: string;
  created_at: string;
}
