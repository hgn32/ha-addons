# YouTube Music Cookie

[Music Assistant](https://www.music-assistant.io/music-providers/youtube-music/) の
YouTube Music 連携に必要なログイン Cookie を取得するアドオンです。

開発者ツールの Network タブから Cookie を手でコピーする代わりに、
HA のサイドバー（Ingress）に出るブラウザ画面でログインするだけで Cookie を取り出します。

## 使い方

1. アドオンを起動し、サイドバーの **YTM Cookie** を開く
2. **開始** を押すと、画面内にブラウザ（YouTube Music）が表示される
3. ブラウザ画面で Google アカウントにログインし、ライブラリなどが表示されることを確かめる
4. **ログイン完了** を押す
5. 表示された Cookie を **コピー** し、Music Assistant の YouTube Music 設定の
   「Login Cookie」に貼り付ける。Username には Gmail アドレス
   （ブランドアカウントなら 21 桁の ID）を入れる
6. 取得後はアドオンを停止してかまいません（`boot: manual`）

## 仕組み

- ログイン用のブラウザは毎回使い捨てのプロファイルで起動し、Cookie を取り出したら削除します
- ログイン中のブラウザはデバッグポートを開けずに起動します
  （デバッグポート付きのブラウザは Google がログインを拒否することがあるため）
- 「ログイン完了」で、ブラウザのウィンドウを閉じて Cookie をディスクへ書き出させた後、
  同じプロファイルを画面なし・ページなし（about:blank）で開き直して Cookie を読みます。
  YouTube のページを開き直さないので、取り出した Cookie がその場でローテーションされることはありません
- Cookie の値は HA のログタブには出しません（件数と必須 Cookie の有無だけ出します）

## 注意

- 取り出した Cookie はパスワードと同じ扱いです。他人に見せないでください
- ブラウザ画面の上部に `--no-sandbox` の警告が出ますが、コンテナ内の制約によるもので、取得には影響しません
