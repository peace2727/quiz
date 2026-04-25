// 구글 시트 연동 (CSV export)
// - 시트를 "링크가 있는 모든 사용자: 뷰어"로 공유해야 브라우저에서 읽을 수 있습니다.
// - 기본 매핑: A열=답(인물), B열=문제(설명)
const GOOGLE_SHEET_URL_DEFAULT =
  "https://docs.google.com/spreadsheets/d/1jJMzvLD2ypiCeQo9hvGs0zRGCI-g8DdXjLt-6kQcZ9A/edit?gid=0#gid=0";

const DEFAULT_ITEMS = [
  { answer: "여운형", prompt: "조선 건국 동맹을 결성하였다." },
  { answer: "여운형", prompt: "좌우합작운동을 추진하였다." },
];

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function tryParseItems(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("배열(JSON Array)이어야 합니다.");

  const cleaned = parsed
    .map((x) => ({
      answer: typeof x?.answer === "string" ? x.answer.trim() : "",
      prompt: typeof x?.prompt === "string" ? x.prompt.trim() : "",
    }))
    .filter((x) => x.answer && x.prompt);

  if (cleaned.length === 0) throw new Error("유효한 항목이 없습니다.");
  return cleaned;
}

function parseSheetIdAndGid(sheetUrl) {
  const url = new URL(sheetUrl);
  const m = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!m) throw new Error("시트 URL에서 문서 ID를 찾지 못했습니다.");
  const sheetId = m[1];

  // gid는 fragment(#gid=0) 또는 query(?gid=0)에 있을 수 있음
  let gid = url.searchParams.get("gid");
  if (!gid && url.hash) {
    const h = new URLSearchParams(url.hash.replace(/^#/, ""));
    gid = h.get("gid");
  }
  return { sheetId, gid: gid ?? "0" };
}

function csvParse(text) {
  // RFC4180에 가깝게 처리 (따옴표, 콤마, 개행)
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (c === "\r") {
      i += 1;
      continue;
    }

    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  // 마지막 필드/로우
  row.push(field);
  rows.push(row);

  // 마지막이 완전 빈 줄이면 제거
  while (rows.length && rows[rows.length - 1].every((x) => (x ?? "").trim() === "")) rows.pop();
  return rows;
}

function rowsToItems(rows) {
  // 최소 2열(A,B) 필요
  const trimmed = rows
    .map((r) => [r?.[0] ?? "", r?.[1] ?? ""].map((x) => String(x).trim()))
    .filter(([a, b]) => a || b);

  if (trimmed.length === 0) return [];

  // 헤더 행 제거(있을 경우)
  const [hA, hB] = trimmed[0];
  const headerLike =
    /^(문제|키워드|답|인물)$/i.test(hA) ||
    /^(문제|키워드|답|인물)$/i.test(hB) ||
    (hA.includes("문제") && hB.includes("키워드"));
  const data = headerLike ? trimmed.slice(1) : trimmed;

  // 사용자 케이스: A=인물(답), B=설명(문제)
  return data
    .map(([a, b]) => ({ answer: a.trim(), prompt: b.trim() }))
    .filter((x) => x.answer && x.prompt);
}

async function loadFromGoogleSheet(sheetUrl) {
  const { sheetId, gid } = parseSheetIdAndGid(sheetUrl);
  const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  const res = await fetch(csvUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`시트 불러오기 실패 (HTTP ${res.status})`);
  const csv = await res.text();
  const rows = csvParse(csv);
  const nextItems = rowsToItems(rows);
  if (nextItems.length === 0) throw new Error("시트에서 유효한 데이터(2열)가 없습니다.");
  return nextItems;
}

const els = {
  progress: document.getElementById("progress"),
  prompt: document.getElementById("prompt"),
  answerBox: document.getElementById("answerBox"),
  answerText: document.getElementById("answerText"),
  reveal: document.getElementById("reveal"),
  next: document.getElementById("next"),
  shuffle: document.getElementById("shuffle"),
  dataEditor: document.getElementById("dataEditor"),
  applyData: document.getElementById("applyData"),
  editorStatus: document.getElementById("editorStatus"),
};

let items = [...DEFAULT_ITEMS];
let order = [];
let idx = 0;

function resetOrder() {
  order = shuffleInPlace(items.map((_, i) => i));
  idx = 0;
}

function render() {
  if (items.length === 0) {
    els.prompt.textContent = "문제가 없습니다. 아래 데이터 편집에서 추가하세요.";
    els.answerText.textContent = "-";
    els.answerBox.classList.add("hidden");
    els.progress.textContent = "-";
    return;
  }

  if (order.length !== items.length) resetOrder();

  const current = items[order[idx]];
  els.prompt.textContent = current.prompt;
  els.answerText.textContent = current.answer;
  els.answerBox.classList.add("hidden");
  els.reveal.textContent = "답안보기";
  els.progress.textContent = `${idx + 1} / ${items.length}`;
}

function reveal() {
  els.answerBox.classList.remove("hidden");
  els.reveal.textContent = "답 숨기기";
}

function hide() {
  els.answerBox.classList.add("hidden");
  els.reveal.textContent = "답안보기";
}

function toggleReveal() {
  if (els.answerBox.classList.contains("hidden")) reveal();
  else hide();
}

function next() {
  if (items.length === 0) return;

  idx += 1;
  if (idx >= order.length) {
    resetOrder(); // 한 바퀴 돌면 다시 랜덤
  }
  render();
}

function setEditorStatus(msg, kind = "info") {
  els.editorStatus.textContent = msg;
  els.editorStatus.style.color =
    kind === "ok" ? "rgba(114,242,192,0.95)" : kind === "err" ? "rgba(255,140,140,0.95)" : "";
}

function initEditor() {
  els.dataEditor.value = JSON.stringify(items, null, 2);
  setEditorStatus("");
}

els.reveal.addEventListener("click", toggleReveal);
els.next.addEventListener("click", next);
els.shuffle.addEventListener("click", () => {
  resetOrder();
  render();
});

els.applyData.addEventListener("click", () => {
  try {
    const nextItems = tryParseItems(els.dataEditor.value);
    items = nextItems;
    resetOrder();
    render();
    setEditorStatus(`적용 완료: ${items.length}개`, "ok");
  } catch (e) {
    setEditorStatus(`적용 실패: ${e?.message ?? "알 수 없는 오류"}`, "err");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    next();
  } else if (e.key === " " && !e.repeat) {
    // space로 답안 토글 (입력창 포커스일 때는 제외)
    const tag = document.activeElement?.tagName?.toLowerCase?.();
    if (tag !== "textarea" && tag !== "input") {
      e.preventDefault();
      toggleReveal();
    }
  }
});

function getSheetUrlFromQueryOrDefault() {
  // 사용자가 URL에 ?sheet=... 로 바꿔 끼울 수 있게
  const sp = new URLSearchParams(window.location.search);
  const sheet = sp.get("sheet");
  if (sheet && sheet.startsWith("http")) return sheet;
  return GOOGLE_SHEET_URL_DEFAULT;
}

async function boot() {
  resetOrder();
  render();
  initEditor();

  const sheetUrl = getSheetUrlFromQueryOrDefault();
  try {
    setEditorStatus("구글 시트에서 불러오는 중…", "info");
    const nextItems = await loadFromGoogleSheet(sheetUrl);
    items = nextItems;
    resetOrder();
    render();
    initEditor();
    setEditorStatus(`구글 시트 연동 완료: ${items.length}개`, "ok");
  } catch (e) {
    setEditorStatus(`구글 시트 연동 실패(로컬로 진행): ${e?.message ?? "알 수 없는 오류"}`, "err");
  }
}

boot();
