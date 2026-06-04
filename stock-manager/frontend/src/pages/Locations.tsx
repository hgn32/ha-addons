import { Box } from "@mui/material";
import MasterTablePage from "../components/MasterTablePage";
import { DynamicIcon } from "../components/IconPicker";
import { useStore } from "../store";

export default function Locations() {
  const { locations, reloadLocations } = useStore();
  return (
    <MasterTablePage
      title="置き場マスタ"
      entity="locations"
      items={locations as unknown as Record<string, string>[]}
      reload={reloadLocations}
      columns={[
        {
          key: "name",
          label: "置き場名",
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
