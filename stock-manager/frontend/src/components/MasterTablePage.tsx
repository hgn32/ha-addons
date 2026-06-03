import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import {
  Box,
  Button,
  IconButton,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import SimpleMasterDialog, { MasterEntity } from "./SimpleMasterDialog";

interface Column {
  key: string;
  label: string;
  link?: boolean;
}

interface Props {
  title: string;
  entity: MasterEntity;
  items: Record<string, string>[];
  columns: Column[];
  reload: () => Promise<void>;
}

export default function MasterTablePage({ title, entity, items, columns, reload }: Props) {
  const { toast } = useStore();
  const [dialog, setDialog] = useState<{ open: boolean; item: Record<string, string> | null }>({
    open: false,
    item: null,
  });

  const remove = async (item: Record<string, string>) => {
    if (!confirm(`「${item.name}」を削除しますか？`)) return;
    try {
      await api.del(`/api/${entity}/${item.id}`);
      toast("削除しました");
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
        <Typography variant="h5" fontWeight={700}>
          {title}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, item: null })}>
          新規追加
        </Button>
      </Stack>

      <Paper sx={{ p: 2 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {columns.map((c) => (
                  <TableCell key={c.key}>{c.label}</TableCell>
                ))}
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} hover>
                  {columns.map((c) => (
                    <TableCell key={c.key}>
                      {c.link && item[c.key] ? (
                        <Link href={item[c.key]} target="_blank" rel="noreferrer">
                          {item[c.key]}
                        </Link>
                      ) : (
                        item[c.key]
                      )}
                    </TableCell>
                  ))}
                  <TableCell align="right">
                    <IconButton size="small" color="primary" onClick={() => setDialog({ open: true, item })}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => remove(item)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} align="center" sx={{ py: 4, color: "text.secondary" }}>
                    データがありません
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <SimpleMasterDialog
        open={dialog.open}
        entity={entity}
        item={dialog.item}
        onClose={() => setDialog({ ...dialog, open: false })}
      />
    </Box>
  );
}
