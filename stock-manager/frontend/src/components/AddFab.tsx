import AddIcon from "@mui/icons-material/Add";
import Fab from "@mui/material/Fab";

interface Props {
  label: string;
  onClick: () => void;
}

// Material 標準のフローティングアクションボタン（右下固定）。
export default function AddFab({ label, onClick }: Props) {
  return (
    <Fab
      color="primary"
      variant="extended"
      onClick={onClick}
      sx={{
        position: "fixed",
        right: 32,
        bottom: 32,
        zIndex: (theme) => theme.zIndex.drawer + 1,
      }}
    >
      <AddIcon sx={{ mr: 1 }} />
      {label}
    </Fab>
  );
}
