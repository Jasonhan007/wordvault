/* ==========================================================================
   WordVault · 数据层（store.js）
   职责：localStorage 持久化 / 词条增删改查 / 筛选 / 间隔复习(SRS) / 统计 /
         JSON 导入导出与格式校验。全部方法挂载在 window.Vault 上。
   数据结构 voir README 注释末尾的 SCHEMA 说明。
   ========================================================================== */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'wordvault.data.v1';
  const SCHEMA_VERSION = 1;
  const DAY = 86400000;
  const RELEARN_MS = 10 * 60 * 1000; // “不认识”的词 10 分钟后可再次出现

  /* ------------------------------ 枚举 ------------------------------ */
  const SECTIONS = [
    { key: 'reading', label: '阅读理解' },
    { key: 'cloze', label: '完形填空' },
    { key: 'newtype', label: '新题型' },
    { key: 'translation', label: '翻译' },
    { key: 'writing', label: '写作' },
    { key: 'other', label: '其他' }
  ];

  const PARTS = ['Part A', 'Part B', 'Part C'];

  // level: 0 陌生 1 模糊 2 认识 3 已掌握（掌握率与待复习都以它为准）
  const LEVELS = [
    { value: 0, label: '陌生' },
    { value: 1, label: '模糊' },
    { value: 2, label: '认识' },
    { value: 3, label: '已掌握' }
  ];

  const RESULTS = { UNKNOWN: 'unknown', FUZZY: 'fuzzy', KNOWN: 'known' };

  // 连续答对次数(streak, 1 起算) → 下次复习间隔（天）
  const INTERVALS = [1, 2, 4, 7, 15, 30, 60, 90];

  const MAX_LEN = { word: 80, meaning: 300, sentence: 1200, note: 1500, year: 12, passage: 40, paragraph: 60 };

  const SECTION_LABELS = SECTIONS.reduce((m, s) => { m[s.key] = s.label; return m; }, {});
  const LEVEL_LABELS = LEVELS.reduce((m, l) => { m[l.value] = l.label; return m; }, {});

  /* ---------------------------- 内部状态 ---------------------------- */
  let state = { version: SCHEMA_VERSION, words: [], logs: [], updatedAt: 0 };
  let memoryOnly = false; // localStorage 不可用（如无痕模式）时降级为内存态

  /* ---------------------------- 基础工具 ---------------------------- */
  function uid() {
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function now() { return Date.now(); }
  function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function endOfToday() { return dayStart(now()) + DAY - 1; }
  function clampText(v, max) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\s+$/g, '').replace(/^\s+/, '').slice(0, max);
  }
  function hashKey(w) {
    return (w.word || '').toLowerCase() + '|' + (w.year || '') + '|' + (w.section || '');
  }

  const storage = (function () {
    try {
      const t = '__wv_probe__';
      global.localStorage.setItem(t, '1');
      global.localStorage.removeItem(t);
      return global.localStorage;
    } catch (e) {
      return null;
    }
  })();

  /* ---------------------------- 持久化 ---------------------------- */
  function load() {
    if (!storage) { memoryOnly = true; return state; }
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state.words = Array.isArray(parsed.words) ? parsed.words.map(normalizeStored).filter(Boolean) : [];
        state.logs = Array.isArray(parsed.logs) ? parsed.logs.slice(-2000) : [];
        state.version = SCHEMA_VERSION;
      }
    } catch (e) {
      // 数据损坏时保留原始字符串，避免用户数据被静默销毁
      try { storage.setItem(STORAGE_KEY + '.broken', storage.getItem(STORAGE_KEY) || ''); } catch (_) {}
      state = { version: SCHEMA_VERSION, words: [], logs: [], updatedAt: 0 };
      memoryOnly = false;
      state.loadError = true;
    }
    return state;
  }

  function persist() {
    state.updatedAt = now();
    if (!storage) { memoryOnly = true; return false; }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      memoryOnly = true;
      return false;
    }
  }

  /* ------------------------ 词条规范化 / 校验 ------------------------ */
  function blankWord() {
    const t = now();
    return {
      id: uid(),
      word: '',
      meaning: '',
      year: '',
      section: '',
      part: '',
      passage: '',
      paragraph: '',
      sentence: '',
      note: '',
      level: 0,
      favorite: false,
      isSample: false,
      createdAt: t,
      updatedAt: t,
      review: { streak: 0, interval: 0, due: t, lastReviewAt: 0, reviews: 0 }
    };
  }

  function normalizeReview(raw, createdAt) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    return {
      streak: Math.max(0, Math.min(INTERVALS.length, Math.round(num(r.streak, 0)))),
      interval: Math.max(0, num(r.interval, 0)),
      due: num(r.due, createdAt),
      lastReviewAt: num(r.lastReviewAt, 0),
      reviews: Math.max(0, Math.round(num(r.reviews, 0)))
    };
  }

  // 用于读回本地数据：宽容处理，异常条目直接丢弃
  function normalizeStored(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const w = blankWord();
    const createdAt = typeof raw.createdAt === 'number' && isFinite(raw.createdAt) ? raw.createdAt : now();
    w.id = typeof raw.id === 'string' && raw.id ? raw.id : w.id;
    w.word = clampText(raw.word, MAX_LEN.word);
    if (!w.word) return null;
    w.meaning = clampText(raw.meaning, MAX_LEN.meaning);
    w.year = clampText(raw.year, MAX_LEN.year);
    w.section = SECTION_LABELS[raw.section] ? raw.section : '';
    w.part = PARTS.indexOf(raw.part) >= 0 ? raw.part : '';
    w.passage = clampText(raw.passage, MAX_LEN.passage);
    w.paragraph = clampText(raw.paragraph, MAX_LEN.paragraph);
    w.sentence = clampText(raw.sentence, MAX_LEN.sentence);
    w.note = clampText(raw.note, MAX_LEN.note);
    w.level = [0, 1, 2, 3].indexOf(raw.level) >= 0 ? raw.level : 0;
    w.favorite = !!raw.favorite;
    w.isSample = !!raw.isSample;
    w.createdAt = createdAt;
    w.updatedAt = typeof raw.updatedAt === 'number' && isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
    w.review = normalizeReview(raw.review, createdAt);
    return w;
  }

  // 用于外部导入：严格校验，返回可直接入库的词条
  function normalizeImported(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, reason: '不是对象结构' };
    }
    const word = clampText(raw.word || raw.en || raw.term, MAX_LEN.word);
    if (!word) return { ok: false, reason: '缺少 word 字段' };
    const w = blankWord();
    w.word = word;
    w.meaning = clampText(raw.meaning || raw.cn || raw.definition, MAX_LEN.meaning);
    w.year = clampText(raw.year, MAX_LEN.year);
    w.section = SECTION_LABELS[raw.section] ? raw.section : '';
    w.part = PARTS.indexOf(raw.part) >= 0 ? raw.part : '';
    w.passage = clampText(raw.passage, MAX_LEN.passage);
    w.paragraph = clampText(raw.paragraph, MAX_LEN.paragraph);
    w.sentence = clampText(raw.sentence, MAX_LEN.sentence);
    w.note = clampText(raw.note, MAX_LEN.note);
    const lv = Number(raw.level);
    w.level = [0, 1, 2, 3].indexOf(lv) >= 0 ? lv : 0;
    w.favorite = !!raw.favorite;
    w.isSample = !!raw.isSample;
    if (typeof raw.createdAt === 'number' && isFinite(raw.createdAt)) w.createdAt = raw.createdAt;
    w.updatedAt = now();
    w.review = normalizeReview(raw.review, w.createdAt);
    if (w.level === 3) w.review.due = w.review.due > now() ? w.review.due : now() + INTERVALS[0] * DAY;
    return { ok: true, word: w };
  }

  /* ---------------------------- 查询 ---------------------------- */
  function all() { return state.words.slice(); }
  function get(id) { return state.words.find(w => w.id === id) || null; }

  function years() {
    const set = new Set();
    state.words.forEach(w => { if (w.year) set.add(w.year); });
    const numeric = [];
    const other = [];
    set.forEach(y => (/^\d+$/.test(y) ? numeric : other).push(y));
    numeric.sort((a, b) => Number(b) - Number(a));
    other.sort();
    return numeric.concat(other);
  }

  function sectionsUsed() {
    const set = new Set();
    state.words.forEach(w => { if (w.section) set.add(w.section); });
    return SECTIONS.filter(s => set.has(s.key)).map(s => s.key);
  }

  function matches(w, f) {
    if (f.q) {
      const q = f.q.toLowerCase();
      const hay = (w.word + ' ' + w.meaning + ' ' + w.sentence + ' ' + w.note + ' ' + w.year + ' ' + w.passage).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (f.year && f.year !== 'all' && w.year !== f.year) return false;
    if (f.section && f.section !== 'all' && w.section !== f.section) return false;
    if (f.level && f.level !== 'all' && w.level !== Number(f.level)) return false;
    if (f.favorite && !w.favorite) return false;
    if (f.samples === 'exclude' && w.isSample) return false;
    return true;
  }

  const SORTERS = {
    recent: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    az: (a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()),
    level: (a, b) => a.level - b.level || b.createdAt - a.createdAt,
    due: (a, b) => a.review.due - b.review.due || a.level - b.level,
    year: (a, b) => String(b.year).localeCompare(String(a.year)) || a.word.localeCompare(b.word)
  };

  function list(filter) {
    const f = Object.assign({ q: '', year: 'all', section: 'all', level: 'all', favorite: false, samples: 'include', sort: 'recent' }, filter || {});
    const out = state.words.filter(w => matches(w, f));
    out.sort(SORTERS[f.sort] || SORTERS.recent);
    return out;
  }

  function recent(n) {
    return state.words.slice().sort(SORTERS.recent).slice(0, n || 5);
  }

  /* ---------------------------- 写入 ---------------------------- */
  function add(data) {
    const w = blankWord();
    const r = normalizeImported(Object.assign({}, data, { review: null }));
    if (!r.ok) return null;
    w.word = r.word.word;
    w.meaning = r.word.meaning;
    w.year = r.word.year;
    w.section = r.word.section;
    w.part = r.word.part;
    w.passage = r.word.passage;
    w.paragraph = r.word.paragraph;
    w.sentence = r.word.sentence;
    w.note = r.word.note;
    w.level = r.word.level;
    w.favorite = r.word.favorite;
    w.isSample = !!data.isSample;
    w.review = normalizeReview(null, w.createdAt);
    if (w.level >= 2) w.review.due = now() + INTERVALS[0] * DAY;
    state.words.unshift(w);
    persist();
    return w;
  }

  function update(id, patch) {
    const w = get(id);
    if (!w) return null;
    if (typeof patch.word !== 'undefined') {
      const v = clampText(patch.word, MAX_LEN.word);
      if (!v) return null;
      w.word = v;
    }
    ['meaning', 'year', 'passage', 'paragraph', 'sentence', 'note'].forEach(k => {
      if (typeof patch[k] !== 'undefined') w[k] = clampText(patch[k], MAX_LEN[k]);
    });
    if (typeof patch.section !== 'undefined') w.section = SECTION_LABELS[patch.section] ? patch.section : '';
    if (typeof patch.part !== 'undefined') w.part = PARTS.indexOf(patch.part) >= 0 ? patch.part : '';
    if (typeof patch.favorite !== 'undefined') w.favorite = !!patch.favorite;
    if (typeof patch.level !== 'undefined') setLevelValue(w, Number(patch.level));
    w.updatedAt = now();
    persist();
    return w;
  }

  function setLevelValue(w, level) {
    const lv = [0, 1, 2, 3].indexOf(level) >= 0 ? level : 0;
    w.level = lv;
    if (lv === 3) {
      w.review.streak = Math.max(w.review.streak, 3);
      w.review.interval = INTERVALS[2];
      w.review.due = now() + INTERVALS[2] * DAY;
    } else if (lv === 0) {
      w.review.streak = 0;
      w.review.interval = 0;
      w.review.due = now();
    } else {
      w.review.due = now() + DAY;
    }
  }

  function remove(ids) {
    const set = new Set(ids);
    const before = state.words.length;
    state.words = state.words.filter(w => !set.has(w.id));
    persist();
    return before - state.words.length;
  }

  function setFavorite(ids, val) {
    let n = 0;
    ids.forEach(id => { const w = get(id); if (w) { w.favorite = !!val; w.updatedAt = now(); n++; } });
    persist();
    return n;
  }

  function setLevel(ids, level) {
    let n = 0;
    ids.forEach(id => { const w = get(id); if (w) { setLevelValue(w, level); w.updatedAt = now(); n++; } });
    persist();
    return n;
  }

  /* ------------------------ 间隔复习（SRS） ------------------------ */
  /* 规则（简单可解释，避免词越积越多）：
     · 认识：level +1，连续答对次数 +1，间隔按 INTERVALS 递增（1→2→4→7→15→30→60→90 天）
     · 模糊：level 最多保留在“模糊”，连续次数 -1，1 天后重来
     · 不认识：level 归零，连续次数清零，10 分钟后重来 */
  function review(id, result) {
    const w = get(id);
    if (!w) return null;
    const t = now();
    const r = w.review;
    r.reviews += 1;
    r.lastReviewAt = t;

    if (result === RESULTS.KNOWN) {
      w.level = Math.min(3, w.level + 1);
      r.streak = Math.min(r.streak + 1, INTERVALS.length);
      r.interval = INTERVALS[r.streak - 1];
      r.due = dayStart(t) + r.interval * DAY;
    } else if (result === RESULTS.FUZZY) {
      w.level = Math.min(w.level, 1);
      r.streak = Math.max(0, r.streak - 1);
      r.interval = 0;
      r.due = dayStart(t) + DAY;
    } else {
      w.level = 0;
      r.streak = 0;
      r.interval = 0;
      r.due = t + RELEARN_MS;
    }
    w.updatedAt = t;
    state.logs.push({ id: uid(), wordId: w.id, result: result, at: t });
    if (state.logs.length > 2000) state.logs = state.logs.slice(-2000);
    persist();
    return w;
  }

  function isDueToday(w) { return w.level < 3 && w.review.due <= endOfToday(); }

  /* 复习前的快照，配合 undoReview 实现「选错了回退一步」。
     必须在 review() 之前取，且 review 对象要复制一份，否则会被原地改写。 */
  function snapshot(id) {
    const w = get(id);
    if (!w) return null;
    return { level: w.level, review: Object.assign({}, w.review) };
  }

  /* 撤销一次复习：还原熟悉度与复习进度，并删掉这次留下的日志 */
  function undoReview(id, snap) {
    const w = get(id);
    if (!w || !snap || typeof snap.level !== 'number' || !snap.review) return null;
    w.level = snap.level;
    w.review = Object.assign({}, snap.review);
    w.updatedAt = now();
    for (let i = state.logs.length - 1; i >= 0; i--) {
      if (state.logs[i].wordId === id) { state.logs.splice(i, 1); break; }
    }
    persist();
    return w;
  }

  function dueCount() { return state.words.filter(isDueToday).length; }

  function buildQueue(opts) {
    const o = Object.assign({ scope: 'due', year: 'all', section: 'all', limit: 40 }, opts || {});
    let pool = state.words.filter(w => {
      if (o.year !== 'all' && w.year !== o.year) return false;
      if (o.section !== 'all' && w.section !== o.section) return false;
      return o.scope === 'due' ? isDueToday(w) : w.level < 3;
    });
    // 不认识(0) → 模糊(1) → 认识(2)，同级按到期时间先后
    pool.sort((a, b) => a.level - b.level || a.review.due - b.review.due || (b.favorite - a.favorite));
    if (o.limit > 0) pool = pool.slice(0, o.limit);
    return pool.map(w => w.id);
  }

  function logsToday() {
    const s = dayStart(now());
    return state.logs.filter(l => l.at >= s);
  }

  function logsForWord(id) {
    return state.logs.filter(l => l.wordId === id);
  }

  /* ---------------------------- 统计 ---------------------------- */
  function stats() {
    const total = state.words.length;
    let mastered = 0, due = 0, favorites = 0, samples = 0, fresh = 0;
    const byYear = new Map();
    const bySection = new Map();
    const byLevel = [0, 0, 0, 0];

    state.words.forEach(w => {
      if (w.level === 3) mastered++;
      if (isDueToday(w)) due++;
      if (w.favorite) favorites++;
      if (w.isSample) samples++;
      if (w.review.reviews === 0) fresh++;
      byLevel[w.level]++;
      const y = w.year || '未填年份';
      byYear.set(y, (byYear.get(y) || 0) + 1);
      const s = w.section || '未填题型';
      bySection.set(s, (bySection.get(s) || 0) + 1);
    });

    const yearRows = Array.from(byYear.entries()).map(([label, count]) => ({ label, count }));
    yearRows.sort((a, b) => {
      if (a.label === '未填年份') return 1;
      if (b.label === '未填年份') return -1;
      return String(b.label).localeCompare(String(a.label));
    });

    const sectionRows = Array.from(bySection.entries()).map(([key, count]) => ({
      key,
      label: SECTION_LABELS[key] || key,
      count
    }));
    sectionRows.sort((a, b) => b.count - a.count);

    const todayLogs = logsToday();
    const todayCounts = { known: 0, fuzzy: 0, unknown: 0 };
    todayLogs.forEach(l => { if (todayCounts[l.result] !== undefined) todayCounts[l.result]++; });

    // 最近 7 天复习次数（含今天），用于趋势小图
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const s = dayStart(now() - i * DAY);
      const e = s + DAY - 1;
      const n = state.logs.filter(l => l.at >= s && l.at <= e).length;
      trend.push({ label: i === 0 ? '今天' : (i + '天前'), count: n });
    }

    return {
      total,
      mastered,
      due,
      learning: total - mastered,
      rate: total ? Math.round((mastered / total) * 100) : 0,
      favorites,
      samples,
      fresh,
      byYear: yearRows,
      bySection: sectionRows,
      byLevel: LEVELS.map((l, i) => ({ value: l.value, label: l.label, count: byLevel[i] })),
      reviewedToday: todayLogs.length,
      todayCounts,
      trend,
      totalReviews: state.logs.length
    };
  }

  /* ------------------------- 导入 / 导出 ------------------------- */
  function exportPayload() {
    return {
      app: 'WordVault',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      count: state.words.length,
      words: state.words.map(w => ({
        word: w.word, meaning: w.meaning, year: w.year, section: w.section,
        part: w.part, passage: w.passage, paragraph: w.paragraph,
        sentence: w.sentence, note: w.note, level: w.level,
        favorite: w.favorite, isSample: w.isSample,
        createdAt: w.createdAt, updatedAt: w.updatedAt, review: w.review
      }))
    };
  }

  function exportJSON() { return JSON.stringify(exportPayload(), null, 2); }

  function parseImport(input) {
    let data = input;
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) return { ok: false, error: '内容为空' };
      try { data = JSON.parse(trimmed); }
      catch (e) { return { ok: false, error: 'JSON 解析失败：' + e.message }; }
    }
    let list;
    if (Array.isArray(data)) list = data;
    else if (data && typeof data === 'object' && Array.isArray(data.words)) list = data.words;
    else return { ok: false, error: '格式不符：应为词条数组，或含 words 数组的对象（WordVault 导出的文件）' };

    const words = [];
    const invalid = [];
    list.forEach((item, i) => {
      const r = normalizeImported(item);
      if (r.ok) words.push(r.word);
      else invalid.push({ index: i + 1, reason: r.reason });
    });

    if (!words.length) {
      return { ok: false, error: '没有找到有效词条（共 ' + list.length + ' 条，全部校验失败）', invalid };
    }
    return { ok: true, words, invalid, total: list.length };
  }

  /* mode: 'merge' 跳过已存在的相同词条 / 'update' 覆盖同名词条 / 'replace' 清空后导入 */
  function importWords(words, mode) {
    const m = mode || 'merge';
    let added = 0, updated = 0, skipped = 0;
    if (m === 'replace') { state.words = []; }

    const index = new Map();
    state.words.forEach(w => index.set(hashKey(w), w));

    words.forEach(src => {
      const key = hashKey(src);
      const exist = index.get(key);
      if (exist) {
        if (m === 'update') {
          ['meaning', 'part', 'passage', 'paragraph', 'sentence', 'note'].forEach(k => { if (src[k]) exist[k] = src[k]; });
          if (src.level > exist.level) exist.level = src.level;
          if (src.favorite) exist.favorite = true;
          exist.updatedAt = now();
          updated++;
        } else {
          skipped++;
        }
        return;
      }
      const w = blankWord();
      Object.assign(w, {
        word: src.word, meaning: src.meaning, year: src.year, section: src.section,
        part: src.part, passage: src.passage, paragraph: src.paragraph,
        sentence: src.sentence, note: src.note, level: src.level,
        favorite: src.favorite, isSample: src.isSample, createdAt: src.createdAt
      });
      w.review = normalizeReview(src.review, src.createdAt);
      index.set(key, w);
      state.words.push(w);
      added++;
    });

    persist();
    return { added, updated, skipped, total: state.words.length };
  }

  function importText(text, mode) {
    const parsed = parseImport(text);
    if (!parsed.ok) return parsed;
    const res = importWords(parsed.words, mode);
    return Object.assign({ ok: true, invalid: parsed.invalid, parsedTotal: parsed.total }, res);
  }

  /* --------------------------- 示例数据 --------------------------- */
  /* 仅 3 条，明确标记 isSample，非真题原文，用于演示功能。 */
  const SAMPLES = [
    {
      word: 'contemplate', meaning: 'v. 沉思，仔细考虑；注视',
      section: 'reading', part: 'Part A', passage: 'Text 1', paragraph: '第 2 段',
      sentence: 'We should contemplate the consequences before acting.',
      note: '示例词条：非真题原文，仅用于演示功能。搭配 contemplate doing sth.'
    },
    {
      word: 'substantial', meaning: 'adj. 大量的；实质性的；坚固的',
      section: 'translation', paragraph: '第 1 段',
      sentence: 'The company made a substantial investment in research.',
      note: '示例词条：非真题原文，仅用于演示功能。与 substantive（实质的）易混。'
    },
    {
      word: 'preliminary', meaning: 'adj. 初步的，预备的 n. 初步做法',
      section: 'cloze', sentence: 'Preliminary results suggest the trend will continue.',
      note: '示例词条：非真题原文，仅用于演示功能。a preliminary study 初步研究。'
    }
  ];

  function addSamples() {
    const existing = new Set(state.words.map(hashKey));
    let n = 0;
    SAMPLES.forEach(s => {
      if (existing.has(hashKey(s))) return;
      const w = add(Object.assign({ isSample: true, level: 0 }, s));
      if (w) n++;
    });
    return n;
  }

  function removeSamples() {
    const before = state.words.length;
    state.words = state.words.filter(w => !w.isSample);
    persist();
    return before - state.words.length;
  }

  /* --------------------------- 清空数据 --------------------------- */
  /* scope: 'all' 全部 | 'logs' 仅复习记录 | 'words' 仅单词 */
  function clear(scope) {
    if (scope === 'logs') {
      const n = state.logs.length;
      state.logs = [];
      const t = now();
      // 记录清空后进度无从续算，把复习进度一并归零（熟悉程度保留）
      state.words.forEach(w => {
        w.review = {
          streak: 0,
          interval: 0,
          due: w.level >= 3 ? t + 30 * DAY : t,
          lastReviewAt: 0,
          reviews: 0
        };
      });
      persist();
      return n;
    }
    if (scope === 'words') {
      const n = state.words.length;
      state.words = [];
      state.logs = [];
      persist();
      return n;
    }
    const n = state.words.length;
    state = { version: SCHEMA_VERSION, words: [], logs: [], updatedAt: now() };
    persist();
    return n;
  }

  function storageSize() {
    try {
      const raw = storage ? storage.getItem(STORAGE_KEY) : '';
      return raw ? raw.length : 0;
    } catch (e) { return 0; }
  }

  /* ---------------------------- 导出 API ---------------------------- */
  global.Vault = {
    SCHEMA_VERSION, SECTIONS, PARTS, LEVELS, RESULTS, INTERVALS, SECTION_LABELS, LEVEL_LABELS,
    load, persist, all, get, list, recent, years, sectionsUsed,
    add, update, remove, setFavorite, setLevel,
    review, buildQueue, dueCount, isDueToday, logsToday, logsForWord, snapshot, undoReview,
    stats, exportJSON, exportPayload, parseImport, importWords, importText,
    addSamples, removeSamples, clear, storageSize,
    isMemoryOnly: () => memoryOnly,
    hasLoadError: () => !!state.loadError,
    blankWord
  };
})(window);
