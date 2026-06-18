import React, { useState } from "react";
import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditIcon from "@mui/icons-material/Edit";
import DownloadIcon from "@mui/icons-material/Download";
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
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../api";
import { useStore } from "../store";
import AddFab from "./AddFab";
import SimpleMasterDialog, { MasterEntity } from "./SimpleMasterDialog";

interface Column {
  key: string;
  label: string;
  link?: boolean;
  render?: (item: Record<string, string>) => React.ReactNode;
}

interface Props {
  title: string;
  entity: MasterEntity;
  items: Record<string, string>[];
  columns: Column[];
  reload: () => Promise<void>;
}

interface RowProps {
  item: Record<string, string>;
  columns: Column[];
  onEdit: () => void;
  onRemove: () => void;
}

function SortableRow({ item, columns, onEdit, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isDragging ? "#f0f4ff" : undefined,
  };

  return (
    <TableRow ref={setNodeRef} style={style} hover>
      <TableCell sx={{ p: 1, width: 36, cursor: "grab", color: "text.disabled" }} {...attributes} {...listeners}>
        <DragIndicatorIcon fontSize="small" />
      </TableCell>
      {columns.map((c) => (
        <TableCell key={c.key}>
          {c.render ? c.render(item) : c.link && item[c.key] ? (
            <Link href={item[c.key]} target="_blank" rel="noreferrer">
              {item[c.key]}
            </Link>
          ) : (
            item[c.key]
          )}
        </TableCell>
      ))}
      <TableCell align="right">
        <IconButton color="primary" onClick={onEdit}>
          <EditIcon />
        </IconButton>
        <IconButton color="error" onClick={onRemove}>
          <DeleteIcon />
        </IconButton>
      </TableCell>
    </TableRow>
  );
}

export default function MasterTablePage({ title, entity, items, columns, reload }: Props) {
  const { toast } = useStore();
  const [dialog, setDialog] = useState<{ open: boolean; item: Record<string, string> | null }>({
    open: false,
    item: null,
  });
  const [localItems, setLocalItems] = useState<Record<string, string>[]>([]);

  // Sync localItems when items prop changes (after reload)
  React.useEffect(() => {
    setLocalItems(items);
  }, [items]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localItems.findIndex((i) => i.id === active.id);
    const newIndex = localItems.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(localItems, oldIndex, newIndex);
    setLocalItems(reordered);

    try {
      await api.put(`/api/${entity}/reorder`, { ids: reordered.map((i) => i.id) });
    } catch (e) {
      toast((e as Error).message, "error");
      setLocalItems(items); // rollback
    }
  };

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

  const exportCsv = () => {
    const headers = columns.map((c) => c.label);
    const rows = localItems.map((item) => columns.map((c) => `"${(item[c.key] ?? "").replace(/"/g, '""')}"`));
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${title}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "center", mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{title}</Typography>
        <Button size="small" startIcon={<DownloadIcon />} onClick={exportCsv} sx={{ ml: "auto" }}>CSV出力</Button>
      </Stack>

      <Paper sx={{ p: 2 }}>
        <TableContainer>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 36 }} />
                  {columns.map((c) => (
                    <TableCell key={c.key}>{c.label}</TableCell>
                  ))}
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                <SortableContext items={localItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  {localItems.map((item) => (
                    <SortableRow
                      key={item.id}
                      item={item}
                      columns={columns}
                      onEdit={() => setDialog({ open: true, item })}
                      onRemove={() => remove(item)}
                    />
                  ))}
                </SortableContext>
                {localItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length + 2} align="center" sx={{ py: 4, color: "text.secondary" }}>
                      データがありません
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </TableContainer>
      </Paper>

      <AddFab label="新規追加" onClick={() => setDialog({ open: true, item: null })} />

      <SimpleMasterDialog
        open={dialog.open}
        entity={entity}
        item={dialog.item}
        onClose={() => {
          setDialog({ ...dialog, open: false });
          reload();
        }}
      />
    </Box>
  );
}
