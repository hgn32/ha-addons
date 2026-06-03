import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import {
  Box,
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
import AddFab from "./AddFab";
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
      <Typography variant="h5" fontWeight={700} mb={3}>
        {title}
      </Typography>

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
                    <IconButton color="primary" onClick={() => setDialog({ open: true, item })}>
                      <EditIcon />
                    </IconButton>
                    <IconButton color="error" onClick={() => remove(item)}>
                      <DeleteIcon />
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

      <AddFab label="新規追加" onClick={() => setDialog({ open: true, item: null })} />

      <SimpleMasterDialog
        open={dialog.open}
        entity={entity}
        item={dialog.item}
        onClose={() => setDialog({ ...dialog, open: false })}
      />
    </Box>
  );
}
