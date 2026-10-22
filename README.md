# certification-log

IT資格の過去問・模擬問題の解答記録を GitHub で管理し、GitHub Pages で正答率を確認するための静的サイトです。
ビルド不要の HTML / CSS / JavaScript だけで動き、外部ライブラリは使っていません。

- 公開URL：https://<ユーザー名>.github.io/certification-log/
- 記録するのは **問題番号・正誤・得点・分からない単語だけ** です。問題文や選択肢は載せません。

## ページ

| ページ | 内容 |
| --- | --- |
| トップ（`index.html`） | 資格ごとのカード：資格名、状態（学習中 / 合格）、合格日、全体の正答率、解いた問題数。学習中の資格は次の試験までの残り日数を大きく表示 |
| 資格ページ（`ap/` など） | 問題セット・回ごとの正答率と合否判定（科目別・トータル）、苦手問題、分野別の正答率、記述式の分野別平均得点率と選択候補、解答グリッド、メモ（`notes/`）の表示 |
| 単語帳（`glossary.html`） | 全資格の「分からない単語」の一覧。単語の検索、資格での絞り込み、並び替え。`glossary.html?cert=ap` で資格を指定して開けます |

## ディレクトリ構成

```
certification-log/
├── README.md
├── .gitignore
├── .nojekyll             ← GitHub Pages で Jekyll の変換を止める（notes の .md をそのまま配信するため）
├── index.html            ← トップ
├── glossary.html         ← 単語帳
├── certs.json            ← 表示する資格の一覧（この順でトップに並ぶ）
├── assets/
│   ├── style.css         ← 全ページ共通のスタイル（ライト / ダーク対応）
│   └── app.js            ← TSV の読み込み・集計・描画（全ページ共通）
├── ap/                   ← 応用情報技術者試験
│   ├── index.html        ← 全資格共通の数行だけのファイル（中身は ../assets/app.js が描画）
│   ├── cert.json         ← 資格の設定とデータファイルの一覧
│   ├── r7-autumn-a.tsv   ← 科目A（選択式）の記録
│   ├── r7-autumn-b.tsv   ← 科目B（記述式）の記録
│   └── notes/            ← 問題ごとのメモ（AI との質疑など）
├── sg/                   ← 情報セキュリティマネジメント試験
├── fe/                   ← 基本情報技術者試験
└── clf/                  ← AWS Certified Cloud Practitioner
```

各資格フォルダの `index.html` はすべて同じ内容です。資格IDはフォルダ名から判定します
（`<body data-cert="ap">` のように書けば明示的に指定もできます）。

## データ形式

### TSV（共通）

- 1行目はヘッダー、文字コードは UTF-8、区切りはタブ。列はヘッダー名で読むので順番は自由です
- 1ファイル = 1問題セット（どのセットのファイルかは cert.json の `sets` で決まります）
- 同じ「問題セット・科目・問題番号・回」の行が複数あるときは、後の行が使われます
- `unknown`（分からなかった単語）は `;` 区切りで複数書けます（全角の `；` も可）
- Excel の「Unicode テキスト」「テキスト（タブ区切り）」で保存したファイルも読めますが、基本は UTF-8 にしてください

### 選択式（応用情報の科目A、sg・fe・clf）

```tsv
set	no	section	field	round	date	result	unknown
mock01	2	A	セキュリティ管理	1	2025-05-01	NG	JIS Q 27001;JPCERT/CC
mock01	2	A	セキュリティ管理	2	2025-05-10	OK	
```

| 列 | 内容 |
| --- | --- |
| set | 問題セットID（cert.json の `sets[].id` と同じ） |
| no | 問題番号 |
| section | 科目区分（cert.json の `sections[].id`。A / B など） |
| field | ジャンル（分野別の集計に使う） |
| round | 何回目の解答か（1, 2, 3…） |
| date | 解答日（YYYY-MM-DD） |
| result | `OK` / `NG`。未解答は空欄 |
| unknown | 分からなかった単語。複数は `;` 区切り |

`section` が cert.json の `sections` にない値の場合、セクションが1つだけの資格ではそのセクションとして集計します
（AWS のように `section` にドメイン名を書いても動きます。サンプルの clf は `section` を `CLF`、ドメインを `field` にしています）。

### 記述式（応用情報の科目B）

```tsv
set	no	field	round	date	score	max	unknown
r7-autumn	1	情報セキュリティ	1	2026-11-01	14	20	SPF
r7-autumn	6	データベース	1	2026-11-01	12	20	正規化
```

`section` 列はなく、cert.json の `files` でどの科目のファイルかを決めます。`score` が空欄の行は未解答として扱います。

### cert.json

```json
{
  "id": "ap",
  "name": "応用情報技術者試験",
  "status": "studying",
  "passedOn": null,
  "passLine": 0.6,
  "passRule": "each",
  "sections": [
    { "id": "A", "name": "科目A", "type": "choice" },
    { "id": "B", "name": "科目B", "type": "score", "required": ["情報セキュリティ"], "choose": 4 }
  ],
  "examDates": [
    { "label": "令和8年度後期 科目A", "from": "2027-02-06", "to": "2027-02-19" },
    { "label": "令和8年度後期 科目B", "from": "2027-03-03", "to": "2027-03-15" }
  ],
  "sets": [
    { "id": "r7-autumn", "name": "令和7年度秋期", "files": { "A": "r7-autumn-a.tsv", "B": "r7-autumn-b.tsv" } }
  ],
  "notes": ["r7-autumn-a-q12.md"]
}
```

| キー | 内容 |
| --- | --- |
| id | 資格ID（フォルダ名と同じにする） |
| name | 表示名 |
| status | `studying`（学習中）/ `passed`（合格） |
| passedOn | 合格日 `"YYYY-MM-DD"`。未定なら `null` |
| passLine | 合格基準（0〜1。0.6 = 60%） |
| passRule | `each` = 科目ごとに合格基準以上が必要 / `total` = 合計で判定 |
| sections | 科目の一覧。`type` は `choice`（選択式）/ `score`（記述式） |
| sections[].required | 記述式のみ・任意。必須の分野（`field` の値） |
| sections[].choose | 記述式のみ・任意。必須以外から選ぶ問題数。指定すると「選択候補」を表示 |
| examDates | 試験日程。`from`〜`to` が受験期間。学習中の資格は次の試験までの日数を表示 |
| sets | 問題セットの一覧。`files` は `{ 科目ID: ファイル名 }`、または全科目を1ファイルにまとめた場合はファイル名の文字列（`"files": "mock01.tsv"`。この場合は TSV の `section` 列で科目を区別） |
| notes | `notes/` に置いたメモのファイル名。ここに書いた問題にだけ「メモ」ボタンが出ます |

ブラウザはフォルダの中身を一覧できないため、TSV とメモのファイル名は cert.json に書く必要があります。

### certs.json

トップと単語帳に表示する資格IDの配列です。この順でカードが並びます。

```json
["ap", "sg", "fe", "clf"]
```

### メモ（notes/）

- ファイル名は `<問題セットID>-<科目IDの小文字>-q<問題番号>.md`（例：`r7-autumn-a-q12.md` = r7-autumn の科目A 問12）
- 作成したら cert.json の `notes` にファイル名を追加します
- 資格ページの「メモ」ボタンで開きます。見出し・箇条書き・番号付きリスト・引用・表・コード・太字・リンクを表示できます
- 問題文や選択肢は転載せず、質問と要点を自分の言葉で書いてください

## 記録の追加方法

1. 該当する TSV の末尾に行を追加する（`round` を1つ増やせば次の回として扱われます）
2. 新しい問題セットなら、TSV を作成して cert.json の `sets` に追加する
3. コミットして push する。GitHub Pages に反映されるまで数分かかります

## 新しい資格の追加方法

1. 既存の資格フォルダ（例：`sg/`）をコピーし、フォルダ名を新しい資格IDにする（例：`db/`）
2. `cert.json` を編集する（`id`・`name`・`status`・`passLine`・`passRule`・`sections`・`examDates`・`sets`・`notes`）
3. サンプルの TSV を削除・差し替えし、`notes/` の中身を空にする（`.gitkeep` は残す）
4. ルートの `certs.json` に資格IDを追加する

`index.html` はそのままで動きます。

## ローカルでの確認方法

データを `fetch` で読むため、HTML ファイルを直接ダブルクリックで開くと表示されません。
リポジトリのルートで簡易サーバーを起動して確認します。

```sh
python -m http.server 8000
```

ブラウザで http://localhost:8000/ を開きます。

## 集計ルール

- **正答率（選択式）**：OK ÷（OK + NG）。空欄（未解答）は分母に含めません
- **得点率（記述式）**：得点の合計 ÷ 満点の合計
- **選択式と記述式をまとめる場合**（トップの全体正答率、トータル）：1問ごとの得点率の平均
- **合否判定**：`each` は記録のあるすべての科目が合格基準以上で合格（記録がない科目があれば「判定なし」）。`total` はトータルが合格基準以上で合格
- **一部だけ解いた回**：その回に解いた問題だけで計算し、「全◯問中」と表示します
- **苦手問題**：NG が2回以上、または最新の解答が NG の問題。記述式は得点率が合格基準未満を NG とみなします
- **選択候補**：`type: "score"` の科目で `choose` を指定すると、`required` 以外の分野から平均得点率の高い順に `choose` 個を表示します

## GitHub Pages の公開設定

1. GitHub の Settings → Pages を開く
2. Build and deployment の Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にして保存
3. 数分後に https://<ユーザー名>.github.io/certification-log/ で公開されます

ルートの `.nojekyll` は消さないでください（消すと Jekyll が `notes/*.md` を HTML に変換してしまい、メモが読めなくなります）。

## 後で記入・差し替えが必要な項目

- [ ] この README の `<ユーザー名>`（2か所）
- [ ] `sg/cert.json`・`fe/cert.json`・`clf/cert.json` の `passedOn`（合格日を `"YYYY-MM-DD"` で。現在は `null`）
- [ ] 各資格のサンプルデータ（`ap/r7-autumn-a.tsv`・`ap/r7-autumn-b.tsv`・`sg/mock01.tsv`・`fe/sample.tsv`・`clf/sample.tsv`）を実際の記録に差し替え
- [ ] サンプルのメモ `ap/notes/r7-autumn-a-q12.md` を差し替えまたは削除（削除した場合は `ap/cert.json` の `notes` からも消す）
- [ ] 各 cert.json の `sets` の `id`・`name`（実際に解いた問題セットに合わせる）
- [ ] `ap/cert.json` の `examDates`（受験する回の日程が確定したら確認）

## 注意

- 問題文・選択肢は著作物なので載せないでください
- トークンやパスワードなどの秘密情報はコミットしないでください（`.env` は `.gitignore` 済み）
- 元データ（Excel など）は `raw/` に置けばコミットされません（`*.xlsx` も除外済み）
