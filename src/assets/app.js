/*
 * certification-log 共通スクリプト（記録の読み込み・集計・描画）
 *
 * <body data-page="..."> でページの種類を受け取る。
 *   home     … トップ（資格一覧）
 *   cert     … 資格ページ（cert.html?id=202610_ap のように certification/ 内のフォルダ名を渡す）
 *   glossary … 分からない単語の一覧
 */
(() => {
  'use strict';

  const PAGE = document.body.dataset.page || 'home';
  // 記録データは certification/ にある。公開時は src/ の中身と certification/ が同じ階層に並び、
  // ローカルでリポジトリのルートから src/ を開いたときは 1 つ上の階層にある
  const LOCAL = /\/src\/[^/]*$/.test(location.pathname);
  const DATA = `${LOCAL ? '../' : './'}certification/`;
  const STATUS = { studying: '学習中', passed: '✓ 合格' };
  const MARKS = { OK: 'OK', NG: 'NG', '○': 'OK', '◯': 'OK', '×': 'NG', '✕': 'NG', '✗': 'NG' };
  const UNSET = '（分野未設定）';
  const WEEK = '日月火水木金土';
  const EPS = 1e-9;

  /* ---------- 小物 ---------- */

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const collator = new Intl.Collator('ja', { numeric: true });
  const cmp = (a, b) => collator.compare(String(a), String(b));
  const norm = (s) => String(s ?? '').normalize('NFKC').trim().toLowerCase();
  const uniq = (list) => [...new Set(list)];
  const num = (n) => String(+n.toFixed(1));
  const pct = (r) => (r == null ? '—' : `${num(r * 100)}%`);
  const passes = (rate, line) => (rate == null ? null : rate + EPS >= line);

  function groupBy(list, keyOf) {
    const map = new Map();
    for (const item of list) {
      const key = keyOf(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }

  function parseDate(s) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s ?? '').trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const daysBetween = (from, to) => Math.round((to - from) / 86400000);
  function fmtDate(s) {
    const d = parseDate(s);
    return d ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` : String(s ?? '');
  }
  const fmtRange = (e) => (e.to && e.to !== e.from ? `${fmtDate(e.from)} 〜 ${fmtDate(e.to)}` : fmtDate(e.from));
  const shortDate = (s) => (parseDate(s) ? s.slice(5).replace('-', '/') : s);

  const certUrl = (id, hash = '') => `cert.html?id=${encodeURIComponent(id)}${hash ? `#${encodeURIComponent(hash)}` : ''}`;
  // 問題を一意に表すID（解答グリッドの行のアンカーにも使う）とメモのファイル名
  const qid = (set, section, no) => `q-${set}-${section}-${no}`.replace(/\s+/g, '_');
  const noteName = (file, no) => `${file}-q${no}.md`;

  /* ---------- 読み込み ---------- */

  async function fetchText(url) {
    let res;
    try {
      res = await fetch(url, { cache: 'no-cache' });
    } catch {
      throw new Error(`${url} を取得できませんでした`);
    }
    if (!res.ok) throw new Error(`${url} が見つかりません（HTTP ${res.status}）`);
    return decodeText(await res.arrayBuffer());
  }

  // UTF-8 が基本。Excel で保存した UTF-16（Unicode テキスト）や Shift_JIS も読めるようにしておく
  function decodeText(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder('shift_jis').decode(buf);
    }
  }

  async function fetchJSON(url) {
    const text = await fetchText(url);
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`${url} の JSON が正しくありません（${e.message}）`);
    }
  }

  // 資格フォルダと、その中の TSV・メモの一覧（新しい年月のフォルダから順に並べる）。
  // 公開時は GitHub Actions が作る index.json を読み、ローカルでは python -m http.server のフォルダ一覧から作る
  async function loadIndex() {
    const certs = LOCAL ? await listLocal() : (await fetchJSON(`${DATA}index.json`)).certs;
    return certs.sort((a, b) => cmp(b.dir, a.dir));
  }

  async function listDir(url) {
    const doc = new DOMParser().parseFromString(await fetchText(url), 'text/html');
    return [...doc.querySelectorAll('a[href]')]
      .map((a) => decodeURIComponent(a.getAttribute('href')))
      .filter((href) => !/^[?#/]|^\.\.|:/.test(href));
  }

  async function listLocal() {
    const dirs = (await listDir(DATA)).filter((e) => e.endsWith('/')).map((e) => e.slice(0, -1));
    const certs = await Promise.all(
      dirs.map(async (dir) => {
        const base = `${DATA}${encodeURIComponent(dir)}/`;
        const entries = await listDir(base);
        if (!entries.includes('cert.json')) return null;
        const notes = entries.includes('notes/') ? (await listDir(`${base}notes/`)).filter((f) => /\.md$/i.test(f)) : [];
        return { dir, files: entries.filter((f) => /\.tsv$/i.test(f)), notes };
      })
    );
    return certs.filter(Boolean);
  }

  // 横持ちの TSV：1 行 = 1 問。先頭の列が問題番号、見出しに「分野」を含む列が分野。
  // 残りの列は左から順に 1 回目・2 回目…の結果で、そのすぐ右の「単語」列がその回の分からなかった単語。
  // 回は見出しの文字ではなく列の並び順で数える。見出しに日付（2026-09-06）があればその回の解答日として使う
  function parseTSV(text) {
    const cell = (c) => {
      c = c.trim();
      return c.length > 1 && c[0] === '"' && c.at(-1) === '"' ? c.slice(1, -1).replace(/""/g, '"').trim() : c;
    };
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
    const header = (lines.shift() || '').split('\t').map(cell);
    let fieldCol = -1;
    const rounds = [];
    header.forEach((h, i) => {
      if (i === 0 || /メモ|備考/.test(h)) return;
      if (/分野/.test(h)) fieldCol = i;
      else if (/単語/.test(h)) {
        if (rounds.length) rounds.at(-1).wordsCol = i;
      } else rounds.push({ col: i, wordsCol: -1, date: (/\d{4}-\d{1,2}-\d{1,2}/.exec(h) || [''])[0] });
    });
    const misplaced = new Set(); // 単語の列に OK / NG が入っている列（回の見出しの付け忘れ）
    const rows = lines.map((line) => {
      const cols = line.split('\t').map(cell);
      return {
        no: (cols[0] || '').replace(/^問/, '').trim(),
        field: fieldCol >= 0 ? cols[fieldCol] || '' : '',
        rounds: rounds.map((r, i) => {
          const words = r.wordsCol >= 0 ? cols[r.wordsCol] || '' : '';
          if (MARKS[words.normalize('NFKC').trim().toUpperCase()]) misplaced.add(r.wordsCol);
          return { round: i + 1, date: r.date, value: cols[r.col] || '', words };
        }),
      };
    });
    const issues = [...misplaced].map(
      (c) => `${c + 1}列目「${header[c]}」に OK / NG が入っています。回の見出し（「${rounds.length + 1}回目」など）が足りないかもしれません`
    );
    return { rows, issues };
  }

  // cert.json と TSV を読み込んで 1 資格分のデータにする
  async function loadCert(entry) {
    const id = entry.dir;
    const base = `${DATA}${encodeURIComponent(id)}/`;
    const cert = await fetchJSON(`${base}cert.json`);
    const passLine = Number(cert.passLine ?? 0.6);
    const sections = (cert.sections?.length ? cert.sections : [{ id: 'A', name: '全体' }]).map((s) => ({
      id: String(s.id),
      name: s.name || String(s.id),
      type: s.type === 'score' ? 'score' : 'choice',
      max: Number(s.max) || null,
      fields: s.fields || [],
      required: s.required || [],
      choose: Number(s.choose) || 0,
    }));
    const findSection = (v) => sections.find((s) => norm(s.id) === norm(v));

    // ファイル名の末尾が「-科目ID」「_科目ID」ならその科目のファイル（r7-autumn-b.tsv → 問題セット r7-autumn の科目B）。
    // 付いていなければ cert.json の最初の科目として扱う
    const files = [...(entry.files || [])].sort(cmp).map((file) => {
      const stem = file.replace(/\.tsv$/i, '');
      const m = /^(.+)[-_]([^-_]+)$/.exec(stem);
      const sec = m && findSection(m[2]);
      return { file, stem, set: sec ? m[1] : stem, section: sec || sections[0] };
    });
    const texts = await Promise.allSettled(files.map((f) => fetchText(base + encodeURIComponent(f.file))));

    const warnings = [];
    const latest = new Map(); // 同じ「セット・科目・問題・回」が複数あれば後のものを採用
    files.forEach((f, i) => {
      if (texts[i].status === 'rejected') {
        warnings.push(texts[i].reason.message);
        return;
      }
      const { rows, issues } = parseTSV(texts[i].value);
      issues.forEach((msg) => warnings.push(`${f.file}：${msg}`));
      for (const row of rows) {
        for (const rec of toRecords(row, f, passLine)) latest.set([rec.set, rec.section, rec.no, rec.round].join('\t'), rec);
      }
    });

    const sets = uniq(files.map((f) => f.set)).map((setId) => ({
      id: setId,
      name: setId,
      sections: sections.filter((s) => files.some((f) => f.set === setId && f.section === s)),
    }));
    return {
      id, // フォルダ名（URL やファイルの場所に使う）
      label: String(cert.id || id).toUpperCase(), // 単語帳などに出す短い名前
      base,
      cert,
      passLine,
      passRule: cert.passRule === 'each' ? 'each' : 'total',
      sections,
      sets,
      records: [...latest.values()],
      notes: new Set(entry.notes || []),
      warnings,
    };
  }

  // 分野：「分野」列があればその値、空なら cert.json の sections[].fields の問題番号の範囲で決める
  function fieldOf(section, row) {
    if (row.field) return row.field;
    const n = parseInt(row.no, 10);
    return section.fields.find((f) => n >= f.from && n <= f.to)?.name || UNSET;
  }

  function toRecords(row, f, passLine) {
    if (!row.no) return [];
    const sec = f.section;
    const field = fieldOf(sec, row);
    const out = [];
    for (const r of row.rounds) {
      const unknown = r.words
        .split(/[;；、,，]/)
        .map((w) => w.trim())
        .filter((w) => w && !MARKS[w.normalize('NFKC').toUpperCase()]);
      const rec = {
        set: f.set,
        section: sec.id,
        type: sec.type,
        file: f.stem,
        no: row.no,
        field,
        round: r.round,
        date: r.date,
        unknown,
        answered: false,
        ok: null,
        value: 0, // 1 問あたりの得点率（選択式は 1 / 0）
        pts: 0,
        full: 0,
      };
      const value = r.value.normalize('NFKC').trim();
      if (sec.type === 'score') {
        // 記述式は「14/20」、満点を cert.json の max に書いていれば「14」だけでもよい
        const m = /^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?$/.exec(value);
        const score = m ? +m[1] : NaN;
        const max = m && m[2] ? +m[2] : sec.max;
        if (Number.isFinite(score) && max > 0) {
          Object.assign(rec, { answered: true, score, max, pts: score, full: max, value: score / max, ok: passes(score / max, passLine) });
        }
      } else {
        const result = MARKS[value.toUpperCase()];
        if (result) {
          const ok = result === 'OK';
          Object.assign(rec, { answered: true, result, pts: ok ? 1 : 0, full: 1, value: ok ? 1 : 0, ok });
        }
      }
      if (rec.answered || unknown.length) out.push(rec);
    }
    return out;
  }

  /* ---------- 集計 ---------- */

  // 正答率：選択式だけなら OK÷(OK+NG)、記述式だけなら 得点合計÷満点合計、混在なら 1 問ごとの得点率の平均
  function tally(recs) {
    const t = { n: 0, ok: 0, pts: 0, full: 0, value: 0, choice: 0, score: 0 };
    for (const r of recs) {
      if (!r.answered) continue;
      t.n++;
      t[r.type]++;
      if (r.ok) t.ok++;
      t.pts += r.pts;
      t.full += r.full;
      t.value += r.value;
    }
    t.rate = !t.n ? null : t.choice ? t.value / t.n : t.pts / t.full;
    return t;
  }
  function tallyText(t) {
    if (!t.n) return '';
    if (!t.score) return `${t.ok}/${t.n}問`;
    if (!t.choice) return `${num(t.pts)}/${num(t.full)}点`;
    return `${t.n}問`;
  }

  function overview(data) {
    const answered = data.records.filter((r) => r.answered);
    return {
      t: tally(answered),
      solved: new Set(answered.map((r) => qid(r.set, r.section, r.no))).size,
      lastDate: data.records.map((r) => r.date).filter(Boolean).sort().at(-1) || '',
    };
  }

  // 正答率の低い分野（分野が決まっている解答だけで集計）
  function weakFields(data, limit = 3) {
    const recs = data.records.filter((r) => r.answered && r.field !== UNSET);
    return [...groupBy(recs, (r) => r.field)]
      .map(([field, rs]) => ({ field, t: tally(rs) }))
      .filter((x) => x.t.rate < 1)
      .sort((a, b) => a.t.rate - b.t.rate || b.t.n - a.t.n)
      .slice(0, limit);
  }

  // 問題ごとに全回の記録をまとめる
  function questionsOf(data) {
    const setIdx = new Map(data.sets.map((s, i) => [s.id, i]));
    const secIdx = new Map(data.sections.map((s, i) => [s.id, i]));
    const qs = [...groupBy(data.records, (r) => qid(r.set, r.section, r.no))].map(([key, recs]) => {
      recs.sort((a, b) => a.round - b.round);
      const answered = recs.filter((r) => r.answered);
      const { set, section, no, file } = recs[0];
      const note = noteName(file, no);
      return {
        key,
        set,
        section,
        no,
        recs,
        field: recs.at(-1).field,
        first: answered[0] || null,
        latest: answered.at(-1) || null,
        ngCount: answered.filter((r) => !r.ok).length,
        words: uniq(recs.flatMap((r) => r.unknown)),
        note: data.notes.has(note) ? note : null,
      };
    });
    return qs.sort((a, b) => setIdx.get(a.set) - setIdx.get(b.set) || secIdx.get(a.section) - secIdx.get(b.section) || cmp(a.no, b.no));
  }

  const setName = (data, id) => data.sets.find((s) => s.id === id)?.name || id;
  const sectionName = (data, id) => data.sections.find((s) => s.id === id)?.name || id;
  const questionLabel = (data, q) =>
    `${setName(data, q.set)}${data.sections.length > 1 ? ` ${sectionName(data, q.section)}` : ''} 問${q.no}`;
  const ruleText = (data) =>
    data.passRule === 'each' ? `各${data.sections.length > 1 ? '科目' : ''} ${pct(data.passLine)} 以上` : `合計 ${pct(data.passLine)} 以上`;

  /* ---------- 部品 ---------- */

  const block = (title, inner, desc = '') =>
    inner ? `<section class="block"><h2>${esc(title)}</h2>${desc ? `<p class="desc">${esc(desc)}</p>` : ''}${inner}</section>` : '';
  const tableWrap = (inner, cls = '') => `<div class="table-wrap"><table class="${cls}">${inner}</table></div>`;
  const statusBadge = (status) => `<span class="status status-${esc(status)}">${esc(STATUS[status] || status || '—')}</span>`;
  const words = (list) => (list.length ? `<ul class="words">${list.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '');
  const warningsBlock = (list) =>
    list.length ? `<div class="alert warn"><strong>データを確認してください</strong><ul>${list.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';

  function meter(rate, line) {
    if (rate == null) return '<span class="meter is-empty" aria-hidden="true"></span>';
    const low = !passes(rate, line);
    return `<span class="meter${low ? ' is-low' : ''}" aria-hidden="true"><span class="meter-fill" style="width:${(rate * 100).toFixed(1)}%"></span><span class="meter-line" style="left:${(line * 100).toFixed(1)}%"></span></span>`;
  }

  function rateCell(t, line, note = '') {
    const sub = [tallyText(t), note].filter(Boolean).join(' · ');
    return `<div class="rate-cell"><span class="rate">${pct(t.rate)}</span>${meter(t.rate, line)}<span class="sub">${esc(sub)}</span></div>`;
  }

  function verdict(pass, note = '') {
    if (pass === true) return '<span class="verdict pass">✓ 合格</span>';
    if (pass === false) return '<span class="verdict fail">✗ 不合格</span>';
    return `<span class="verdict none">— ${esc(note || '判定なし')}</span>`;
  }

  function mark(r) {
    const when = `${r.round}回目${r.date ? `（${r.date}）` : ''}`;
    if (!r.answered) return `<span class="mark blank" title="${esc(when)} 未解答">－</span>`;
    if (r.type === 'score') {
      return `<span class="mark score ${r.ok ? 'ok' : 'ng'}" title="${esc(`${when} ${pct(r.value)}`)}">${num(r.score)}<small>/${num(r.max)}</small></span>`;
    }
    const label = r.ok ? '正解' : '不正解';
    return `<span class="mark ${r.ok ? 'ok' : 'ng'}" title="${esc(`${when} ${label}`)}" role="img" aria-label="${label}">${r.ok ? '○' : '×'}</span>`;
  }

  const noteButton = (data, q) =>
    q.note ? `<button type="button" class="note-btn" data-note="${esc(q.note)}" data-title="${esc(questionLabel(data, q))}">メモ</button>` : '';

  function examBlock(cert) {
    if (cert.status === 'passed') {
      return `<p class="passed-on">合格日：${cert.passedOn ? esc(fmtDate(cert.passedOn)) : '<span class="muted">未記入</span>'}</p>`;
    }
    const today = startOfToday();
    const upcoming = (cert.examDates || [])
      .map((e) => ({ ...e, start: parseDate(e.from), end: parseDate(e.to || e.from) }))
      .filter((e) => e.start && e.end && e.end >= today)
      .sort((a, b) => a.start - b.start);
    if (!upcoming.length) return '<p class="passed-on muted">予定している試験日はありません</p>';
    const [next, ...rest] = upcoming;
    const during = next.start <= today;
    const days = daysBetween(today, during ? next.end : next.start);
    const restItem = (e) => {
      const d = daysBetween(today, e.start);
      return `<li>${esc(e.label || '')}：${esc(fmtRange(e))}<span class="muted">（${d > 0 ? `あと${d}日` : '受験期間中'}）</span></li>`;
    };
    return `<div class="countdown">
      <p class="countdown-label">${esc(next.label || '次の試験')}${during ? '（受験期間中）' : ''}</p>
      <p class="countdown-days">${during ? '終了まで' : 'あと'}<strong>${days}</strong>日</p>
      <p class="countdown-range">${esc(fmtRange(next))}</p>
      ${rest.length ? `<ul class="countdown-rest">${rest.map(restItem).join('')}</ul>` : ''}
    </div>`;
  }

  // 最終学習日は TSV の見出しに日付があるときだけ出す。なければ問題セット数
  function lastStat(data, lastDate) {
    return lastDate ? ['最終学習日', esc(shortDate(lastDate))] : ['問題セット', `${data.sets.length}`];
  }

  function statsList(data) {
    const { t, solved, lastDate } = overview(data);
    const [lastLabel, lastValue] = lastStat(data, lastDate);
    return `<dl class="stats">
      <div><dt>正答率</dt><dd>${pct(t.rate)}</dd></div>
      <div><dt>解いた問題</dt><dd>${solved}<small>問</small></dd></div>
      <div><dt>のべ解答数</dt><dd>${t.n}<small>回</small></dd></div>
      <div><dt>${lastLabel}</dt><dd>${lastValue}</dd></div>
    </dl>`;
  }

  /* ---------- 共通の枠 ---------- */

  function renderShell() {
    const nav = [
      ['home', './', '資格一覧'],
      ['glossary', 'glossary.html', '単語帳'],
    ];
    document.body.insertAdjacentHTML(
      'afterbegin',
      `<a class="skip" href="#main">本文へ移動</a>
      <header class="site-header"><div class="wrap">
        <a class="brand" href="./">certification-log</a>
        <nav aria-label="サイト">${nav.map(([page, href, label]) => `<a href="${href}"${PAGE === page ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
      </div></header>
      <main id="main" class="wrap"><p class="loading">読み込み中…</p></main>
      <footer class="site-footer"><div class="wrap">問題文・選択肢は掲載せず、問題番号・正誤・得点・分からない単語のみを記録しています。</div></footer>`
    );
    return document.getElementById('main');
  }

  function showError(main, err) {
    const hint =
      location.protocol === 'file:' || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !LOCAL)
        ? '<p>ローカルで確認するときは、リポジトリのルートで <code>python -m http.server</code> を実行し、<code>http://localhost:8000/src/</code> を開いてください。</p>'
        : '';
    main.innerHTML = `<div class="alert"><p><strong>読み込みに失敗しました。</strong>${esc(err.message)}</p>${hint}</div>`;
    console.error(err);
  }

  /* ---------- トップ ---------- */

  async function renderHome(main) {
    const entries = await loadIndex();
    const results = await Promise.allSettled(entries.map(loadCert));
    const card = (r, i) => {
      if (r.status === 'rejected') {
        return `<div class="card"><div class="card-head"><h2>${esc(entries[i].dir)}</h2></div><div class="alert">${esc(r.reason.message)}</div></div>`;
      }
      const data = r.value;
      const { t, solved, lastDate } = overview(data);
      const [lastLabel, lastValue] = lastStat(data, lastDate);
      const weak = weakFields(data);
      return `<a class="card cert-card" href="${esc(certUrl(data.id))}">
        <div class="card-head"><h2>${esc(data.cert.name || data.id)}</h2>${statusBadge(data.cert.status)}</div>
        ${examBlock(data.cert)}
        <div class="card-rate">
          <div class="card-rate-head"><span class="big">${pct(t.rate)}</span><span class="sub">正答率（合格基準 ${esc(ruleText(data))}）</span></div>
          ${meter(t.rate, data.passLine)}
        </div>
        ${
          weak.length
            ? `<div class="card-weak"><span class="sub">苦手分野</span><ul>${weak
                .map((w) => `<li${passes(w.t.rate, data.passLine) ? '' : ' class="is-low"'}>${esc(w.field)}<b>${pct(w.t.rate)}</b></li>`)
                .join('')}</ul></div>`
            : ''
        }
        <dl class="mini">
          <div><dt>解いた問題</dt><dd>${solved}問</dd></div>
          <div><dt>のべ解答</dt><dd>${t.n}回</dd></div>
          <div><dt>${lastLabel}</dt><dd>${lastValue}</dd></div>
        </dl>
        ${data.warnings.length ? '<p class="card-warn">⚠ 読み込めないデータがあります</p>' : ''}
      </a>`;
    };
    main.innerHTML = `
      <h1 class="page-title">資格一覧</h1>
      <p class="lead">過去問・模擬問題の解答記録から、正答率と苦手分野を集計しています。</p>
      ${entries.length ? `<div class="cards">${results.map(card).join('')}</div>` : '<p class="empty">certification/ に資格フォルダがありません。</p>'}`;
  }

  /* ---------- 資格ページ ---------- */

  async function renderCert(main) {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) throw new Error('資格が指定されていません（cert.html?id=202610_ap のようにフォルダ名を付けて開いてください）');
    const entry = (await loadIndex()).find((e) => e.dir === id);
    if (!entry) throw new Error(`certification/${id}/（cert.json のあるフォルダ）が見つかりません`);
    const data = await loadCert(entry);
    const name = data.cert.name || id;
    document.title = `${name} | certification-log`;
    const qs = questionsOf(data);
    main.innerHTML = [
      `<section class="cert-hero">
        <div class="cert-hero-main">
          <p class="eyebrow">${statusBadge(data.cert.status)}<span>合格基準：${esc(ruleText(data))}</span></p>
          <h1>${esc(name)}</h1>
          ${statsList(data)}
          <p class="links"><a href="glossary.html?cert=${encodeURIComponent(id)}">この資格の分からない単語を見る →</a></p>
        </div>
        ${examBlock(data.cert)}
      </section>`,
      warningsBlock(data.warnings),
      data.records.length
        ? [fieldRates(data, qs), scoreFields(data), weakList(data, qs), setResults(data), answerGrid(data, qs)].join('')
        : '<p class="empty">まだ記録がありません。このフォルダに TSV を置いてください。</p>',
    ].join('');
    setupNotes(main, data);
    focusHash();
  }

  // 分野別の正答率（選択式）。初回＝各問題を最初に解いたときの結果だけで計算したもの
  function fieldRates(data, qs) {
    const html = data.sections
      .filter((s) => s.type === 'choice')
      .map((s) => {
        const recs = data.records.filter((r) => r.section === s.id && r.answered);
        if (!recs.length) return '';
        const firsts = groupBy(
          qs.filter((q) => q.section === s.id && q.first).map((q) => q.first),
          (r) => r.field
        );
        const rows = [...groupBy(recs, (r) => r.field)]
          .map(([field, rs]) => ({ field, t: tally(rs), first: tally(firsts.get(field) || []) }))
          .sort((a, b) => a.t.rate - b.t.rate || cmp(a.field, b.field));
        const body = rows
          .map(
            ({ field, t, first }) => `<tr>
              <th scope="row">${esc(field)}</th>
              <td class="bar-cell"><div class="bar-row"><span class="rate">${pct(t.rate)}</span>${meter(t.rate, data.passLine)}</div></td>
              <td class="num">${pct(first.rate)}</td>
              <td class="num">${t.ok}/${t.n}</td>
              <td class="num">${first.n}問</td>
            </tr>`
          )
          .join('');
        return `${data.sections.length > 1 ? `<h3>${esc(s.name)}</h3>` : ''}${tableWrap(
          `<thead><tr><th>分野</th><th>正答率</th><th class="num">初回</th><th class="num">正解/解答</th><th class="num">問題数</th></tr></thead><tbody>${body}</tbody>`,
          'bars'
        )}`;
      })
      .join('');
    return block(
      '分野別の正答率',
      html,
      '正答率の低い順です。「初回」は各問題を最初に解いたときの正答率です（2回目以降は答えを覚えていることがあるので、実力に近いのは初回です）。'
    );
  }

  // 分野別の平均得点率（記述式）と選択候補
  function scoreFields(data) {
    const html = data.sections
      .filter((s) => s.type === 'score')
      .map((s) => {
        const recs = data.records.filter((r) => r.section === s.id && r.answered);
        if (!recs.length) return '';
        const required = new Set(s.required.map(norm));
        const rows = [...groupBy(recs, (r) => r.field)]
          .map(([field, rs]) => ({ field, t: tally(rs), required: required.has(norm(field)), pick: false }))
          .sort((a, b) => b.t.rate - a.t.rate || cmp(a.field, b.field));
        const picks = s.choose ? rows.filter((r) => !r.required).slice(0, s.choose) : [];
        picks.forEach((r) => (r.pick = true));
        const summary = picks.length
          ? `<p class="callout"><strong>選択候補</strong>：${picks.map((r) => esc(r.field)).join('、')}${
              s.required.length ? `<span class="sub">（必須：${s.required.map(esc).join('、')}）</span>` : ''
            }</p>`
          : '';
        const body = rows
          .map((r) => {
            const tag = r.required ? '<span class="tag">必須</span>' : r.pick ? '<span class="tag pick">選択候補</span>' : '';
            return `<tr class="${r.pick ? 'is-pick' : ''}">
              <th scope="row">${esc(r.field)}${tag}</th>
              <td class="bar-cell"><div class="bar-row"><span class="rate">${pct(r.t.rate)}</span>${meter(r.t.rate, data.passLine)}</div></td>
              <td class="num">${num(r.t.pts)}/${num(r.t.full)}点</td>
              <td class="num">${r.t.n}回</td>
            </tr>`;
          })
          .join('');
        return `${data.sections.length > 1 ? `<h3>${esc(s.name)}</h3>` : ''}${summary}${tableWrap(
          `<thead><tr><th>分野</th><th>平均得点率</th><th class="num">得点/満点</th><th class="num">解答</th></tr></thead><tbody>${body}</tbody>`,
          'bars'
        )}`;
      })
      .join('');
    return block(
      '分野別の平均得点率（記述式）',
      html,
      '得点率の高い順です。必須分野以外で得点率の高い分野を「選択候補」として示します（数は cert.json の choose）。'
    );
  }

  // 苦手問題：NG が 2 回以上、または最新の解答が NG
  function weakList(data, qs) {
    const weak = qs
      .filter((q) => q.latest && (q.ngCount >= 2 || !q.latest.ok))
      .sort((a, b) => a.latest.ok - b.latest.ok || b.ngCount - a.ngCount);
    const hasNotes = weak.some((q) => q.note);
    const rows = weak.map(
      (q) => `<tr>
        <th scope="row"><a href="#${esc(encodeURIComponent(q.key))}">${esc(questionLabel(data, q))}</a></th>
        <td>${esc(q.field)}</td>
        <td><span class="history">${q.recs.map(mark).join('')}</span></td>
        <td class="num">${q.ngCount}</td>
        <td>${words(q.words)}</td>
        ${hasNotes ? `<td>${noteButton(data, q)}</td>` : ''}
      </tr>`
    );
    const inner = weak.length
      ? tableWrap(
          `<thead><tr><th>問題</th><th>分野</th><th>これまでの結果</th><th class="num">NG</th><th>分からない単語</th>${hasNotes ? '<th>メモ</th>' : ''}</tr></thead><tbody>${rows.join('')}</tbody>`,
          'weak'
        )
      : '<p class="empty">該当する問題はありません。</p>';
    return block('苦手問題', inner, 'NG が 2 回以上、または最新の解答が NG の問題です（記述式は得点率が合格基準未満を NG とみなします）。');
  }

  // 問題セットごと・回ごとの正答率と合否
  function setResults(data) {
    const html = data.sets
      .map((set) => {
        const recs = data.records.filter((r) => r.set === set.id);
        if (!recs.length) return `<h3>${esc(set.name)}</h3><p class="empty">記録がありません</p>`;
        const secs = set.sections;
        const hasDates = recs.some((r) => r.date);
        const total = new Map(secs.map((s) => [s.id, new Set(recs.filter((r) => r.section === s.id).map((r) => r.no)).size]));
        const rounds = uniq(recs.map((r) => r.round)).sort((a, b) => a - b);
        const rows = rounds.map((round) => {
          const inRound = recs.filter((r) => r.round === round);
          const dates = uniq(inRound.map((r) => r.date).filter(Boolean)).sort();
          const cells = secs.map((s) => {
            const t = tally(inRound.filter((r) => r.section === s.id));
            if (!t.n) return { pass: null, html: '<td><span class="muted">未記録</span></td>' };
            const pass = passes(t.rate, data.passLine);
            const partial = t.n < total.get(s.id) ? `全${total.get(s.id)}問中` : '';
            return { pass, html: `<td>${rateCell(t, data.passLine, partial)}${data.passRule === 'each' ? verdict(pass) : ''}</td>` };
          });
          const sum = tally(inRound);
          let pass = passes(sum.rate, data.passLine);
          let note = '';
          if (data.passRule === 'each') {
            if (cells.some((c) => c.pass === false)) {
              pass = false;
            } else if (cells.some((c) => c.pass === null)) {
              pass = null;
              note = '未記録の科目あり';
            } else {
              pass = true;
            }
          }
          const dateText = dates.length > 1 ? `${shortDate(dates[0])}〜${shortDate(dates.at(-1))}` : shortDate(dates[0] || '—');
          return `<tr>
            <th scope="row" class="nowrap">${round}回目</th>
            ${hasDates ? `<td class="nowrap">${esc(dateText)}</td>` : ''}
            ${cells.map((c) => c.html).join('')}
            ${secs.length > 1 ? `<td>${rateCell(sum, data.passLine)}</td>` : ''}
            <td>${verdict(pass, note)}</td>
          </tr>`;
        });
        const head = `<tr><th>回</th>${hasDates ? '<th>日付</th>' : ''}${secs.map((s) => `<th>${esc(s.name)}</th>`).join('')}${
          secs.length > 1 ? '<th>トータル</th>' : ''
        }<th>判定</th></tr>`;
        return `<h3>${esc(set.name)}</h3>${tableWrap(`<thead>${head}</thead><tbody>${rows.join('')}</tbody>`, 'results')}`;
      })
      .join('');
    return block('問題セット別の成績', html, `合格基準は${ruleText(data)}。縦線が合格基準の位置です。未解答（空欄）は分母に含めません。`);
  }

  // 解答グリッド：行が問題、列が回
  function answerGrid(data, qs) {
    const html = data.sets
      .flatMap((set) =>
        set.sections.map((s) => {
          const list = qs.filter((q) => q.set === set.id && q.section === s.id);
          if (!list.length) return '';
          const recs = list.flatMap((q) => q.recs);
          const rounds = uniq(recs.map((r) => r.round)).sort((a, b) => a - b);
          const firstDate = (n) => recs.filter((r) => r.round === n && r.date).map((r) => r.date).sort()[0];
          const hasNotes = list.some((q) => q.note);
          const head = `<tr><th scope="col">問</th><th scope="col">分野</th>${rounds
            .map((n) => `<th scope="col">${n}回目${firstDate(n) ? `<small>${esc(shortDate(firstDate(n)))}</small>` : ''}</th>`)
            .join('')}${hasNotes ? '<th scope="col">メモ</th>' : ''}</tr>`;
          const body = list
            .map((q) => {
              const byRound = new Map(q.recs.map((r) => [r.round, r]));
              const cells = rounds.map((n) => {
                const r = byRound.get(n);
                return `<td class="cell">${r ? mark(r) + words(r.unknown) : ''}</td>`;
              });
              return `<tr id="${esc(q.key)}"><th scope="row">${esc(q.no)}</th><td class="field">${esc(q.field)}</td>${cells.join('')}${
                hasNotes ? `<td>${noteButton(data, q)}</td>` : ''
              }</tr>`;
            })
            .join('');
          const title = `${esc(set.name)}${data.sections.length > 1 ? ` · ${esc(s.name)}` : ''}`;
          return `<details class="grid-set" open>
            <summary>${title}<span class="sub">${list.length}問 × ${rounds.length}回</span></summary>
            ${tableWrap(`<thead>${head}</thead><tbody>${body}</tbody>`, 'grid')}
          </details>`;
        })
      )
      .join('');
    return block('解答グリッド', html, '行が問題番号、列が解答した回です。○＝正解、×＝不正解、数字は記述式の得点です。');
  }

  // notes/ のメモをダイアログで表示する
  function setupNotes(main, data) {
    if (!data.notes.size) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'note-dialog';
    dialog.innerHTML = `<div class="note-inner">
      <div class="note-head"><h2></h2><button type="button" class="close" aria-label="閉じる">×</button></div>
      <div class="note-body md"></div>
    </div>`;
    document.body.append(dialog);
    const bodyEl = dialog.querySelector('.note-body');
    dialog.querySelector('.close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
    main.addEventListener('click', async (e) => {
      const btn = e.target.closest('.note-btn');
      if (!btn) return;
      const dir = `${data.base}notes/`;
      dialog.querySelector('h2').textContent = `${btn.dataset.title} のメモ`;
      bodyEl.innerHTML = '<p class="loading">読み込み中…</p>';
      dialog.showModal();
      try {
        bodyEl.innerHTML = renderMarkdown(await fetchText(dir + encodeURIComponent(btn.dataset.note)), dir);
      } catch (err) {
        bodyEl.innerHTML = `<div class="alert">${esc(err.message)}</div>`;
      }
    });
  }

  // 単語帳などから #q-... 付きで来たとき、描画後に該当の行へスクロールする
  function focusHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id && document.getElementById(id);
    if (!el) return;
    el.classList.add('is-target');
    el.scrollIntoView({ block: 'center' });
    window.addEventListener('hashchange', () => el.classList.remove('is-target'), { once: true });
  }

  // メモ用の最小限の Markdown 表示（見出し・段落・箇条書き・引用・表・コード・強調・リンク）
  function renderMarkdown(src, dir) {
    const inline = (s) =>
      s
        .split(/(`[^`]+`)/)
        .map((part, i) =>
          i % 2
            ? `<code>${esc(part.slice(1, -1))}</code>`
            : esc(part)
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
                  const raw = url.replace(/&amp;/g, '&');
                  if (/^[a-z][\w+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return text;
                  const href = /^(https?:|#|\/)/i.test(raw) ? raw : dir + raw;
                  return `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
                })
        )
        .join('');
    const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
    const isTableRule = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
    const isBlockStart = (line) => /^\s*(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(line);

    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (/^\s*```/.test(line)) {
        const code = [];
        for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
        i++;
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        const level = Math.min(6, m[1].length + 2);
        out.push(`<h${level}>${inline(m[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
        i++;
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        out.push('<hr>');
        i++;
      } else if (line.includes('|') && isTableRule(lines[i + 1] || '')) {
        const head = cells(line);
        const rows = [];
        for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]));
        out.push(
          `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows
            .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
            .join('')}</tbody></table></div>`
        );
      } else if (/^\s*>/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(inline(lines[i++].replace(/^\s*>\s?/, '')));
        out.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
      } else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d/.test(line);
        const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
        const items = [];
        while (i < lines.length && marker.test(lines[i])) items.push(inline(lines[i++].replace(marker, '')));
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`);
      } else if (!line.trim()) {
        i++;
      } else {
        const para = [];
        do para.push(inline(lines[i++]));
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]));
        out.push(`<p>${para.join('<br>')}</p>`);
      }
    }
    return out.join('\n');
  }

  /* ---------- 単語帳 ---------- */

  async function renderGlossary(main) {
    const entries = await loadIndex();
    const results = await Promise.allSettled(entries.map(loadCert));
    const datas = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const warnings = results.flatMap((r, i) => (r.status === 'rejected' ? [`${entries[i].dir}：${r.reason.message}`] : r.value.warnings));

    // 表記ゆれ（全角半角・大文字小文字）は同じ単語として扱う
    const found = new Map();
    for (const data of datas) {
      for (const r of data.records) {
        for (const w of r.unknown) {
          const key = norm(w);
          if (!found.has(key)) found.set(key, { word: w, key, occ: [] });
          found.get(key).occ.push({ data, r });
        }
      }
    }

    main.innerHTML = `
      <h1 class="page-title">単語帳</h1>
      <p class="lead">解答記録の「分からない単語」を全資格から集めています。</p>
      ${warningsBlock(warnings)}
      <div class="filters" role="search">
        <label class="filter-search"><span class="sr-only">単語を検索</span><input type="search" id="q" placeholder="単語を検索" autocomplete="off"></label>
        <label><span class="sr-only">資格で絞り込み</span><select id="cert"><option value="">すべての資格</option>${datas
          .map((d) => `<option value="${esc(d.id)}">${esc(d.cert.name || d.id)}</option>`)
          .join('')}</select></label>
        <label><span class="sr-only">並び順</span><select id="sort">
          <option value="count">回数が多い順</option>
          <option value="recent">最近出た順</option>
          <option value="name">名前順</option>
        </select></label>
      </div>
      <p class="count" id="count" aria-live="polite"></p>
      ${tableWrap(
        '<thead><tr><th>単語</th><th class="num">回数</th><th>資格</th><th>出た問題</th></tr></thead><tbody id="rows"></tbody>',
        'glossary'
      )}`;

    const qEl = main.querySelector('#q');
    const certEl = main.querySelector('#cert');
    const sortEl = main.querySelector('#sort');
    const params = new URLSearchParams(location.search);
    qEl.value = params.get('q') || '';
    if (datas.some((d) => d.id === params.get('cert'))) certEl.value = params.get('cert');

    const place = (occ) => {
      const { data, r } = occ[0];
      const rounds = uniq(occ.map((o) => o.r.round)).sort((a, b) => a - b).join('・');
      const q = { set: r.set, section: r.section, no: r.no };
      return `<li><a href="${esc(certUrl(data.id, qid(r.set, r.section, r.no)))}"><span class="tag">${esc(data.label)}</span>${esc(
        questionLabel(data, q)
      )}</a><span class="sub">（${rounds}回目）</span></li>`;
    };
    const row = (e) => {
      const places = [...groupBy(e.occ, (o) => `${o.data.id}\t${qid(o.r.set, o.r.section, o.r.no)}`).values()];
      const certs = uniq(e.occ.map((o) => o.data.cert.name || o.data.id));
      return `<tr>
        <th scope="row" class="word">${esc(e.word)}</th>
        <td class="num">${e.occ.length}</td>
        <td>${certs.map(esc).join('<br>')}</td>
        <td><ul class="places">${places.map(place).join('')}</ul></td>
      </tr>`;
    };

    const update = () => {
      const query = norm(qEl.value);
      const cert = certEl.value;
      const list = [];
      for (const e of found.values()) {
        if (query && !e.key.includes(query)) continue;
        const occ = cert ? e.occ.filter((o) => o.data.id === cert) : e.occ;
        if (occ.length) list.push({ ...e, occ, last: occ.map((o) => o.r.date).sort().at(-1) || '' });
      }
      const byName = (a, b) => cmp(a.word, b.word);
      const sorters = {
        count: (a, b) => b.occ.length - a.occ.length || byName(a, b),
        recent: (a, b) => b.last.localeCompare(a.last) || byName(a, b),
        name: byName,
      };
      list.sort(sorters[sortEl.value]);
      main.querySelector('#rows').innerHTML = list.length
        ? list.map(row).join('')
        : `<tr><td colspan="4" class="empty">${found.size ? '該当する単語はありません' : 'まだ単語が記録されていません'}</td></tr>`;
      main.querySelector('#count').textContent = `${list.length}語`;

      const next = new URLSearchParams();
      if (cert) next.set('cert', cert);
      if (qEl.value.trim()) next.set('q', qEl.value.trim());
      const search = next.toString();
      history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}`);
    };
    qEl.addEventListener('input', update);
    certEl.addEventListener('change', update);
    sortEl.addEventListener('change', update);
    update();
  }

  /* ---------- 起動 ---------- */

  const main = renderShell();
  const pages = { home: renderHome, cert: renderCert, glossary: renderGlossary };
  (pages[PAGE] || renderHome)(main).catch((err) => showError(main, err));
})();
