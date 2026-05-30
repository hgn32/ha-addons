# VOICEVOX Engine

VOICEVOX音声合成エンジンをHome Assistantアドオンとして動作させます。

## アーキテクチャ対応

| アーキテクチャ | 対応状況 |
|---|---|
| amd64 (Generic x86-64) | ✅ 動作確認済み |
| aarch64 (Raspberry Pi等) | ⚠️ 公式未サポート（動作する可能性はあるが保証なし） |

aarch64での動作は [VOICEVOX公式Issue #644](https://github.com/VOICEVOX/voicevox_engine/issues/644) にて「優先度：低（運用中止）」とされており、公式にはサポートされていません。

## GPU版について

GPU版を使用する場合は `Dockerfile` 内の `FROM` を以下に変更してください：

```
FROM voicevox/voicevox_engine:nvidia-amd64-latest
```

GPU版はamd64のみ対応です。

## インストール

1. Home Assistant の **設定 → アドオン → アドオンストア** を開く
2. 右上のメニューから **リポジトリを追加** を選択し、以下の URL を入力する
   ```
   https://github.com/hgn32/ha-addons
   ```
3. **VOICEVOX Engine** を選択して **インストール**
4. アドオンを起動後、`http://<HA のアドレス>:50021` で API にアクセス可能

## ポート

| ポート | 用途 |
|---|---|
| `50021` | VOICEVOX Engine API |

## パスとデータ

VOICEVOX Engine はステートレスで動作します。ユーザー辞書等のデータは以下に保存されます。

| 種類 | コンテナ内パス | 備考 |
|---|---|---|
| ユーザー辞書 | `/root/.local/share/voicevox-engine/` | アドオン再起動後も保持 |
| API ドキュメント | `http://<HA のアドレス>:50021/docs` | Swagger UI |

## HA との連携（TTS 設定の自動追記）

アドオン起動時に `/config/configuration.yaml` へ以下の TTS 設定を自動追記します（すでに記載がある場合はスキップ）。

```yaml
tts:
  - platform: voicevox_tts
    host: 127.0.0.1
    port: 50021
    speaker: 10
#  3:ずんだもん
# 10:雨晴はう
# 24:WhiteCUL
# 89:Voidoll
# 58:猫使ビィ
# 48:ナースロボ＿タイプＴ
# 46:小夜/SAYO
```

追記後は HA を再起動することで TTS が有効になります。`speaker` の番号を変更したい場合は `configuration.yaml` を直接編集してください。
