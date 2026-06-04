import { Box } from "@mui/material";
import MasterTablePage from "../components/MasterTablePage";
import { DynamicIcon } from "../components/IconPicker";
import { useStore } from "../store";

export default function Categories() {
  const { categories, reloadCategories } = useStore();
  return (
    <MasterTablePage
      title="カテゴリマスタ"
      entity="categories"
      items={categories as unknown as Record<string, string>[]}
      reload={reloadCategories}
      columns={[
        {
          key: "name",
          label: "カテゴリ名",
          render: (item) => (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {item.icon && <DynamicIcon name={item.icon} fontSize="small" />}
              {item.name}
            </Box>
          ),
        },
        { key: "note", label: "メモ" },
      ]}
    />
  );
}
