import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

/* ── helpers ── */
const uid = () => Math.random().toString(36).slice(2, 8);
const fmt = (n) => {
  const x = parseInt(String(n || "").replace(/[^0-9]/g, ""));
  if (!x || isNaN(x)) return n || "-";
  if (x >= 1_000_000) return (x / 1_000_000).toFixed(1) + "M";
  if (x >= 1_000) return Math.round(x / 1_000) + "K";
  return String(x);
};
const estimatePrice = (subs, views) => {
  const s = parseInt(String(subs || "").replace(/[^0-9]/g, "")) || 0;
  const v = parseInt(String(views || "").replace(/[^0-9]/g, "")) || 0;
  const base = s * 0.002 + v * 0.01;
  const lo = Math.round((base * 0.7) / 100) * 100;
  const hi = Math.round((base * 1.4) / 100) * 100;
  if (!lo) return "데이터 부족";
  return `$${lo.toLocaleString()} ~ $${hi.toLocaleString()}`;
};

/* ── localStorage ── */
const LS = {
  get: (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ── YouTube API ── */
async function ytSearch(q, apiKey, pageToken = "") {
  let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=20&q=${encodeURIComponent(q)}&key=${apiKey}`;
  if (pageToken) url += `&pageToken=${pageToken}`;
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "YouTube API 오류");
  return {
    ids: (d.items || []).map((i) => i.snippet.channelId),
    nextPageToken: d.nextPageToken || null,
  };
}
async function ytChannelStats(ids, apiKey) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${ids.join(",")}&key=${apiKey}`;
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "YouTube API 오류");
  return (d.items || []).map((i) => ({
    channelId: i.id,
    title: i.snippet.title,
    description: i.snippet.description,
    thumb: i.snippet.thumbnails?.medium?.url || i.snippet.thumbnails?.default?.url,
    country: i.snippet.country || "",
    subscribers: i.statistics.subscriberCount,
    views: i.statistics.viewCount,
    videos: i.statistics.videoCount,
    url: `https://www.youtube.com/channel/${i.id}`,
  }));
}

/* ── Claude API ── */
async function askClaude(prompt) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const d = await r.json();
    return d.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "";
  } catch (e) {
    return "AI 오류: " + e.message;
  }
}

/* ── Status colors ── */
const SC = { 미응답: "#999", 협의중: "#F59E0B", 수락: "#22C55E", 거절: "#EF4444", 완료: "#818CF8" };
const STATUSES = Object.keys(SC);

/* ════════════════ STYLES ════════════════ */
const S = {
  page: { minHeight: "100vh", background: "#f9f9f9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  header: { background: "#fff", borderBottom: "1px solid #e8e8e8", padding: "12px 28px", display: "flex", alignItems: "center", gap: 20, position: "sticky", top: 0, zIndex: 100 },
  logo: { width: 30, height: 30, background: "#111", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, color: "#fff", flexShrink: 0 },
  tab: (active) => ({ padding: "6px 16px", borderRadius: 8, border: "none", background: active ? "#111" : "transparent", color: active ? "#fff" : "#888", fontSize: 13, cursor: "pointer", transition: "all 0.15s" }),
  card: { background: "#fff", border: "1px solid #ebebeb", borderRadius: 12, padding: "16px 20px", marginBottom: 10 },
  input: { width: "100%", padding: "9px 13px", border: "1px solid #e0e0e0", borderRadius: 8, fontSize: 14, background: "#fff", outline: "none" },
  btn: (variant = "default") => ({
    padding: "8px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer", border: "none", transition: "all 0.15s",
    ...(variant === "primary" ? { background: "#111", color: "#fff" } :
       variant === "danger"  ? { background: "#fff", color: "#ef4444", border: "1px solid #fca5a5" } :
                               { background: "#fff", color: "#555", border: "1px solid #e0e0e0" }),
  }),
  label: { fontSize: 11, color: "#999", marginBottom: 4, display: "block" },
  stat: { background: "#f9f9f9", borderRadius: 8, padding: "8px 14px" },
};

/* ════════════════ APP ════════════════ */
export default function App() {
  const [tab, setTab] = useState("search");
  const [apiKey, setApiKey] = useState(() => LS.get("yik-yt-key") || "");
  const [keyOk, setKeyOk] = useState(() => !!(LS.get("yik-yt-key")));
  const [db, setDB] = useState(() => LS.get("yik-db") || { inf: [], camp: [] });

  const updateDB = useCallback((next) => { setDB(next); LS.set("yik-db", next); }, []);

  const applyKey = () => {
    if (apiKey.length > 10) { setKeyOk(true); LS.set("yik-yt-key", apiKey); }
  };

  const TABS = [
    { id: "search", label: "채널 검색" },
    { id: "db", label: `DB (${db.inf.length})` },
    { id: "camp", label: `캠페인 (${db.camp.length})` },
  ];

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logo}>Y</div>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>YIK Media — Influencer Hub</span>
        <nav style={{ display: "flex", gap: 4, marginLeft: 12 }}>
          {TABS.map((t) => (
            <button key={t.id} style={S.tab(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {!keyOk ? (
            <>
              <input
                placeholder="YouTube Data API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyKey()}
                style={{ ...S.input, width: 260, fontSize: 12, fontFamily: "monospace" }}
              />
              <button style={S.btn("primary")} onClick={applyKey}>적용</button>
            </>
          ) : (
            <span style={{ fontSize: 13, color: "#22c55e", display: "flex", alignItems: "center", gap: 8 }}>
              ✓ API 연결됨
              <button onClick={() => { setKeyOk(false); setApiKey(""); LS.set("yik-yt-key", ""); }}
                style={{ fontSize: 11, background: "none", border: "none", color: "#aaa", cursor: "pointer" }}>변경</button>
            </span>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px" }}>
        {!keyOk && tab === "search" && (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#1d4ed8" }}>
            YouTube Data API v3 키를 상단에 입력하면 실시간 채널 검색이 가능합니다.
            API 키는 <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" style={{ color: "#1d4ed8" }}>Google Cloud Console</a>에서 무료로 발급받을 수 있습니다.
          </div>
        )}
        {tab === "search" && <SearchTab apiKey={apiKey} keyOk={keyOk} db={db} updateDB={updateDB} />}
        {tab === "db"     && <DBTab db={db} updateDB={updateDB} />}
        {tab === "camp"   && <CampTab db={db} updateDB={updateDB} />}
      </div>
    </div>
  );
}

/* ════════════════ SEARCH TAB ════════════════ */
const SUB_RANGES = [
  { label: "전체", min: 0, max: Infinity },
  { label: "~10K", min: 0, max: 10_000 },
  { label: "10K~100K", min: 10_000, max: 100_000 },
  { label: "100K~1M", min: 100_000, max: 1_000_000 },
  { label: "1M+", min: 1_000_000, max: Infinity },
];

function SearchTab({ apiKey, keyOk, db, updateDB }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState("");
  const [insights, setInsights] = useState({});
  const [insightLoad, setInsightLoad] = useState({});
  const [nextPage, setNextPage] = useState(null);
  const [filterSubs, setFilterSubs] = useState(0);
  const [filterCountry, setFilterCountry] = useState("");
  const [sortBy, setSortBy] = useState("default");

  const doSearch = async (append = false, pageToken = "") => {
    if (!q.trim() || !keyOk) return;
    append ? setLoadingMore(true) : (setLoading(true), setErr(""), !append && setResults([]));
    try {
      const { ids, nextPageToken } = await ytSearch(q, apiKey, pageToken);
      if (!ids.length && !append) { setErr("검색 결과가 없습니다."); setLoading(false); return; }
      const stats = await ytChannelStats(ids, apiKey);
      setResults((p) => append ? [...p, ...stats] : stats);
      setNextPage(nextPageToken);
    } catch (e) { setErr(e.message); }
    append ? setLoadingMore(false) : setLoading(false);
  };

  const search = () => { setResults([]); setNextPage(null); doSearch(false, ""); };

  const getInsight = async (ch) => {
    setInsightLoad((p) => ({ ...p, [ch.channelId]: true }));
    const res = await askClaude(`YIK Media Inc. 인플루언서 분석 전문가로서 아래 유튜브 채널을 분석해주세요.

채널명: ${ch.title}
구독자: ${fmt(ch.subscribers)}
총 조회수: ${fmt(ch.views)}
업로드 영상: ${ch.videos}개
국가: ${ch.country || "미상"}
채널 설명: ${ch.description?.slice(0, 200) || "없음"}

다음 항목을 각 2~3줄로 작성하세요:
1. 채널 특성 요약
2. 예상 타깃 오디언스
3. 광고 적합성 평가
4. 섭외 시 주의사항`);
    setInsights((p) => ({ ...p, [ch.channelId]: res }));
    setInsightLoad((p) => ({ ...p, [ch.channelId]: false }));
  };

  const isAdded = (ch) => db.inf.find((x) => x.channelId === ch.channelId);
  const addToDB = (ch) => {
    if (isAdded(ch)) return;
    updateDB({ ...db, inf: [{ ...ch, id: uid(), platform: "YouTube", addedAt: new Date().toISOString() }, ...db.inf] });
  };

  const range = SUB_RANGES[filterSubs];
  const filtered = results
    .filter((ch) => {
      const s = parseInt(ch.subscribers || 0);
      if (s < range.min || s > range.max) return false;
      if (filterCountry && ch.country !== filterCountry) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "subs_desc") return parseInt(b.subscribers || 0) - parseInt(a.subscribers || 0);
      if (sortBy === "subs_asc")  return parseInt(a.subscribers || 0) - parseInt(b.subscribers || 0);
      if (sortBy === "views_desc") return parseInt(b.views || 0) - parseInt(a.views || 0);
      return 0;
    });

  const countries = [...new Set(results.map((r) => r.country).filter(Boolean))];

  return (
    <div>
      {/* Search bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="채널명, 키워드 검색 (예: Korean beauty, fitness vlog, 먹방, gaming...)"
          style={{ ...S.input, flex: 1, fontSize: 14 }} />
        <button style={S.btn("primary")} onClick={search} disabled={!keyOk || loading}>
          {loading ? "검색 중..." : "검색"}
        </button>
      </div>

      {/* Filters */}
      {results.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center", padding: "10px 14px", background: "#f9f9f9", borderRadius: 10, border: "1px solid #ebebeb" }}>
          <span style={{ fontSize: 11, color: "#bbb", fontWeight: 600 }}>필터</span>
          {/* Subscriber filter */}
          <div style={{ display: "flex", gap: 4 }}>
            {SUB_RANGES.map((r, i) => (
              <button key={r.label} onClick={() => setFilterSubs(i)}
                style={{ padding: "4px 10px", borderRadius: 20, border: "1px solid " + (filterSubs === i ? "#111" : "#e0e0e0"), background: filterSubs === i ? "#111" : "#fff", color: filterSubs === i ? "#fff" : "#888", fontSize: 11, cursor: "pointer" }}>
                {r.label}
              </button>
            ))}
          </div>
          {/* Country filter */}
          {countries.length > 0 && (
            <select value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)}
              style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #e0e0e0", background: "#fff", fontSize: 12, color: "#555", cursor: "pointer" }}>
              <option value="">전체 국가</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {/* Sort */}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #e0e0e0", background: "#fff", fontSize: 12, color: "#555", cursor: "pointer", marginLeft: "auto" }}>
            <option value="default">기본 순</option>
            <option value="subs_desc">구독자 많은 순</option>
            <option value="subs_asc">구독자 적은 순</option>
            <option value="views_desc">조회수 많은 순</option>
          </select>
          <span style={{ fontSize: 11, color: "#bbb" }}>{filtered.length}개</span>
        </div>
      )}

      {err && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 16 }}>⚠ {err}</div>}

      {/* Results */}
      {filtered.map((ch) => (
        <div key={ch.channelId} style={S.card}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            {ch.thumb && <img src={ch.thumb} alt="" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                <a href={ch.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 15, fontWeight: 600, color: "#111", textDecoration: "none" }}>{ch.title}</a>
                {ch.country && <span style={{ fontSize: 11, color: "#999", background: "#f5f5f5", padding: "2px 8px", borderRadius: 20 }}>{ch.country}</span>}
              </div>
              <p style={{ fontSize: 12, color: "#888", marginBottom: 12, lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {ch.description || "설명 없음"}
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[["구독자", fmt(ch.subscribers)], ["총 조회수", fmt(ch.views)], ["영상 수", parseInt(ch.videos || 0).toLocaleString() + "개"], ["예상 광고 단가", estimatePrice(ch.subscribers, ch.views)]].map(([l, v]) => (
                  <div key={l} style={S.stat}>
                    <div style={{ fontSize: 10, color: "#bbb", marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
              <button onClick={() => addToDB(ch)} style={S.btn(isAdded(ch) ? "default" : "primary")}>
                {isAdded(ch) ? "✓ DB 저장됨" : "+ DB 추가"}
              </button>
              <button onClick={() => !insightLoad[ch.channelId] && getInsight(ch)} style={S.btn()}>
                {insightLoad[ch.channelId] ? "분석 중..." : "AI 인사이트"}
              </button>
            </div>
          </div>
          {insights[ch.channelId] && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #f0f0f0" }}>
              <div style={{ fontSize: 11, color: "#bbb", marginBottom: 6, fontWeight: 600 }}>AI 인사이트</div>
              <pre style={{ fontSize: 12, color: "#555", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{insights[ch.channelId]}</pre>
            </div>
          )}
        </div>
      ))}

      {/* Load more */}
      {nextPage && !loading && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button style={{ ...S.btn(), padding: "10px 28px" }} onClick={() => doSearch(true, nextPage)} disabled={loadingMore}>
            {loadingMore ? "불러오는 중..." : "결과 더 보기"}
          </button>
        </div>
      )}

      {!loading && results.length === 0 && !err && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#ccc", fontSize: 13 }}>
          {keyOk ? "검색어를 입력하고 Enter를 누르세요." : "상단에 YouTube API 키를 먼저 입력하세요."}
        </div>
      )}
    </div>
  );
}

/* ════════════════ DB TAB ════════════════ */
function DBTab({ db, updateDB }) {
  const [q, setQ] = useState("");
  const [emails, setEmails] = useState({});
  const [emailLoad, setEmailLoad] = useState({});
  const [copied, setCopied] = useState("");

  const filtered = db.inf.filter((x) => !q || x.title?.toLowerCase().includes(q.toLowerCase()));

  const removeInf = (id) => {
    if (!confirm("삭제하시겠습니까?")) return;
    updateDB({ ...db, inf: db.inf.filter((x) => x.id !== id) });
  };

  const genEmail = async (inf) => {
    setEmailLoad((p) => ({ ...p, [inf.id]: true }));
    const res = await askClaude(`YIK Media Inc. 대표로서 아래 유튜버에게 보낼 첫 번째 협업 제안 이메일 초안을 작성하세요.

채널명: ${inf.title}
구독자: ${fmt(inf.subscribers)}
국가: ${inf.country || "미상"}
예상 광고 단가: ${estimatePrice(inf.subscribers, inf.views)}

조건:
- 톤: 정중하고 전문적이되 친근하게
- 자기소개(YIK Media Inc.) + 협업 제안 + 다음 스텝 포함
- 250자 내외로 간결하게
- 서명: YIK Media Inc. 드림`);
    setEmails((p) => ({ ...p, [inf.id]: res }));
    setEmailLoad((p) => ({ ...p, [inf.id]: false }));
  };

  const copy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(""), 1500);
  };

  const exportXLSX = () => {
    const rows = filtered.map((x) => ({
      채널명: x.title, 구독자: x.subscribers, 총조회수: x.views,
      영상수: x.videos, 국가: x.country, URL: x.url,
      예상단가: estimatePrice(x.subscribers, x.views),
      추가일: x.addedAt?.slice(0, 10),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Influencers");
    XLSX.writeFile(wb, `YIK_Influencers_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="채널명 검색..."
          style={{ ...S.input, maxWidth: 280 }} />
        <span style={{ fontSize: 12, color: "#bbb" }}>{filtered.length}명</span>
        <button style={{ ...S.btn(), marginLeft: "auto" }} onClick={exportXLSX}>엑셀 내보내기</button>
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "#ccc", fontSize: 13 }}>
          {db.inf.length === 0 ? "채널 검색 탭에서 채널을 DB에 추가하세요." : "검색 결과 없음"}
        </div>
      )}

      {filtered.map((inf) => (
        <div key={inf.id} style={S.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {inf.thumb && <img src={inf.thumb} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <a href={inf.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 14, fontWeight: 600, color: "#111", textDecoration: "none" }}>{inf.title}</a>
                {inf.country && <span style={{ fontSize: 11, color: "#bbb" }}>{inf.country}</span>}
              </div>
              <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
                <span style={{ fontSize: 12, color: "#888" }}>구독자 {fmt(inf.subscribers)}</span>
                <span style={{ fontSize: 12, color: "#888" }}>조회수 {fmt(inf.views)}</span>
                <span style={{ fontSize: 12, color: "#555", fontWeight: 600 }}>{estimatePrice(inf.subscribers, inf.views)}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => genEmail(inf)} style={S.btn()}>
                {emailLoad[inf.id] ? "작성 중..." : "이메일 초안"}
              </button>
              <button onClick={() => removeInf(inf.id)} style={S.btn("danger")}>삭제</button>
            </div>
          </div>
          {emails[inf.id] && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "#bbb", fontWeight: 600 }}>이메일 초안</span>
                <button onClick={() => copy(inf.id, emails[inf.id])} style={S.btn()}>
                  {copied === inf.id ? "✓ 복사됨" : "복사"}
                </button>
              </div>
              <pre style={{ fontSize: 12, color: "#555", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0, background: "#fafafa", padding: "12px 14px", borderRadius: 8, fontFamily: "inherit" }}>
                {emails[inf.id]}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ════════════════ CAMPAIGN TAB ════════════════ */
const emptyCamp = () => ({ id: uid(), client: "", name: "", goal: "", budget: "", status: "진행중", inf: [], infDetail: {}, createdAt: new Date().toISOString() });

function CampTab({ db, updateDB }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyCamp());
  const [open, setOpen] = useState(null);
  const [addQ, setAddQ] = useState("");
  const [proposals, setProposals] = useState({});
  const [propLoad, setPropLoad] = useState({});
  const [copied, setCopied] = useState("");

  const saveCamp = () => {
    if (!form.client || !form.name) return;
    const existing = db.camp.find((c) => c.id === form.id);
    const next = existing
      ? { ...db, camp: db.camp.map((c) => c.id === form.id ? form : c) }
      : { ...db, camp: [form, ...db.camp] };
    updateDB(next);
    setModal(false); setForm(emptyCamp());
  };

  const delCamp = (id) => {
    if (!confirm("캠페인을 삭제하시겠습니까?")) return;
    updateDB({ ...db, camp: db.camp.filter((c) => c.id !== id) });
    if (open === id) setOpen(null);
  };

  const toggleInf = (camp, infId) => {
    const inf = camp.inf.includes(infId) ? camp.inf.filter((x) => x !== infId) : [...camp.inf, infId];
    updateDB({ ...db, camp: db.camp.map((c) => c.id === camp.id ? { ...c, inf } : c) });
  };

  const updStatus = (camp, infId, status) => {
    const infDetail = { ...camp.infDetail, [infId]: { ...(camp.infDetail?.[infId] || {}), status } };
    updateDB({ ...db, camp: db.camp.map((c) => c.id === camp.id ? { ...c, infDetail } : c) });
  };

  const genProposal = async (camp) => {
    setPropLoad((p) => ({ ...p, [camp.id]: true }));
    const infList = camp.inf.map((id) => {
      const inf = db.inf.find((x) => x.id === id);
      return inf ? `- ${inf.title} (구독자 ${fmt(inf.subscribers)}, 예상단가 ${estimatePrice(inf.subscribers, inf.views)})` : null;
    }).filter(Boolean).join("\n");

    const res = await askClaude(`YIK Media Inc. 내부 캠페인 제안서를 작성해주세요.

클라이언트: ${camp.client}
캠페인명: ${camp.name}
목표: ${camp.goal || "미정"}
예산: ${camp.budget || "미정"}

배정 인플루언서:
${infList || "미배정"}

포함 내용:
1. 캠페인 개요 (2~3문장)
2. 인플루언서 믹스 전략
3. 콘텐츠 포맷 제안
4. 기대 KPI
5. 예산 배분 제안
6. 주의사항

실무용으로 간결하게, 한국어로 작성.`);
    setProposals((p) => ({ ...p, [camp.id]: res }));
    setPropLoad((p) => ({ ...p, [camp.id]: false }));
  };

  const exportCampXLSX = (camp) => {
    const rows = camp.inf.map((id) => {
      const inf = db.inf.find((x) => x.id === id) || {};
      const detail = camp.infDetail?.[id] || {};
      return { 채널명: inf.title, 구독자: inf.subscribers, 국가: inf.country, URL: inf.url, 상태: detail.status || "미응답", 예상단가: estimatePrice(inf.subscribers, inf.views) };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Campaign");
    XLSX.writeFile(wb, `YIK_${camp.client}_${camp.name}.xlsx`);
  };

  const copy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(""), 1500);
  };

  const filtInfl = db.inf.filter((x) => !addQ || x.title?.toLowerCase().includes(addQ.toLowerCase()));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
        <button style={S.btn("primary")} onClick={() => { setForm(emptyCamp()); setModal(true); }}>+ 새 캠페인</button>
      </div>

      {db.camp.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "#ccc", fontSize: 13 }}>캠페인을 만들어보세요.</div>
      )}

      {db.camp.map((camp) => {
        const isOpen = open === camp.id;
        const statusCounts = STATUSES.reduce((a, s) => {
          a[s] = (camp.infDetail ? Object.values(camp.infDetail).filter((d) => d.status === s).length : 0);
          return a;
        }, {});

        return (
          <div key={camp.id} style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "14px 20px", cursor: "pointer", gap: 12 }}
              onClick={() => setOpen(isOpen ? null : camp.id)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#bbb", marginBottom: 2 }}>{camp.client}</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#111" }}>{camp.name}</div>
              </div>
              {camp.budget && <span style={{ fontSize: 12, color: "#888" }}>{camp.budget}</span>}
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: camp.status === "완료" ? "#dcfce7" : "#fef9c3", color: camp.status === "완료" ? "#15803d" : "#854d0e" }}>{camp.status}</span>
              <span style={{ fontSize: 12, color: "#bbb" }}>인플루언서 {camp.inf.length}명</span>
              <button onClick={(e) => { e.stopPropagation(); delCamp(camp.id); }}
                style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: 12 }}>삭제</button>
              <span style={{ fontSize: 12, color: "#ccc" }}>{isOpen ? "▲" : "▼"}</span>
            </div>

            {isOpen && (
              <div style={{ borderTop: "1px solid #f0f0f0", padding: "16px 20px" }}>
                {/* Status summary */}
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  {STATUSES.map((s) => (
                    <div key={s} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: SC[s] + "18", color: SC[s], border: `1px solid ${SC[s]}44` }}>
                      {s} {camp.infDetail ? Object.values(camp.infDetail).filter((d) => d.status === s).length : 0}
                    </div>
                  ))}
                </div>

                {/* Assigned influencers */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "#bbb", fontWeight: 600, marginBottom: 8 }}>배정된 인플루언서</div>
                  {camp.inf.length === 0 && <div style={{ fontSize: 12, color: "#ccc" }}>아직 없습니다. 아래에서 추가하세요.</div>}
                  {camp.inf.map((id) => {
                    const inf = db.inf.find((x) => x.id === id);
                    if (!inf) return null;
                    const detail = camp.infDetail?.[id] || {};
                    return (
                      <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
                        <span style={{ flex: 1, fontSize: 13, color: "#111" }}>{inf.title}</span>
                        <span style={{ fontSize: 12, color: "#bbb" }}>{fmt(inf.subscribers)}</span>
                        <span style={{ fontSize: 12, color: "#888" }}>{estimatePrice(inf.subscribers, inf.views)}</span>
                        <select value={detail.status || "미응답"} onChange={(e) => updStatus(camp, id, e.target.value)}
                          style={{ fontSize: 11, padding: "4px 8px", borderRadius: 8, border: `1px solid ${SC[detail.status || "미응답"]}`, background: SC[detail.status || "미응답"] + "18", color: SC[detail.status || "미응답"], cursor: "pointer" }}>
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <button onClick={() => toggleInf(camp, id)} style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
                      </div>
                    );
                  })}
                </div>

                {/* Add from DB */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "#bbb", fontWeight: 600, marginBottom: 8 }}>DB에서 추가</div>
                  <input value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder="채널 검색..."
                    style={{ ...S.input, marginBottom: 8 }} />
                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                    {filtInfl.map((inf) => {
                      const added = camp.inf.includes(inf.id);
                      return (
                        <div key={inf.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f5f5f5" }}>
                          <div>
                            <span style={{ fontSize: 13, color: "#111" }}>{inf.title}</span>
                            <span style={{ fontSize: 11, color: "#bbb", marginLeft: 8 }}>{fmt(inf.subscribers)}</span>
                          </div>
                          <button onClick={() => toggleInf(camp, inf.id)}
                            style={{ ...S.btn(added ? "default" : "primary"), padding: "4px 12px", fontSize: 11 }}>
                            {added ? "배정됨" : "추가"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button style={S.btn()} onClick={() => genProposal(camp)}>
                    {propLoad[camp.id] ? "제안서 작성 중..." : "AI 제안서 생성"}
                  </button>
                  <button style={S.btn()} onClick={() => exportCampXLSX(camp)}>엑셀 내보내기</button>
                  {proposals[camp.id] && (
                    <button style={S.btn()} onClick={() => copy(camp.id, proposals[camp.id])}>
                      {copied === camp.id ? "✓ 복사됨" : "제안서 복사"}
                    </button>
                  )}
                </div>

                {proposals[camp.id] && (
                  <pre style={{ fontSize: 12, color: "#555", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0, background: "#fafafa", padding: "14px 16px", borderRadius: 10, fontFamily: "inherit" }}>
                    {proposals[camp.id]}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Modal */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#111", marginBottom: 20 }}>새 캠페인</div>
            {[["클라이언트명 *", "client", "Laneige KR"], ["캠페인명 *", "name", "신제품 론칭 캠페인"], ["목표", "goal", "신제품 인지도 확산"], ["예산", "budget", "$10,000"]].map(([label, key, ph]) => (
              <div key={key} style={{ marginBottom: 14 }}>
                <label style={S.label}>{label}</label>
                <input value={form[key]} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={ph} style={S.input} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <button style={S.btn()} onClick={() => setModal(false)}>취소</button>
              <button style={S.btn("primary")} onClick={saveCamp} disabled={!form.client || !form.name}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
