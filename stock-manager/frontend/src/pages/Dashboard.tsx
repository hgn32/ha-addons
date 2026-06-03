import {
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  Typography,
} from "@mui/material";
import { imageUrl } from "../api";
import { useStore } from "../store";
import type { Page } from "../App";

function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <Card>
      <CardContent sx={{ textAlign: "center" }}>
        <Typography variant="h3" fontWeight={700} color={color}>
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function Dashboard({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { products, inventory, transactions, categoryName } = useStore();

  const totalStock = inventory.reduce((sum, i) => sum + (i.quantity || 0), 0);
  const lowStock = inventory.filter((i) => (i.quantity || 0) <= 1);

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} mb={3}>
        ダッシュボード
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" },
          gap: 2,
          mb: 3,
        }}
      >
        <StatCard value={products.length} label="商品数" color="primary.main" />
        <StatCard value={totalStock} label="総在庫数" color="success.main" />
        <StatCard value={lowStock.length} label="在庫少 (≤1)" color="warning.main" />
        <StatCard value={transactions.length} label="操作履歴数" color="text.secondary" />
      </Box>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" mb={1}>
          在庫が少ない商品
        </Typography>
        {lowStock.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            在庫が少ない商品はありません
          </Typography>
        ) : (
          <List>
            {lowStock.slice(0, 10).map((item) => (
              <ListItem
                key={item.id}
                secondaryAction={<Chip label={`${item.quantity}個`} color="warning" size="small" />}
                sx={{ cursor: "pointer" }}
                onClick={() => onNavigate("inventory")}
              >
                <ListItemAvatar>
                  <Avatar src={item.photo ? imageUrl(item.photo) : undefined} variant="rounded">
                    📦
                  </Avatar>
                </ListItemAvatar>
                <ListItemText primary={item.name} secondary={categoryName(item.category_id)} />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Box>
  );
}
