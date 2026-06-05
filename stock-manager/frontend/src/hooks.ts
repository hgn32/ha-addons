import { useMediaQuery, useTheme } from "@mui/material";

// スマホ幅（sm未満）かどうか。ダイアログの全画面化などに使う。
export function useIsMobile(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("sm"));
}
