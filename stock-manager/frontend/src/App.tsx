import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import CategoryIcon from "@mui/icons-material/Category";
import DashboardIcon from "@mui/icons-material/Dashboard";
import HistoryIcon from "@mui/icons-material/History";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import PlaceIcon from "@mui/icons-material/Place";
import SellIcon from "@mui/icons-material/Sell";
import StorefrontIcon from "@mui/icons-material/Storefront";
import WidgetsIcon from "@mui/icons-material/Widgets";
import {
  AppBar,
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
  Typography,
} from "@mui/material";
import { useState } from "react";
import AmazonImport from "./pages/AmazonImport";
import Categories from "./pages/Categories";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Locations from "./pages/Locations";
import Products from "./pages/Products";
import Suppliers from "./pages/Suppliers";
import Transactions from "./pages/Transactions";

const DRAWER_WIDTH = 240;

export type Page =
  | "dashboard"
  | "inventory"
  | "transactions"
  | "products"
  | "categories"
  | "locations"
  | "suppliers"
  | "amazon";

interface NavItem {
  key: Page;
  label: string;
  icon: React.ReactNode;
  section: string;
}

const NAV: NavItem[] = [
  { key: "dashboard", label: "ダッシュボード", icon: <DashboardIcon />, section: "メイン" },
  { key: "inventory", label: "在庫一覧", icon: <Inventory2Icon />, section: "メイン" },
  { key: "transactions", label: "操作履歴", icon: <HistoryIcon />, section: "メイン" },
  { key: "products", label: "商品", icon: <SellIcon />, section: "マスタ" },
  { key: "categories", label: "カテゴリ", icon: <CategoryIcon />, section: "マスタ" },
  { key: "locations", label: "置き場", icon: <PlaceIcon />, section: "マスタ" },
  { key: "suppliers", label: "購入先", icon: <StorefrontIcon />, section: "マスタ" },
  { key: "amazon", label: "Amazon取込", icon: <CloudDownloadIcon />, section: "インポート" },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");

  let lastSection = "";

  return (
    <Box sx={{ display: "flex" }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <WidgetsIcon sx={{ mr: 1.5 }} />
          <Typography variant="h6" noWrap fontWeight={700}>
            Stock Manager
          </Typography>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
        }}
      >
        <Toolbar />
        <Box sx={{ overflow: "auto" }}>
          <List>
            {NAV.map((item) => {
              const header =
                item.section !== lastSection ? (
                  <ListSubheader key={`h-${item.section}`} sx={{ bgcolor: "transparent" }}>
                    {item.section}
                  </ListSubheader>
                ) : null;
              lastSection = item.section;
              return (
                <Box key={item.key}>
                  {header}
                  <ListItemButton
                    selected={page === item.key}
                    onClick={() => setPage(item.key)}
                    sx={{ mx: 1, borderRadius: 2 }}
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                    <ListItemText primary={item.label} />
                  </ListItemButton>
                </Box>
              );
            })}
          </List>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: 3, minHeight: "100vh" }}>
        <Toolbar />
        {page === "dashboard" && <Dashboard onNavigate={setPage} />}
        {page === "inventory" && <Inventory onNavigate={setPage} />}
        {page === "transactions" && <Transactions />}
        {page === "products" && <Products />}
        {page === "categories" && <Categories />}
        {page === "locations" && <Locations />}
        {page === "suppliers" && <Suppliers />}
        {page === "amazon" && <AmazonImport />}
      </Box>
    </Box>
  );
}
