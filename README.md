# Tone Lab

参考のギター音と自分のギター音を比較し、音響特徴の差を人間が使う質感語へ変換するWebアプリです。

## 最初のゴール

同じフレーズを録音した2音源について、次の違いを相対表示します。

- 明るさ
- 太さ
- アタック
- 圧縮感
- 歪みの粗さ

この段階では「太さ72点」のような絶対評価を行いません。参考音に対して自分の音がどちらへ、どの程度ずれているかを示します。

## 構成

```text
apps/web       Next.js / TypeScript
services/api   FastAPI / librosa / NumPy
docs           設計方針とロードマップ
```

## 起動方法：Docker

```bash
docker compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:8000/docs

## 起動方法：ローカル開発

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

## 比較時の条件

初期版は、以下の条件が近いほど結果の信頼性が上がります。

1. 同じフレーズを使う
2. 音源の開始位置をなるべくそろえる
3. ギター単体の音を使う
4. 極端なマスタリング済み音源を避ける
5. 30秒以内の素材を使う

## 現在の非目標

- SNSのバンド音源から使用機材を完全特定する
- あらゆる人に共通する絶対的な質感スコアを出す
- 一度の解析だけで唯一の正解設定を断定する

## 次の開発順

1. 実音源で分析値の妥当性を検証
2. 波形・周波数グラフを追加
3. A/Bブラインド評価を収集
4. 人間評価から質感モデルを学習
5. HX Stompのブロックと設定候補へ変換

詳しくは [docs/MVP.md](docs/MVP.md) を参照してください。
