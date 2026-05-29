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
