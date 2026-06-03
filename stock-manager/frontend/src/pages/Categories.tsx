import MasterTablePage from "../components/MasterTablePage";
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
        { key: "name", label: "カテゴリ名" },
        { key: "note", label: "メモ" },
      ]}
    />
  );
}
