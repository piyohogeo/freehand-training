# Freehand Training

ブラウザ上で円をフリーハンド描画し、近似円とスコアを表示する静的Webアプリです。

## 開発

Node.js 22以降を使用します。

```sh
npm install
npm test
npx playwright install
npm run test:e2e
```

性能テストだけを実行する場合は`npm run test:performance`を使用します。液タブの高頻度入力を
想定した50,000点の円について、近似計算と描線長計算の平均処理時間が100ms以内であることを
測定します。入力中の線は蓄積点を再描画せず、新しく届いた区間だけをイベント内で即時描画します。
入力イベントごとの全画面消去や未制限のrawイベント処理を禁止する回帰テストも実行します。
ビルド時にJavaScriptとCSSの内容ハッシュをURLへ付与し、デプロイ前後のキャッシュ混在を防ぎます。
実ブラウザテストではChromium、Firefox、WebKitを起動し、描線と近似円の実ピクセル、ページ例外、
2,000件の入力イベント処理時間を検証します。
WindowsローカルではPlaywright Firefoxのページ生成問題を避けてChromium・WebKitを実行し、
Linux上のGitHub ActionsではFirefoxを含む三ブラウザを実行します。
対応するEdge・Chromeのペン入力では、Delegated Ink Trails APIへ黒1pxの先行描画を
委譲します。APIがない、または
初期化・描画に失敗した場合は標準Canvasだけで動作します。

入力経路と遅延の診断値はURL末尾に`?debug=1`を付けると画面左上に表示されます。
`event age`はイベント発生から処理開始まで、`next frame`は処理から次の描画機会までの時間です。

`?debug=1&raw=1`では、対応ブラウザの`pointerrawupdate`を画面更新ごとに一括描画する
実験を有効にできます。rawイベント内ではCanvasを描画せず、前回のような処理飽和を防ぎます。

### 表示遅延の検証ページ

`npm run build`後にローカルサーバーを起動し、次のURLを個別に開いて比較します。

- `/latency.html?mode=canvas` — 通常の透明2D Canvas
- `/latency.html?mode=opaque` — 通常の不透明2D Canvas
- `/latency.html?mode=desync` — 不透明な低遅延Canvas
- `/latency.html?mode=webgl` — `desynchronized`と`preserveDrawingBuffer`を要求するWebGL
- `/latency.html?mode=webgl-frame` — WebGL入力を画面更新ごとに1回へ集約
- `/latency.html?mode=webgl-frame-no-preserve` — 保持バッファを使わず、画面更新ごとに全点を再描画
- `/latency.html?mode=svg` — SVG polyline
- `/latency.html?mode=dom` — CSS要素による線分

各ページはpointerdownで消去され、押している間だけ黒1pxの線を描きます。スマートフォンで
撮影する場合は、なるべく一定速度で横方向へ直線を描くとカーソルとの時間差を比較しやすくなります。
描画面には診断DOMを重ねず、方式名と低遅延Canvasの有効・フォールバック状態はブラウザの
ページタイトルで確認できます。

### 低遅延の試験ページ

安定版の`/`は変更せず、`/experiment.html`で低遅延方式を段階的に比較します。

- `/experiment.html?mode=baseline` — 安定版と同じOSカーソル
- `/experiment.html?mode=cursor` — OSカーソルを隠し、ページ内Canvasでカーソルを入力イベント内に即時描画
- `/experiment.html?mode=cursor&hardwareCursor=1` — 両方を表示して相対遅延を測定
- `/experiment.html?mode=cursor&hardwareCursor=1&delegatedInk=0` — Delegated Inkを無効にして比較
- `/experiment.html?mode=cursor&hardwareCursor=1&delegatedInk=0&prediction=browser` — ブラウザ標準の予測点を青い一時描線として表示
- `/experiment.html?mode=cursor&hardwareCursor=1&delegatedInk=0&prediction=modeler` — Ink Stroke Modeler系の予測をオレンジ色で表示
- `/experiment.html?mode=cursor&hardwareCursor=1&delegatedInk=0&prediction=modeler-kalman` — Ink Stroke Modeler系のKalman未来予測を紫色で表示（未来延長の目標50ms）

描線・採点処理は安定版と共通です。実験ページから渡す既定ONの設定だけでDelegated Inkを
切り替えます。実験値は開発者ツールから`window.__cursorExperiment`で確認できます。
予測描線は次の実入力で消去され、採点対象の点列には追加されません。
実入力と各時点の予測点列は`window.__predictionTrace`に最大20,000件記録されます。
ModelerモードはGoogle公式サイトから関連実装として案内されている、Google非保守の
TypeScript移植版をコミットSHA固定で使用します。詳細は`THIRD_PARTY_NOTICES.md`を参照してください。

`npm run build`の出力先は`public/`です。ローカル確認時は任意のHTTPサーバーで
`public/`を配信してください。

## 公開

`main`ブランチへpushすると、`.github/workflows/deploy-pages.yml`がテストとビルドを実行し、
生成物をGitHub Pagesへデプロイします。初回のみ、GitHubリポジトリの
**Settings → Pages → Source**で**GitHub Actions**を選択してください。
