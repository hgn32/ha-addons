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

## HA との連携（自動検知）

アドオン起動時に以下を自動で行います。

1. `custom_components/voicevox_tts` を `/config/custom_components/` にデプロイ
2. mDNS（`_voicevox._tcp.local.`）でエンジンをアドバタイズ

HA が自動でインテグレーションを検出し、**設定 → 通知** に「VOICEVOX Engine が見つかりました」と表示されます。そこから話者を選択してセットアップ完了です。`configuration.yaml` の編集は不要です。

手動でセットアップする場合は **設定 → デバイスとサービス → インテグレーションを追加** から「VOICEVOX TTS」を検索してください。

### 話者番号

| 番号 | 話者 |
|---|---|
| 3 | ずんだもん |
| 10 | 雨晴はう |
| 24 | WhiteCUL |
| 46 | 小夜/SAYO |
| 48 | ナースロボ＿タイプＴ |
| 58 | 猫使ビィ |
| 89 | Voidoll |

全話者一覧は [VOICEVOX 公式サイト](https://voicevox.hiroshiba.jp/) または `http://<HA のアドレス>:50021/speakers` で確認できます。
