import { useState, useCallback } from "react";
import * as XLSX from "xlsx";

const uid = () => Math.random().toString(36).slice(2, 8);
const fmt = (n) => {
  const x = parseInt(String(n || "").replace(/[^0-9]/g, ""));
  if (!x || isNaN(x)) return "-";
  if (x >= 1_000_000) return (x / 1_000_000).toFixed(1) + "M";
  if (x >= 1_000) return Math.round(x / 1_000) + "K";
  return String(x);
};
const estimatePrice = (platform, followers) => {
  const f = parseInt(String(followers || "").replace(/[^0-9]/g, "")) || 0;
  if (!f) return "-";
  const rate = { YouTube: 0.003, Instagram: 0.002, TikTok: 0.001 }[platform] || 0.002;
  const lo = Math.round((f * rate * 0.7) / 100) * 100;
  const hi = Math.round((f * rate * 1.5) / 100) * 100;
  return `$${lo.toLocaleString()} ~ $${hi.toLocaleString()}`;
};

const LS = {
  get: (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

async function ytSearch(q, apiKey, pageToken = "") {
  let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=20&q=${encodeURIComponent(q)}&key=${apiKey}`;
  if (pageToken) url += `&pageToken=${pageToken}`;
  const r = await fetch(url); const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "YouTube API 오류");
  return { ids: (d.items || []).map(i => i.snippet.channelId), nextPageToken: d.nextPageToken || null };
}
async function ytStats(ids, apiKey) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${ids.join(",")}&key=${apiKey}`;
  const r = await fetch(url); const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "YouTube API 오류");
  return (d.items || []).map(i => ({
    id: uid(), platform: "YouTube", channelId: i.id,
    name: i.snippet.title, handle: `@${i.snippet.customUrl || i.id}`,
    followers: i.statistics.subscriberCount, views: i.statistics.viewCount,
    posts: i.statistics.videoCount, country: i.snippet.country || "",
    thumb: i.snippet.thumbnails?.medium?.url, description: i.snippet.description,
    url: `https://www.youtube.com/channel/${i.id}`, addedAt: new Date().toISOString(),
    status: "미응답", fee: "", notes: "",
  }));
}
async function igLookup(handle, rapidKey) {
  const username = handle.replace("@", "").trim();
  const r = await fetch(`https://instagram-scraper-api2.p.rapidapi.com/v1/info?username_or_id_or_url=${username}`, {
    headers: { "x-rapidapi-key": rapidKey, "x-rapidapi-host": "instagram-scraper-api2.p.rapidapi.com" }
  });
  const d = await r.json();
  if (!r.ok || !d.data) throw new Error(d.message || "Instagram 조회 실패");
  const u = d.data;
  return {
    id: uid(), platform: "Instagram", channelId: u.id,
    name: u.full_name || u.username, handle: `@${u.username}`,
    followers: u.follower_count, views: "-", posts: u.media_count, country: "",
    thumb: u.profile_pic_url_hd || u.profile_pic_url, description: u.biography,
    url: `https://instagram.com/${u.username}`, addedAt: new Date().toISOString(),
    status: "미응답", fee: "", notes: "",
  };
}
async function ttLookup(handle, rapidKey) {
  const username = handle.replace("@", "").trim();
  const r = await fetch(`https://tiktok-scraper7.p.rapidapi.com/user/info?uniqueId=${username}`, {
    headers: { "x-rapidapi-key": rapidKey, "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com" }
  });
  const d = await r.json();
  if (!r.ok || d.code !== 0) throw new Error(d.msg || "TikTok 조회 실패");
  const u = d.data?.userInfo?.user; const s = d.data?.userInfo?.stats;
  return {
    id: uid(), platform: "TikTok", channelId: u?.id,
    name: u?.nickname, handle: `@${u?.uniqueId}`,
    followers: s?.followerCount, views: s?.videoCount, posts: s?.videoCount, country: "",
    thumb: u?.avatarMedium, description: u?.signature,
    url: `https://tiktok.com/@${u?.uniqueId}`, addedAt: new Date().toISOString(),
    status: "미응답", fee: "", notes: "",
  };
}
async function askClaude(prompt) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    });
    const d = await r.json();
    return d.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";
  } catch (e) { return "AI 오류: " + e.message; }
}

const PLATFORMS = ["YouTube", "Instagram", "TikTok"];
const REGIONS = ["한국", "미국", "인도네시아", "일본", "베트남", "태국", "싱가포르", "유럽", "글로벌", "기타"];
const SUB_RANGES = [
  { label: "전체", min: 0, max: Infinity },
  { label: "~10K", min: 0, max: 10_000 },
  { label: "10K~100K", min: 10_000, max: 100_000 },
  { label: "100K~500K", min: 100_000, max: 500_000 },
  { label: "500K~1M", min: 500_000, max: 1_000_000 },
  { label: "1M+", min: 1_000_000, max: Infinity },
];
const STATUS_COLORS = { 미응답: "#999", 협의중: "#F59E0B", 수락: "#22C55E", 거절: "#EF4444", 완료: "#818CF8" };
const PLT_COLORS = { YouTube: "#FF0000", Instagram: "#E1306C", TikTok: "#00c8c8" };
const TABS = ["📋 브리프", "▶ YouTube", "📸 Instagram / TikTok", "📊 리스트 & 엑셀"];

const S = {
  page: { minHeight: "100vh", background: "#f7f7f7", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  header: { background: "#fff", borderBottom: "1px solid #e8e8e8", padding: "11px 24px", display: "flex", alignItems: "center", gap: 14, position: "sticky", top: 0, zIndex: 100 },
  logo: { width: 28, height: 28, background: "#111", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 },
  tab: (a) => ({ padding: "6px 14px", borderRadius: 8, border: "none", background: a ? "#111" : "transparent", color: a ? "#fff" : "#888", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }),
  card: { background: "#fff", border: "1px solid #ebebeb", borderRadius: 12, padding: "18px 20px", marginBottom: 10 },
  input: { width: "100%", padding: "8px 12px", border: "1px solid #e0e0e0", borderRadius: 8, fontSize: 13, background: "#fff", outline: "none", fontFamily: "inherit" },
  btn: (v = "d") => ({
    padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer", border: "1px solid transparent", fontFamily: "inherit", whiteSpace: "nowrap",
    ...(v === "p" ? { background: "#111", color: "#fff" } :
       v === "g" ? { background: "#16a34a", color: "#fff" } :
       v === "o" ? { background: "#fff", color: "#111", borderColor: "#ddd" } :
                   { background: "#fff", color: "#666", borderColor: "#e0e0e0" }),
  }),
  label: { fontSize: 11, color: "#999", marginBottom: 4, display: "block", fontWeight: 600, letterSpacing: "0.04em" },
  chip: (a, color) => ({
    padding: "5px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12, border: "1px solid",
    borderColor: a ? (color || "#111") : "#e8e8e8",
    background: a ? ((color || "#111") + (color ? "18" : "")) : "#fff",
    color: a ? (color || "#fff") : "#888",
    ...(a && !color ? { background: "#111", color: "#fff" } : {}),
  }),
};

export default function App() {
  const [tab, setTab] = useState(0);
  const [keys, setKeys] = useState(() => LS.get("yik-keys") || { yt: "", rapid: "" });
  const [showKeys, setShowKeys] = useState(false);
  const [list, setList] = useState(() => LS.get("yik-list") || []);
  const [brief, setBrief] = useState(() => LS.get("yik-brief") || { client: "", category: "", platforms: [], regions: [], subRange: 0, tone: "", goal: "" });

  const saveKeys = (k) => { setKeys(k); LS.set("yik-keys", k); };
  const updateList = (l) => { setList(l); LS.set("yik-list", l); };
  const addToList = useCallback((inf) => {
    setList(p => {
      if (p.find(x => x.handle === inf.handle && x.platform === inf.platform)) return p;
      const n = [inf, ...p]; LS.set("yik-list", n); return n;
    });
  }, []);
  const saveBrief = (b) => { setBrief(b); LS.set("yik-brief", b); };
  const ytOk = keys.yt?.length > 10;
  const rapidOk = keys.rapid?.length > 10;

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.logo}>Y</div>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>YIK Media — Influencer Hub</span>
        <nav style={{ display: "flex", gap: 2 }}>
          {TABS.map((t, i) => <button key={i} style={S.tab(tab === i)} onClick={() => setTab(i)}>{t}</button>)}
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: ytOk ? "#16a34a" : "#ccc" }}>YT {ytOk ? "✓" : "✗"}</span>
          <span style={{ fontSize: 11, color: rapidOk ? "#16a34a" : "#ccc" }}>Rapid {rapidOk ? "✓" : "✗"}</span>
          <button style={S.btn("o")} onClick={() => setShowKeys(p => !p)}>API 설정</button>
          <span style={{ fontSize: 12, color: "#bbb", background: "#f5f5f5", padding: "4px 10px", borderRadius: 20 }}>리스트 {list.length}명</span>
        </div>
      </div>

      {showKeys && (
        <div style={{ background: "#fff", borderBottom: "1px solid #e8e8e8", padding: "14px 24px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={S.label}>YouTube Data API v3 Key</label>
            <input value={keys.yt} onChange={e => saveKeys({ ...keys, yt: e.target.value })} placeholder="AIza..." style={{ ...S.input, fontFamily: "monospace", fontSize: 12 }} />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={S.label}>RapidAPI Key (Instagram + TikTok)</label>
            <input value={keys.rapid} onChange={e => saveKeys({ ...keys, rapid: e.target.value })} placeholder="rapidapi.com에서 발급" style={{ ...S.input, fontFamily: "monospace", fontSize: 12 }} />
          </div>
          <button style={S.btn("p")} onClick={() => setShowKeys(false)}>저장</button>
        </div>
      )}

      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "24px 20px" }}>
        {tab === 0 && <BriefTab brief={brief} saveBrief={saveBrief} list={list} />}
        {tab === 1 && <YouTubeTab apiKey={keys.yt} ytOk={ytOk} addToList={addToList} list={list} brief={brief} />}
        {tab === 2 && <SocialTab rapidKey={keys.rapid} rapidOk={rapidOk} addToList={addToList} list={list} />}
        {tab === 3 && <ListTab list={list} updateList={updateList} brief={brief} />}
      </div>
    </div>
  );
}

function BriefTab({ brief, saveBrief, list }) {
  const [aiOut, setAiOut] = useState(""); const [aiLoad, setAiLoad] = useState(false); const [copied, setCopied] = useState(false);
  const upd = (k, v) => saveBrief({ ...brief, [k]: v });
  const toggleArr = (k, v) => { const a = brief[k] || []; saveBrief({ ...brief, [k]: a.includes(v) ? a.filter(x => x !== v) : [...a, v] }); };

  const gen = async () => {
    setAiLoad(true); setAiOut("");
    const res = await askClaude(`YIK Media Inc. 인플루언서 리서치 전문가. 아래 브리프 기반으로 실무 리서치 가이드를 작성하세요.

클라이언트: ${brief.client || "미입력"} | 카테고리: ${brief.category || "미입력"}
플랫폼: ${(brief.platforms || []).join(", ") || "미입력"} | 지역: ${(brief.regions || []).join(", ") || "미입력"}
구독자 규모: ${SUB_RANGES[brief.subRange || 0]?.label} | 목표: ${brief.goal || "미입력"} | 톤앤매너: ${brief.tone || "미입력"}

1. 이 브리프에 맞는 인플루언서 유형 3가지 정의
2. YouTube 검색 추천 키워드 6개 (한/영 혼합)
3. Instagram/TikTok 탐색 추천 핸들 5개 (실제 검색 가능한 @username 형태)
4. 지역별 섭외 전략 및 주의사항
5. 예상 단가 범위 및 협상 포인트

바로 실무에 쓸 수 있게 구체적으로 작성.`);
    setAiOut(res); setAiLoad(false);
  };

  return (
    <div>
      <div style={S.card}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>클라이언트 브리프</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
          <Fld label="클라이언트명"><input value={brief.client} onChange={e => upd("client", e.target.value)} placeholder="Laneige, Samsung, Tokopedia..." style={S.input} /></Fld>
          <Fld label="카테고리 / 업종"><input value={brief.category} onChange={e => upd("category", e.target.value)} placeholder="뷰티, 패션, 테크, 푸드, 여행..." style={S.input} /></Fld>
        </div>
        <Fld label="타깃 플랫폼">
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {PLATFORMS.map(p => <button key={p} style={S.chip((brief.platforms || []).includes(p), PLT_COLORS[p])} onClick={() => toggleArr("platforms", p)}>{p}</button>)}
          </div>
        </Fld>
        <Fld label="타깃 지역 (복수 선택)">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            {REGIONS.map(r => <button key={r} style={S.chip((brief.regions || []).includes(r))} onClick={() => toggleArr("regions", r)}>{r}</button>)}
          </div>
        </Fld>
        <Fld label="구독자 / 팔로워 규모">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            {SUB_RANGES.map((r, i) => <button key={r.label} style={S.chip(brief.subRange === i)} onClick={() => upd("subRange", i)}>{r.label}</button>)}
          </div>
        </Fld>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
          <Fld label="캠페인 목표"><input value={brief.goal} onChange={e => upd("goal", e.target.value)} placeholder="신제품 인지도, 앱 다운로드, 매출 전환..." style={S.input} /></Fld>
          <Fld label="선호 톤앤매너"><input value={brief.tone} onChange={e => upd("tone", e.target.value)} placeholder="럭셔리, MZ 트렌디, 신뢰/전문가..." style={S.input} /></Fld>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
          <button style={S.btn("p")} onClick={gen} disabled={aiLoad}>{aiLoad ? "AI 분석 중..." : "AI 리서치 가이드 생성"}</button>
          <span style={{ fontSize: 12, color: "#bbb" }}>현재 리스트 {list.length}명</span>
        </div>
      </div>
      {aiOut && (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>AI 리서치 가이드</div>
            <button style={S.btn("o")} onClick={() => { navigator.clipboard.writeText(aiOut); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "✓ 복사됨" : "복사"}</button>
          </div>
          <pre style={{ fontSize: 13, color: "#444", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{aiOut}</pre>
        </div>
      )}
    </div>
  );
}

function YouTubeTab({ apiKey, ytOk, addToList, list, brief }) {
  const [q, setQ] = useState(""); const [results, setResults] = useState([]); const [loading, setLoading] = useState(false);
  const [moreLoad, setMoreLoad] = useState(false); const [nextPage, setNextPage] = useState(null); const [err, setErr] = useState("");
  const [fSub, setFSub] = useState(0); const [fCountry, setFCountry] = useState(""); const [sort, setSort] = useState("d");
  const [insights, setInsights] = useState({}); const [insLoad, setInsLoad] = useState({});

  const doSearch = async (append = false, token = "") => {
    if (!q.trim() || !ytOk) return;
    if (!append) { setLoading(true); setErr(""); setResults([]); } else setMoreLoad(true);
    try {
      const { ids, nextPageToken } = await ytSearch(q, apiKey, token);
      const stats = await ytStats(ids, apiKey);
      setResults(p => append ? [...p, ...stats] : stats);
      setNextPage(nextPageToken);
    } catch (e) { setErr(e.message); }
    append ? setMoreLoad(false) : setLoading(false);
  };

  const getInsight = async (ch) => {
    setInsLoad(p => ({ ...p, [ch.channelId]: true }));
    const res = await askClaude(`YIK Media 브리프 적합도 평가. 브리프: ${brief.client}, ${brief.category}, 목표 ${brief.goal}, 지역 ${(brief.regions||[]).join(",")}
채널: ${ch.name} | 구독자: ${fmt(ch.followers)} | 국가: ${ch.country || "미상"}
설명: ${ch.description?.slice(0, 100) || "없음"}
→ 적합도 (상/중/하) + 이유 2줄 + 섭외 포인트 1줄. 총 4줄 이내.`);
    setInsights(p => ({ ...p, [ch.channelId]: res }));
    setInsLoad(p => ({ ...p, [ch.channelId]: false }));
  };

  const range = SUB_RANGES[fSub];
  const filtered = results.filter(ch => {
    const s = parseInt(ch.followers || 0);
    return s >= range.min && s <= range.max && (!fCountry || ch.country === fCountry);
  }).sort((a, b) => sort === "sd" ? parseInt(b.followers || 0) - parseInt(a.followers || 0) : sort === "sa" ? parseInt(a.followers || 0) - parseInt(b.followers || 0) : 0);

  const countries = [...new Set(results.map(r => r.country).filter(Boolean))];
  const isAdded = ch => list.find(x => x.handle === ch.handle && x.platform === "YouTube");

  return (
    <div>
      {!ytOk && <Notice c="info">API 설정에서 YouTube API 키를 입력하세요.</Notice>}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()}
          placeholder="키워드 검색 (예: Korean beauty, Indonesia fitness, 먹방, K-pop vlog...)" style={{ ...S.input, flex: 1 }} />
        <button style={S.btn("p")} onClick={() => { setResults([]); doSearch(); }} disabled={!ytOk || loading}>{loading ? "검색 중..." : "검색"}</button>
      </div>
      {results.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 14px", background: "#f9f9f9", borderRadius: 10, border: "1px solid #ebebeb", marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: "#bbb", fontWeight: 700 }}>필터</span>
          {SUB_RANGES.map((r, i) => <button key={r.label} style={{ ...S.chip(fSub === i), fontSize: 11 }} onClick={() => setFSub(i)}>{r.label}</button>)}
          {countries.length > 0 && <select value={fCountry} onChange={e => setFCountry(e.target.value)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 12 }}><option value="">전체 국가</option>{countries.map(c => <option key={c} value={c}>{c}</option>)}</select>}
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 12, marginLeft: "auto" }}>
            <option value="d">기본 순</option><option value="sd">구독자 많은 순</option><option value="sa">구독자 적은 순</option>
          </select>
          <span style={{ fontSize: 12, color: "#bbb" }}>{filtered.length}개</span>
        </div>
      )}
      {err && <Notice c="err">{err}</Notice>}
      {filtered.map(ch => (
        <div key={ch.channelId} style={S.card}>
          <div style={{ display: "flex", gap: 12 }}>
            {ch.thumb && <img src={ch.thumb} alt="" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                <a href={ch.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, fontWeight: 700, color: "#111", textDecoration: "none" }}>{ch.name}</a>
                <Pbadge p="YouTube" />
                {ch.country && <span style={{ fontSize: 11, color: "#999", background: "#f5f5f5", padding: "2px 8px", borderRadius: 20 }}>{ch.country}</span>}
              </div>
              <p style={{ fontSize: 12, color: "#888", marginBottom: 10, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ch.description || "설명 없음"}</p>
              <Stats items={[["구독자", fmt(ch.followers)], ["총 조회수", fmt(ch.views)], ["영상", ch.posts ? parseInt(ch.posts).toLocaleString() + "개" : "-"], ["예상 단가", estimatePrice("YouTube", ch.followers)]]} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
              <button style={S.btn(isAdded(ch) ? "o" : "p")} onClick={() => !isAdded(ch) && addToList(ch)}>{isAdded(ch) ? "✓ 추가됨" : "+ 리스트 추가"}</button>
              <button style={S.btn()} onClick={() => !insLoad[ch.channelId] && getInsight(ch)}>{insLoad[ch.channelId] ? "분석 중..." : "적합도 분석"}</button>
            </div>
          </div>
          {insights[ch.channelId] && <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0f0f0" }}><pre style={{ fontSize: 12, color: "#555", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", background: "#fafafa", padding: "10px 14px", borderRadius: 8 }}>{insights[ch.channelId]}</pre></div>}
        </div>
      ))}
      {nextPage && <div style={{ textAlign: "center", marginTop: 12 }}><button style={{ ...S.btn(), padding: "10px 28px" }} onClick={() => doSearch(true, nextPage)} disabled={moreLoad}>{moreLoad ? "불러오는 중..." : "결과 더 보기"}</button></div>}
      {!loading && results.length === 0 && !err && <Empty>{ytOk ? "키워드 입력 후 검색하세요." : "API 키를 먼저 입력하세요."}</Empty>}
    </div>
  );
}

function SocialTab({ rapidKey, rapidOk, addToList, list }) {
  const [platform, setPlatform] = useState("Instagram"); const [handle, setHandle] = useState(""); const [bulkText, setBulkText] = useState("");
  const [results, setResults] = useState([]); const [loading, setLoading] = useState(false); const [err, setErr] = useState(""); const [mode, setMode] = useState("single");

  const lookup = h => (platform === "Instagram" ? igLookup : ttLookup)(h, rapidKey);

  const searchSingle = async () => {
    if (!handle.trim() || !rapidOk) return;
    setLoading(true); setErr("");
    try { setResults([await lookup(handle)]); } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const searchBulk = async () => {
    const handles = bulkText.split(/[\n,]+/).map(h => h.trim()).filter(Boolean);
    if (!handles.length || !rapidOk) return;
    setLoading(true); setErr(""); setResults([]);
    const found = [];
    for (const h of handles) {
      try { found.push(await lookup(h)); } catch (e) { console.warn(h, e.message); }
      setResults([...found]);
      await new Promise(r => setTimeout(r, 500));
    }
    setLoading(false);
  };

  const isAdded = r => list.find(x => x.handle === r.handle && x.platform === r.platform);

  return (
    <div>
      {!rapidOk && (
        <Notice c="warn">
          Instagram/TikTok 조회에는 RapidAPI 키가 필요합니다.<br />
          1. <a href="https://rapidapi.com" target="_blank" rel="noopener noreferrer">rapidapi.com</a> 무료 가입<br />
          2. <b>instagram-scraper-api2</b> 검색 → Basic(무료) 구독<br />
          3. <b>tiktok-scraper7</b> 검색 → Basic(무료) 구독<br />
          4. 우측 상단 API 설정에 키 입력
        </Notice>
      )}
      <div style={S.card}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {["Instagram", "TikTok"].map(p => <button key={p} style={{ ...S.chip(platform === p, PLT_COLORS[p]), fontSize: 14, padding: "7px 18px" }} onClick={() => setPlatform(p)}>{p}</button>)}
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button style={S.chip(mode === "single")} onClick={() => setMode("single")}>단건</button>
            <button style={S.chip(mode === "bulk")} onClick={() => setMode("bulk")}>대량</button>
          </div>
        </div>
        {mode === "single" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input value={handle} onChange={e => setHandle(e.target.value)} onKeyDown={e => e.key === "Enter" && searchSingle()} placeholder="@username" style={{ ...S.input, flex: 1 }} />
            <button style={S.btn("p")} onClick={searchSingle} disabled={!rapidOk || loading}>{loading ? "조회 중..." : "조회"}</button>
          </div>
        ) : (
          <div>
            <label style={S.label}>핸들 목록 (줄바꿈으로 구분, 20개 이하 권장)</label>
            <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder={"@glossier\n@fashionnova\n@hudabeauty"} style={{ ...S.input, height: 120, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
              <button style={S.btn("p")} onClick={searchBulk} disabled={!rapidOk || loading}>{loading ? `조회 중 (${results.length}개 완료)...` : "일괄 조회"}</button>
              {loading && <span style={{ fontSize: 12, color: "#bbb" }}>순차 처리 중입니다...</span>}
            </div>
          </div>
        )}
        {err && <div style={{ color: "#ef4444", fontSize: 13, marginTop: 10 }}>⚠ {err}</div>}
      </div>
      {results.map((inf, i) => (
        <div key={i} style={S.card}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {inf.thumb && <img src={inf.thumb} alt="" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />}
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                <a href={inf.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, fontWeight: 700, color: "#111", textDecoration: "none" }}>{inf.name}</a>
                <Pbadge p={inf.platform} />
                <span style={{ fontSize: 12, color: "#bbb" }}>{inf.handle}</span>
              </div>
              {inf.description && <p style={{ fontSize: 12, color: "#888", marginBottom: 8, lineHeight: 1.5 }}>{inf.description?.slice(0, 100)}</p>}
              <Stats items={[["팔로워", fmt(inf.followers)], ["게시물", inf.posts ? parseInt(inf.posts).toLocaleString() + "개" : "-"], ["예상 단가", estimatePrice(inf.platform, inf.followers)]]} />
            </div>
            <button style={S.btn(isAdded(inf) ? "o" : "p")} onClick={() => !isAdded(inf) && addToList(inf)}>{isAdded(inf) ? "✓ 추가됨" : "+ 리스트 추가"}</button>
          </div>
        </div>
      ))}
      {!loading && results.length === 0 && <Empty>핸들을 입력하고 조회하세요.<br />브리프 탭 AI 가이드의 추천 핸들을 바로 붙여넣으세요.</Empty>}
    </div>
  );
}

function ListTab({ list, updateList, brief }) {
  const [fPlt, setFPlt] = useState("전체"); const [fSub, setFSub] = useState(0); const [fStat, setFStat] = useState("전체"); const [q, setQ] = useState("");
  const [aiOut, setAiOut] = useState(""); const [aiLoad, setAiLoad] = useState(false); const [copied, setCopied] = useState(false);

  const updInf = (id, f, v) => updateList(list.map(x => x.id === id ? { ...x, [f]: v } : x));
  const delInf = (id) => { if (confirm("삭제?")) updateList(list.filter(x => x.id !== id)); };

  const range = SUB_RANGES[fSub];
  const filtered = list.filter(x => {
    const s = parseInt(x.followers || 0);
    if (fPlt !== "전체" && x.platform !== fPlt) return false;
    if (s < range.min || s > range.max) return false;
    if (fStat !== "전체" && x.status !== fStat) return false;
    if (q && !x.name?.toLowerCase().includes(q.toLowerCase()) && !x.handle?.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const exportXLSX = () => {
    const rows = filtered.map((x, i) => ({
      "No.": i + 1, "플랫폼": x.platform, "이름": x.name, "핸들": x.handle,
      "팔로워 수": parseInt(x.followers || 0), "팔로워(포맷)": fmt(x.followers),
      "게시물/영상 수": parseInt(x.posts || 0), "국가": x.country,
      "예상 광고 단가": estimatePrice(x.platform, x.followers),
      "섭외 상태": x.status, "협의 금액": x.fee, "메모": x.notes,
      "URL": x.url, "추가일": x.addedAt?.slice(0, 10),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [5,10,20,20,12,12,12,8,20,10,12,30,40,12].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Influencer List");
    XLSX.writeFile(wb, `YIK_${brief.client || "Influencer"}_리스트_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const genProposal = async () => {
    setAiLoad(true); setAiOut("");
    const inf = filtered.slice(0, 20).map(x => `- [${x.platform}] ${x.name} ${x.handle} | 팔로워 ${fmt(x.followers)} | ${x.country || "국가미상"} | 예상단가 ${estimatePrice(x.platform, x.followers)}`).join("\n");
    const res = await askClaude(`YIK Media Inc. 인플루언서 마케팅 제안서.

클라이언트: ${brief.client} | 카테고리: ${brief.category} | 목표: ${brief.goal}
플랫폼: ${(brief.platforms||[]).join(", ")} | 지역: ${(brief.regions||[]).join(", ")}

선정 인플루언서 (${filtered.length}명):
${inf}

포함 항목:
1. 캠페인 개요 (3문장)
2. 인플루언서 믹스 전략 (플랫폼·지역별 분류)
3. 콘텐츠 포맷 제안
4. 기대 KPI
5. 총 예상 비용 범위
6. 타임라인 제안 (주 단위)

클라이언트 제출용, 설득력 있게 한국어 작성.`);
    setAiOut(res); setAiLoad(false);
  };

  const pltCounts = PLATFORMS.reduce((a, p) => { a[p] = list.filter(x => x.platform === p).length; return a; }, {});

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <SCard label="전체" value={list.length} accent />
        {PLATFORMS.map(p => pltCounts[p] > 0 && <SCard key={p} label={p} value={pltCounts[p]} color={PLT_COLORS[p]} />)}
      </div>
      <div style={{ background: "#fff", border: "1px solid #ebebeb", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름, 핸들 검색" style={{ ...S.input, width: 180 }} />
          <div style={{ display: "flex", gap: 4 }}>
            {["전체", ...PLATFORMS].map(p => <button key={p} style={{ ...S.chip(fPlt === p), fontSize: 12 }} onClick={() => setFPlt(p)}>{p}</button>)}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {SUB_RANGES.map((r, i) => <button key={r.label} style={{ ...S.chip(fSub === i), fontSize: 11 }} onClick={() => setFSub(i)}>{r.label}</button>)}
          </div>
          <select value={fStat} onChange={e => setFStat(e.target.value)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #e0e0e0", fontSize: 12 }}>
            <option value="전체">전체 상태</option>{Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button style={S.btn("g")} onClick={exportXLSX}>엑셀 다운로드 ({filtered.length}명)</button>
            <button style={S.btn("p")} onClick={genProposal} disabled={aiLoad || !filtered.length}>{aiLoad ? "작성 중..." : "AI 제안서"}</button>
          </div>
        </div>
      </div>
      {filtered.length === 0 && <Empty>{list.length === 0 ? "YouTube / Instagram / TikTok 탭에서 인플루언서를 추가하세요." : "필터 조건에 맞는 결과 없음"}</Empty>}
      {filtered.map(inf => (
        <div key={inf.id} style={{ ...S.card, padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {inf.thumb && <img src={inf.thumb} alt="" style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <a href={inf.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, fontWeight: 700, color: "#111", textDecoration: "none" }}>{inf.name}</a>
                <Pbadge p={inf.platform} />
                <span style={{ fontSize: 12, color: "#bbb" }}>{inf.handle}</span>
                {inf.country && <span style={{ fontSize: 11, color: "#bbb" }}>{inf.country}</span>}
                <span style={{ fontSize: 12, color: "#888" }}>팔로워 {fmt(inf.followers)}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>{estimatePrice(inf.platform, inf.followers)}</span>
              </div>
            </div>
            <select value={inf.status || "미응답"} onChange={e => updInf(inf.id, "status", e.target.value)}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 8, border: `1px solid ${STATUS_COLORS[inf.status||"미응답"]}`, background: STATUS_COLORS[inf.status||"미응답"] + "18", color: STATUS_COLORS[inf.status||"미응답"], cursor: "pointer" }}>
              {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input value={inf.fee || ""} onChange={e => updInf(inf.id, "fee", e.target.value)} placeholder="협의금액" style={{ width: 88, padding: "4px 8px", border: "1px solid #e8e8e8", borderRadius: 8, fontSize: 12, textAlign: "right" }} />
            <input value={inf.notes || ""} onChange={e => updInf(inf.id, "notes", e.target.value)} placeholder="메모" style={{ width: 130, padding: "4px 8px", border: "1px solid #e8e8e8", borderRadius: 8, fontSize: 12 }} />
            <button onClick={() => delInf(inf.id)} style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: 18 }}>×</button>
          </div>
        </div>
      ))}
      {aiOut && (
        <div style={{ ...S.card, marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>AI 제안서 초안</div>
            <button style={S.btn("o")} onClick={() => { navigator.clipboard.writeText(aiOut); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "✓ 복사됨" : "복사"}</button>
          </div>
          <pre style={{ fontSize: 13, color: "#444", lineHeight: 1.8, whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{aiOut}</pre>
        </div>
      )}
    </div>
  );
}

function Fld({ label, children }) { return <div style={{ marginBottom: 14 }}><label style={S.label}>{label}</label>{children}</div>; }
function Pbadge({ p }) { return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: PLT_COLORS[p] + "18", color: PLT_COLORS[p], border: `1px solid ${PLT_COLORS[p]}33` }}>{p}</span>; }
function Stats({ items }) { return <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{items.map(([l, v]) => <div key={l} style={{ background: "#f9f9f9", borderRadius: 8, padding: "5px 12px" }}><div style={{ fontSize: 10, color: "#bbb" }}>{l}</div><div style={{ fontSize: 13, fontWeight: 700 }}>{v}</div></div>)}</div>; }
function SCard({ label, value, accent, color }) { return <div style={{ background: "#fff", border: `1px solid ${color || (accent ? "#333" : "#ebebeb")}`, borderRadius: 10, padding: "10px 16px" }}><div style={{ fontSize: 22, fontWeight: 700, color: color || "#111" }}>{value}</div><div style={{ fontSize: 11, color: "#bbb" }}>{label}</div></div>; }
function Notice({ c, children }) { const m = { info: ["#eff6ff","#bfdbfe","#1d4ed8"], warn: ["#fffbeb","#fde68a","#92400e"], err: ["#fef2f2","#fecaca","#dc2626"] }[c]||["#f9f9f9","#e0e0e0","#555"]; return <div style={{ background: m[0], border: `1px solid ${m[1]}`, borderRadius: 10, padding: "12px 16px", marginBottom: 14, fontSize: 13, color: m[2], lineHeight: 1.7 }}>{children}</div>; }
function Empty({ children }) { return <div style={{ textAlign: "center", padding: "50px 0", color: "#ccc", fontSize: 13, lineHeight: 1.8 }}>{children}</div>; }
