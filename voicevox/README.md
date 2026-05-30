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

## API ドキュメント

`http://<HA のアドレス>:50021/docs` で Swagger UI が確認できます。

## HA との連携（自動検知）

別途 **[hgn32/ha-voicevox-tts](https://github.com/hgn32/ha-voicevox-tts)** インテグレーションを HACS でインストールしてください。

インストール後にアドオンを起動すると mDNS でエンジンが自動検知され、**設定 → 通知** に「VOICEVOX Engine が見つかりました」と表示されます。スタイルを選択してセットアップ完了です。`configuration.yaml` の編集は不要です。

手動でセットアップする場合は **設定 → デバイスとサービス → インテグレーションを追加** から「VOICEVOX TTS」を検索してください。

スタイル ID の一覧は [ha-voicevox-tts README](https://github.com/hgn32/ha-voicevox-tts#%E3%82%B9%E3%82%BF%E3%82%A4%E3%83%AB%E4%B8%80%E8%A6%A7) を参照してください。
