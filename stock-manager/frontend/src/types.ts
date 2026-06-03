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
  jan_code: string;
  amazon_asin: string;
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

export interface ImportResult {
  status: "added" | "created";
  product_id: string;
  name: string;
  qty: number;
}
