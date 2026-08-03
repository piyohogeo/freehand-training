# Freehand Training

ブラウザ上で円をフリーハンド描画し、近似円とスコアを表示する静的Webアプリです。

## 開発

Node.js 22以降を使用します。

```sh
npm install
npm test
```

`npm run build`の出力先は`public/`です。ローカル確認時は任意のHTTPサーバーで
`public/`を配信してください。

## 公開

`main`ブランチへpushすると、`.github/workflows/deploy-pages.yml`がテストとビルドを実行し、
生成物をGitHub Pagesへデプロイします。初回のみ、GitHubリポジトリの
**Settings → Pages → Source**で**GitHub Actions**を選択してください。
