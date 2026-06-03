import MasterTablePage from "../components/MasterTablePage";
import { useStore } from "../store";

export default function Suppliers() {
  const { suppliers, reloadSuppliers } = useStore();
  return (
    <MasterTablePage
      title="購入先マスタ"
      entity="suppliers"
      items={suppliers as unknown as Record<string, string>[]}
      reload={reloadSuppliers}
      columns={[
        { key: "name", label: "購入先名" },
        { key: "url", label: "URL", link: true },
        { key: "note", label: "メモ" },
      ]}
    />
  );
}
