import { Box } from "@mui/material";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useEffect, useRef } from "react";

interface Props {
  onDetected: (code: string) => void;
  onError?: (msg: string) => void;
}

// 端末のカメラでバーコード(JAN/EAN/UPC等)を連続スキャンするコンポーネント。
// マウント中だけカメラを起動し、アンマウントで確実に停止する。
export default function BarcodeScanner({ onDetected, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const onErrorRef = useRef(onError);
  onDetectedRef.current = onDetected;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    let controls: { stop: () => void } | null = null;
    const reader = new BrowserMultiFormatReader();

    (async () => {
      try {
        const c = await reader.decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
          if (result) onDetectedRef.current(result.getText());
        });
        if (cancelled) c.stop();
        else controls = c;
      } catch (e) {
        onErrorRef.current?.((e as Error).message || "カメラを起動できませんでした");
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);

  return (
    <Box sx={{ position: "relative", width: "100%", maxWidth: 480, mx: "auto" }}>
      <video
        ref={videoRef}
        style={{ width: "100%", borderRadius: 8, background: "#000", display: "block" }}
        muted
        playsInline
      />
      <Box
        sx={{
          position: "absolute",
          inset: "30% 12%",
          border: "2px solid #4caf50",
          borderRadius: 1,
          pointerEvents: "none",
        }}
      />
    </Box>
  );
}
