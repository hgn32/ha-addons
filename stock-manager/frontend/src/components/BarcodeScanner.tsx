import { Box, IconButton } from "@mui/material";
import FlipCameraIosIcon from "@mui/icons-material/FlipCameraIos";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";

interface Props {
  onDetected: (code: string) => void;
  onError?: (msg: string) => void;
}

// 端末のカメラでバーコード(JAN/EAN/UPC等)を連続スキャンするコンポーネント。
// マウント中だけカメラを起動し、アンマウントで確実に停止する。
// 複数カメラがある端末ではカメラ切り替えボタンを表示する。
export default function BarcodeScanner({ onDetected, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const onErrorRef = useRef(onError);
  onDetectedRef.current = onDetected;
  onErrorRef.current = onError;

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);

  // 利用可能なカメラを列挙（背面カメラを優先して初期選択）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await BrowserMultiFormatReader.listVideoInputDevices();
        if (cancelled) return;
        setDevices(list);
        if (list.length > 0) {
          const back = list.find((d) => /back|rear|environment|背面/i.test(d.label));
          setDeviceId((prev) => prev ?? (back ?? list[0]).deviceId);
        }
      } catch {
        // 列挙失敗時はデフォルトカメラにフォールバック（deviceId=undefined）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 選択中のカメラでスキャンを開始。deviceId変更時は再起動。
  useEffect(() => {
    let cancelled = false;
    let controls: { stop: () => void } | null = null;
    const reader = new BrowserMultiFormatReader();

    (async () => {
      try {
        const c = await reader.decodeFromVideoDevice(deviceId, videoRef.current ?? undefined, (result) => {
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
  }, [deviceId]);

  // 次のカメラに順番に切り替える
  const switchCamera = () => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === deviceId);
    const next = devices[(idx + 1) % devices.length];
    setDeviceId(next.deviceId);
  };

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
      {devices.length > 1 && (
        <IconButton
          aria-label="カメラを切り替え"
          onClick={switchCamera}
          sx={{
            position: "absolute",
            bottom: 8,
            right: 8,
            bgcolor: "rgba(0,0,0,0.5)",
            color: "#fff",
            "&:hover": { bgcolor: "rgba(0,0,0,0.7)" },
          }}
        >
          <FlipCameraIosIcon />
        </IconButton>
      )}
    </Box>
  );
}
