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
  // 최소 2열(A,B) 필요 (필요시 3열까지 사용)
  const trimmed = rows
    .map((r) => [r?.[0] ?? "", r?.[1] ?? "", r?.[2] ?? ""].map((x) => String(x).trim()))
    .filter(([a, b, c]) => a || b || c);

  if (trimmed.length === 0) return [];

  // 헤더 행 제거(있을 경우)
  const [hA, hB, hC] = trimmed[0];
  const headerLike =
    /^(문제|키워드|답|인물|설명)$/i.test(hA) ||
    /^(문제|키워드|답|인물|설명)$/i.test(hB) ||
    /^(문제|키워드|답|인물|설명)$/i.test(hC) ||
    (hA.includes("문제") && hB.includes("키워드"));
  const data = headerLike ? trimmed.slice(1) : trimmed;

  const aIsProblem = headerLike && hA.includes("문제") && hB.includes("키워드");

  // 케이스 1) 3열: A=문제(탭), B=키워드(화면 "문제"에 표시), C=설명/답(답 영역에 표시)
  // 케이스 2) 2열(헤더가 문제/키워드): A=문제(탭), B=키워드(화면 "문제"에 표시)
  // 케이스 3) 기존: A=인물(답), B=설명(문제)
  return data
    .map(([a, b, c]) => {
      if (c && aIsProblem) {
        return { group: a.trim(), prompt: b.trim(), answer: c.trim() || a.trim() };
      }
      if (c) {
        return { group: a.trim(), answer: b.trim(), prompt: c.trim() };
      }
      if (aIsProblem) {
        // 탭은 A(문제), 화면의 "문제" 영역은 B(키워드)
        return { group: a.trim(), prompt: b.trim(), answer: a.trim() };
      }
      return { group: "전체", answer: a.trim(), prompt: b.trim() };
    })
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
  wrong: document.getElementById("wrong"),
  right: document.getElementById("right"),
  shuffle: document.getElementById("shuffle"),
  tabs: document.getElementById("tabs"),
  dataEditor: document.getElementById("dataEditor"),
  applyData: document.getElementById("applyData"),
  editorStatus: document.getElementById("editorStatus"),
  endDialog: document.getElementById("endDialog"),
  endDialogText: document.getElementById("endDialogText"),
  reviewWrong: document.getElementById("reviewWrong"),
};

let items = [...DEFAULT_ITEMS];
let order = [];
let idx = 0;
let mode = "normal"; // "normal" | "reviewWrong"
let activeGroup = "전체";
let wrongIdSet = new Set(); // stable IDs for wrong items (persistable)

function getSheetKey() {
  // sheet URL별로 상태 저장 (모바일/PC 각각 기기 localStorage에 유지)
  const sheetUrl = getSheetUrlFromQueryOrDefault();
  return `quizState:v1:${sheetUrl}`;
}

function itemId(it) {
  const g = it.group ?? "전체";
  return `${g}\u0000${it.prompt}\u0000${it.answer}`;
}

function saveState() {
  try {
    const payload = {
      activeGroup,
      wrongIds: Array.from(wrongIdSet),
      ts: Date.now(),
    };
    localStorage.setItem(getSheetKey(), JSON.stringify(payload));
  } catch {
    // ignore (storage full / blocked)
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(getSheetKey());
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.activeGroup === "string") activeGroup = parsed.activeGroup || "전체";
    if (Array.isArray(parsed?.wrongIds)) wrongIdSet = new Set(parsed.wrongIds.filter((x) => typeof x === "string"));
  } catch {
    // ignore
  }
}

function buildOrderForActiveGroup() {
  if (activeGroup === "전체") return shuffleInPlace(items.map((_, i) => i));
  return shuffleInPlace(
    items
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => (x.group ?? "전체") === activeGroup)
      .map(({ i }) => i),
  );
}

function resetOrder() {
  order = buildOrderForActiveGroup();
  idx = 0;
  mode = "normal";
  if (els.endDialog?.open) els.endDialog.close();
  saveState();
}

function getGroups() {
  const groups = new Set();
  for (const it of items) groups.add(it.group ?? "전체");
  return Array.from(groups);
}

function setActiveGroup(nextGroup) {
  activeGroup = nextGroup || "전체";
  if (els.endDialog?.open) els.endDialog.close();
  mode = "normal";
  order = buildOrderForActiveGroup();
  idx = 0;
  renderTabs();
  render();
  saveState();
}

function renderTabs() {
  const groups = getGroups().filter((g) => g && g !== "전체");
  if (!els.tabs) return;

  // group이 하나면 탭 영역 숨김
  if (groups.length <= 1) {
    els.tabs.classList.add("hidden");
    els.tabs.innerHTML = "";
    return;
  }

  els.tabs.classList.remove("hidden");
  const allGroups = ["전체", ...groups];
  els.tabs.innerHTML = allGroups
    .map((g) => {
      const pressed = g === activeGroup ? "true" : "false";
      return `<button type="button" class="tab ${g === activeGroup ? "isActive" : ""}" data-group="${encodeURIComponent(g)}" aria-pressed="${pressed}">${escapeHtml(g)}</button>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render() {
  if (items.length === 0) {
    els.prompt.textContent = "문제가 없습니다. 아래 데이터 편집에서 추가하세요.";
    els.answerText.textContent = "-";
    els.answerBox.classList.add("hidden");
    els.progress.textContent = "-";
    return;
  }

  // 현재 그룹에 해당하는 order가 없으면 재생성
  if (order.length === 0) {
    // activeGroup이 items에 없을 수 있으니, 첫 그룹으로 이동
    const groups = getGroups().filter((g) => g && g !== "전체");
    activeGroup = groups[0] ?? "전체";
    resetOrder();
  }

  if (idx >= order.length) {
    showEndDialog();
    return;
  }

  const current = items[order[idx]];
  els.prompt.textContent = current.prompt;
  els.answerText.textContent = current.answer;
  els.answerBox.classList.add("hidden");
  els.reveal.textContent = "답안보기";
  const total = order.length;
  const prefix = mode === "reviewWrong" ? "오답 다시보기 " : "";
  els.progress.textContent = `${prefix}${idx + 1} / ${total}`;
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

function showEndDialog() {
  const total = order.length;
  const wrongCount =
    activeGroup === "전체"
      ? items.filter((it) => wrongIdSet.has(itemId(it))).length
      : items.filter((it) => (it.group ?? "전체") === activeGroup && wrongIdSet.has(itemId(it))).length;
  const msg =
    mode === "reviewWrong"
      ? `오답 다시보기까지 완료했어요.`
      : wrongCount === 0
        ? `모든 문제를 다 풀었어요. 오답이 없습니다! (${total} / ${total})`
        : `모든 문제를 다 풀었어요. 오답 ${wrongCount}개가 있어요. (${total - wrongCount} / ${total})`;

  els.endDialogText.textContent = msg;
  els.reviewWrong.disabled = mode === "reviewWrong" || wrongCount === 0;
  if (!els.endDialog.open) els.endDialog.showModal();
}

function advance() {
  if (items.length === 0) return;
  idx += 1;
  if (idx >= order.length) {
    showEndDialog();
    return;
  }
  render();
}

function markWrong() {
  if (items.length === 0) return;
  if (idx >= order.length) return;
  const itemIndex = order[idx];
  if (mode === "normal") wrongIdSet.add(itemId(items[itemIndex]));
  saveState();
  advance();
}

function markRight() {
  if (items.length === 0) return;
  if (idx >= order.length) return;
  const itemIndex = order[idx];
  if (mode === "normal") wrongIdSet.delete(itemId(items[itemIndex]));
  saveState();
  advance();
}

function startWrongReview() {
  const wrongIndices = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) =>
      (activeGroup === "전체" || (it.group ?? "전체") === activeGroup) && wrongIdSet.has(itemId(it)),
    )
    .map(({ i }) => i);

  if (wrongIndices.length === 0) return;
  mode = "reviewWrong";
  order = wrongIndices;
  idx = 0;
  if (els.endDialog?.open) els.endDialog.close();
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
els.wrong.addEventListener("click", markWrong);
els.right.addEventListener("click", markRight);
els.shuffle.addEventListener("click", () => {
  resetOrder();
  render();
});
els.reviewWrong.addEventListener("click", startWrongReview);
els.tabs?.addEventListener("click", (e) => {
  const btn = e.target?.closest?.("button[data-group]");
  if (!btn) return;
  const g = decodeURIComponent(btn.getAttribute("data-group") || "");
  if (!g || g === activeGroup) return;
  setActiveGroup(g);
});

els.applyData.addEventListener("click", () => {
  try {
    const nextItems = tryParseItems(els.dataEditor.value);
    items = nextItems;
    const groups = getGroups();
    if (!groups.includes(activeGroup)) activeGroup = groups[0] ?? "전체";
    renderTabs();
    resetOrder();
    render();
    setEditorStatus(`적용 완료: ${items.length}개`, "ok");
  } catch (e) {
    setEditorStatus(`적용 실패: ${e?.message ?? "알 수 없는 오류"}`, "err");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === " " && !e.repeat) {
    // space로 답안 토글 (입력창 포커스일 때는 제외)
    const tag = document.activeElement?.tagName?.toLowerCase?.();
    if (tag !== "textarea" && tag !== "input") {
      e.preventDefault();
      toggleReveal();
    }
  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    // Ctrl+Enter로 정답 처리
    markRight();
  } else if (e.key === "Backspace" && (e.ctrlKey || e.metaKey)) {
    // Ctrl+Backspace로 틀림 처리
    markWrong();
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
  activeGroup = "전체";
  loadState();
  renderTabs();
  resetOrder();
  render();
  initEditor();

  const sheetUrl = getSheetUrlFromQueryOrDefault();
  try {
    setEditorStatus("구글 시트에서 불러오는 중…", "info");
    const nextItems = await loadFromGoogleSheet(sheetUrl);
    items = nextItems;
    // 저장된 activeGroup이 유효하면 유지, 아니면 첫 그룹으로
    const groups = getGroups();
    if (!groups.includes(activeGroup)) activeGroup = groups[0] ?? "전체";
    renderTabs();
    resetOrder();
    render();
    initEditor();
    setEditorStatus(`구글 시트 연동 완료: ${items.length}개`, "ok");
  } catch (e) {
    setEditorStatus(`구글 시트 연동 실패(로컬로 진행): ${e?.message ?? "알 수 없는 오류"}`, "err");
  }
}

boot();
