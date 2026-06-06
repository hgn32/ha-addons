import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import CategoryIcon from "@mui/icons-material/Category";
import DashboardIcon from "@mui/icons-material/Dashboard";
import HistoryIcon from "@mui/icons-material/History";
import MenuIcon from "@mui/icons-material/Menu";
import PlaceIcon from "@mui/icons-material/Place";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import SellIcon from "@mui/icons-material/Sell";
import StorefrontIcon from "@mui/icons-material/Storefront";
import {
  AppBar,
  Box,
  Button,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import AmazonImport from "./pages/AmazonImport";
import Categories from "./pages/Categories";
import Dashboard from "./pages/Dashboard";
import Locations from "./pages/Locations";
import Products from "./pages/Products";
import Stocktake from "./pages/Stocktake";
import Suppliers from "./pages/Suppliers";
import Transactions from "./pages/Transactions";

const DRAWER_WIDTH = 240;

export type Page =
  | "dashboard"
  | "stocktake"
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
  { key: "stocktake", label: "棚卸", icon: <QrCodeScannerIcon />, section: "メイン" },
  { key: "transactions", label: "在庫履歴", icon: <HistoryIcon />, section: "メイン" },
  { key: "products", label: "品目", icon: <SellIcon />, section: "マスタ" },
  { key: "categories", label: "品目カテゴリ", icon: <CategoryIcon />, section: "マスタ" },
  { key: "locations", label: "置き場", icon: <PlaceIcon />, section: "マスタ" },
  { key: "suppliers", label: "購入先", icon: <StorefrontIcon />, section: "マスタ" },
  { key: "amazon", label: "Amazon取込", icon: <CloudDownloadIcon />, section: "インポート" },
];

const getPageFromHash = (): Page => {
  const hash = window.location.hash.replace("#", "") as Page;
  return NAV.some((n) => n.key === hash) ? hash : "dashboard";
};

export default function App() {
  const [page, setPage] = useState<Page>(getPageFromHash);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setPage(getPageFromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const navigate = (p: Page) => {
    window.location.hash = p;
    setMobileOpen(false);
  };

  let lastSection = "";
  const drawerContent = (
    <>
      <Toolbar />
      <Box sx={{ overflow: "auto", flexGrow: 1 }}>
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
                  onClick={() => navigate(item.key)}
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
      <Box sx={{ p: 2, borderTop: "1px solid", borderColor: "divider" }}>
        <Button
          fullWidth
          size="small"
          color="error"
          variant="outlined"
          sx={{ mb: 1 }}
          onClick={async () => {
            const input = window.prompt(
              '全マスタデータ（品目・品目カテゴリ・置き場・購入先・履歴・取込履歴）を削除します。\n\n確認のため「全削除」と入力してください。'
            );
            if (input !== "全削除") return;
            await fetch("./api/admin/all-data", { method: "DELETE" });
            window.location.reload();
          }}
        >
          全データ削除
        </Button>
      </Box>
    </>
  );

  return (
    <Box sx={{ display: "flex" }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            aria-label="メニュー"
            onClick={() => setMobileOpen(true)}
            sx={{ mr: 1, display: { md: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <Box component="img"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            src={`${(window as any).__INGRESS_PATH__ || ""}/icon.png`}
            sx={{ width: 28, height: 28, mr: 1.5 }}
          />
          <Typography variant="h6" noWrap fontWeight={700}>
            Stock Manager
          </Typography>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        {/* スマホ: 一時表示ドロワー（ハンバーガーで開閉） */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box", display: "flex", flexDirection: "column" },
          }}
        >
          {drawerContent}
        </Drawer>
        {/* PC: 常設ドロワー */}
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box", display: "flex", flexDirection: "column" },
          }}
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, sm: 3 }, minHeight: "100vh", width: { md: `calc(100% - ${DRAWER_WIDTH}px)` } }}>
        <Toolbar />
        {page === "dashboard" && <Dashboard onNavigate={navigate} />}
        {page === "stocktake" && <Stocktake />}
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
