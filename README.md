# Tone Lab

Tone Labは、参考のギター音と自分の録音を比較し、音響特徴の差を「明るさ・太さ・アタック・圧縮感・粗さ」という調整可能な言葉へ変換するWebアプリです。

**現在のリリース: Rule-based MVP 1.0**

## できること

- WAV / MP3 / FLAC / OGGを2つ比較
- 最大5秒の開始位置ずれを自動補正
- フレーズ一致度と実際の比較区間を表示
- クリッピング、極端な低音量、音量差を入力時に警告
- 5つの質感差を`-100〜+100`で相対表示
- 波形の音量エンベロープと平均周波数分布を重ねて表示
- 位置同期・音量マッチ付きA/B試聴
- 差が大きい上位3項目の優先調整プランを表示
- 比較レポートをMarkdown / JSON / 印刷で保存
- 人間の聴感評価をJSONとして保存

このアプリは絶対的な音質点数を付けません。参考音に対して自分の音がどちらへ、どの程度ずれているかを示します。

## 起動方法

Docker Desktopを起動して、リポジトリ直下で実行します。

```bash
git switch main
git pull
docker compose up --build
```

- Web: http://localhost:3000
- API仕様: http://localhost:8000/docs

停止するときは、起動したターミナルで`Ctrl+C`を押します。

## 基本的な使い方

1. 参考音と自分の音を選ぶ
2. 「2つの音を比較する」を押す
3. 位置合わせと入力状態を確認する
4. 音量マッチ付きA/B試聴で耳でも確認する
5. 優先調整プランの1項目だけを変更する
6. 新しい録音でもう一度比較する
7. 必要ならレポートと聴感評価を保存する

## 比較条件

結果の信頼性は、次の条件が近いほど高くなります。

1. 同じフレーズを使う
2. ギター単体の音を使う
3. 演奏テンポと音価をなるべく揃える
4. 極端なマスタリング済み音源を避ける
5. 30秒以内の素材を使う

開始位置は最大5秒まで自動補正します。ただし、別演奏の途中のテンポずれやタイムストレッチは補正しません。

## プライバシー

- アップロード音源は解析中だけ一時ファイルとして扱い、処理終了後に削除します。
- データベース、ユーザー登録、音源の永続保存はありません。
- レポートと聴感評価はブラウザからユーザー端末へ保存され、サーバーへ送信されません。

## 指標の意味

| 指標 | 主な判断材料 |
|---|---|
| 明るさ | スペクトル重心、2kHz以上の割合 |
| 太さ | 250Hz〜2kHzのエネルギー割合 |
| アタック | オンセット強度 |
| 圧縮感 | 短時間ダイナミックレンジ、クレストファクター |
| 粗さ | 帯域内スペクトル平坦度、ゼロ交差率 |

各指標は複数の物理特徴を組み合わせた仮説的な相対値です。唯一の正解設定ではなく、調整方向を絞るために使います。

## 構成

```text
apps/web       Next.js / TypeScript
services/api   FastAPI / librosa / NumPy
docs           仕様・最終確認手順
.github        API / Web / Docker実行CI
```

処理の流れは次のとおりです。

```text
ファイル選択
  → 一時保存・デコード
  → 開始位置の自動補正
  → 入力品質チェック
  → 音響特徴抽出
  → 5軸の相対差へ変換
  → 調整プラン・グラフ・A/B試聴・レポート表示
```

## ローカル開発

### API

Python 3.12を推奨します。

```bash
cd services/api
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

### Web

別ターミナルで実行します。

```bash
cd apps/web
npm install
npm run dev
```

## 自動テスト

Pull Requestとmainへのpushで、次をGitHub Actionsが検証します。

- API単体・統合テスト
- ESLintとNext.js production build
- Docker ComposeでWeb/APIを実際に起動
- 自動生成WAVを比較APIへ送るE2Eスモークテスト

質感指標だけを手元で検証するCLIもあります。

```bash
cd services/api
PYTHONPATH=. python scripts/validate_metrics.py path/to/source.wav
```

検証音源も保存する場合は次のように実行します。

```bash
PYTHONPATH=. python scripts/validate_metrics.py path/to/source.wav \
  --output-dir validation-audio
```

## MVP 1.0の範囲外

- バンドミックスからギターだけを分離すること
- SNS動画から使用機材を断定すること
- 別テンポの演奏をタイムストレッチして一致させること
- あらゆる人に共通する絶対的な質感スコア
- 人間評価を学習した機械学習モデル
- HX Stompへプリセットを直接転送すること

これらはMVPの実機・聴感評価を蓄積した後の次段階です。

最終確認は[docs/REVIEW_CHECKLIST.md](docs/REVIEW_CHECKLIST.md)、詳細仕様は[docs/MVP.md](docs/MVP.md)を参照してください。
