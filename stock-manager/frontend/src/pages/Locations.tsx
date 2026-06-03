import MasterTablePage from "../components/MasterTablePage";
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
        { key: "name", label: "置き場名" },
        { key: "description", label: "説明" },
      ]}
    />
  );
}
