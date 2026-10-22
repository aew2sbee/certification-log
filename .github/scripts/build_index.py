"""公開用の certification/index.json を作る（資格フォルダと、その中の TSV・メモの一覧）

ブラウザはフォルダの中身を一覧できないため、公開時にこのファイルを作ってサイトから読む。
使い方: python build_index.py <certification フォルダ>
"""
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
certs = []
for d in sorted(p for p in root.iterdir() if (p / "cert.json").is_file()):
    notes = d / "notes"
    certs.append({
        "dir": d.name,
        "files": sorted(f.name for f in d.iterdir() if f.suffix.lower() == ".tsv"),
        "notes": sorted(f.name for f in notes.iterdir() if f.suffix.lower() == ".md") if notes.is_dir() else [],
    })
(root / "index.json").write_text(json.dumps({"certs": certs}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"{root / 'index.json'}: {len(certs)} certs")
