# Freehand Training

ブラウザ上で円をフリーハンド描画し、近似円とスコアを表示する静的Webアプリです。

## 開発

Node.js 22以降を使用します。

```sh
npm install
npm test
```

性能テストだけを実行する場合は`npm run test:performance`を使用します。液タブの高頻度入力を
想定した50,000点の円について、近似計算と描線長計算の平均処理時間が100ms以内であることを
測定します。入力中の線は蓄積点を再描画せず、新しく届いた区間だけをイベント内で即時描画します。
対応ブラウザでは`pointerrawupdate`、低遅延Canvas、予測ポインター座標を使用し、通常の
`pointermove`と同期Canvasへ自動的にフォールバックします。

`npm run build`の出力先は`public/`です。ローカル確認時は任意のHTTPサーバーで
`public/`を配信してください。

## 公開

`main`ブランチへpushすると、`.github/workflows/deploy-pages.yml`がテストとビルドを実行し、
生成物をGitHub Pagesへデプロイします。初回のみ、GitHubリポジトリの
**Settings → Pages → Source**で**GitHub Actions**を選択してください。
