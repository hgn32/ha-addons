import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import {
  Category,
  InventoryItem,
  Location,
  Product,
  Supplier,
  Transaction,
} from "./types";

type Severity = "success" | "error";

interface Store {
  categories: Category[];
  locations: Location[];
  suppliers: Supplier[];
  products: Product[];
  inventory: InventoryItem[];
  transactions: Transaction[];
  reloadCategories: () => Promise<void>;
  reloadLocations: () => Promise<void>;
  reloadSuppliers: () => Promise<void>;
  reloadProducts: () => Promise<void>;
  reloadInventory: () => Promise<void>;
  reloadTransactions: (productId?: string) => Promise<void>;
  toast: (msg: string, severity?: Severity) => void;
  categoryName: (id: string) => string;
  locationName: (id: string) => string;
  productName: (id: string) => string;
  stockOf: (id: string) => number;
}

const StoreContext = createContext<Store>(null!);
export const useStore = (): Store => useContext(StoreContext);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [snack, setSnack] = useState<{ open: boolean; msg: string; severity: Severity }>({
    open: false,
    msg: "",
    severity: "success",
  });

  const reloadCategories = useCallback(async () => {
    setCategories(await api.get<Category[]>("/api/categories"));
  }, []);
  const reloadLocations = useCallback(async () => {
    setLocations(await api.get<Location[]>("/api/locations"));
  }, []);
  const reloadSuppliers = useCallback(async () => {
    setSuppliers(await api.get<Supplier[]>("/api/suppliers"));
  }, []);
  const reloadProducts = useCallback(async () => {
    setProducts(await api.get<Product[]>("/api/products"));
  }, []);
  const reloadInventory = useCallback(async () => {
    setInventory(await api.get<InventoryItem[]>("/api/inventory"));
  }, []);
  const reloadTransactions = useCallback(async (productId?: string) => {
    const q = productId ? `?product_id=${productId}` : "";
    setTransactions(await api.get<Transaction[]>(`/api/transactions${q}`));
  }, []);

  const toast = useCallback((msg: string, severity: Severity = "success") => {
    setSnack({ open: true, msg, severity });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([
          reloadCategories(),
          reloadLocations(),
          reloadSuppliers(),
          reloadProducts(),
          reloadInventory(),
          reloadTransactions(),
        ]);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    })();
  }, [
    reloadCategories,
    reloadLocations,
    reloadSuppliers,
    reloadProducts,
    reloadInventory,
    reloadTransactions,
    toast,
  ]);

  const value: Store = {
    categories,
    locations,
    suppliers,
    products,
    inventory,
    transactions,
    reloadCategories,
    reloadLocations,
    reloadSuppliers,
    reloadProducts,
    reloadInventory,
    reloadTransactions,
    toast,
    categoryName: (id) => categories.find((c) => c.id === id)?.name ?? "",
    locationName: (id) => locations.find((l) => l.id === id)?.name ?? "",
    productName: (id) => products.find((p) => p.id === id)?.name ?? id,
    stockOf: (id) => inventory.find((i) => i.id === id)?.quantity ?? 0,
  };

  return (
    <StoreContext.Provider value={value}>
      {children}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Alert
          severity={snack.severity}
          variant="filled"
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </StoreContext.Provider>
  );
}
