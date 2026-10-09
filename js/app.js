/* ==========================================================================
   WordVault · 视图与交互层（app.js）
   职责：底部导航路由 / 五个页面的渲染 / 单词编辑面板 / 复习流程 / 导入导出交互。
   所有数据读写都通过 window.Vault（store.js），本文件不直接碰 localStorage。
   ========================================================================== */
(function () {
  'use strict';

  const V = window.Vault;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const DAY = 86400000;

  /* ------------------------------ 工具 ------------------------------ */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    void el.offsetHeight; // 先让浏览器算一次初始样式，后面的过渡才生效（不依赖 rAF）
    el.classList.add('is-open');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.remove('is-open');
      setTimeout(() => { el.hidden = true; }, 240);
    }, 1900);
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function stamp() {
    const d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }
  function levelBadge(level) {
    return '<span class="badge lv' + level + '">' + esc(V.LEVEL_LABELS[level]) + '</span>';
  }
  function metaLine(w) {
    const bits = [];
    if (w.year) bits.push(w.year + ' 年');
    if (w.section) bits.push(V.SECTION_LABELS[w.section]);
    if (w.part) bits.push(w.part);
    if (w.passage) bits.push(w.passage);
    if (w.paragraph) bits.push(w.paragraph);
    return bits.map(b => '<span>' + esc(b) + '</span>').join('');
  }
  /* 图标：全部 24×24 网格、只描边（stroke 由 CSS 继承）、linejoin/linecap 为 round。
     统一在 app.js 定义，Dock 与内容区共用同一份，避免两处图形走形。 */
  const ICON = {
    home: '<path d="M3.4 11.6 12 4.4l8.6 7.2"/>' +
      '<path d="M5.6 10.4h12.8v9.2a1.8 1.8 0 0 1-1.8 1.8H7.4a1.8 1.8 0 0 1-1.8-1.8z"/>' +
      '<path d="M9.9 21.4v-3.5a2.1 2.1 0 0 1 4.2 0v3.5"/>',
    book: '<path d="M12 7.3C10.4 5.9 8.2 5.2 5.6 5.2h-.4A1.2 1.2 0 0 0 4 6.4v10.3a1.2 1.2 0 0 0 1.2 1.2h.4c2.6 0 4.8.7 6.4 2 1.6-1.3 3.8-2 6.4-2h.4a1.2 1.2 0 0 0 1.2-1.2V6.4a1.2 1.2 0 0 0-1.2-1.2h-.4c-2.6 0-4.8.7-6.4 2.1z"/>' +
      '<path d="M12 7.3v12.6"/>',
    review: '<path d="M8.2 5.2h8.6a3.2 3.2 0 0 1 3.2 3.2v7.4"/>' +
      '<rect x="3.9" y="8.5" width="12.9" height="10.6" rx="3"/>',
    stats: '<path d="M4.8 20.2h14.4"/><path d="M8.4 20.2v-6.6"/>' +
      '<path d="M12 20.2V5.4"/><path d="M15.6 20.2v-9.4"/>',
    /* 8 齿齿轮：齿顶/齿谷用圆弧、齿侧用直线，一次连笔成形（无接缝） */
    settings: '<path d="M10.53 2.72A9.4 9.4 0 0 1 13.47 2.72L14.51 5.09A7.35 7.35 0 0 1 15.11 5.34L17.53 4.4A9.4 9.4 0 0 1 19.6 6.47L18.66 8.89A7.35 7.35 0 0 1 18.91 9.49L21.28 10.53A9.4 9.4 0 0 1 21.28 13.47L18.91 14.51A7.35 7.35 0 0 1 18.66 15.11L19.6 17.53A9.4 9.4 0 0 1 17.53 19.6L15.11 18.66A7.35 7.35 0 0 1 14.51 18.91L13.47 21.28A9.4 9.4 0 0 1 10.53 21.28L9.49 18.91A7.35 7.35 0 0 1 8.89 18.66L6.47 19.6A9.4 9.4 0 0 1 4.4 17.53L5.34 15.11A7.35 7.35 0 0 1 5.09 14.51L2.72 13.47A9.4 9.4 0 0 1 2.72 10.53L5.09 9.49A7.35 7.35 0 0 1 5.34 8.89L4.4 6.47A9.4 9.4 0 0 1 6.47 4.4L8.89 5.34A7.35 7.35 0 0 1 9.49 5.09z"/>' +
      '<circle cx="12" cy="12" r="3.25"/>',
    star: '<path d="M12 3.9l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.92l-5.1 2.68.98-5.68L3.75 9.9l5.7-.83z"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.4"/><path d="M19.6 19.6l-3.8-3.8"/>'
  };
  const TAB_ICON = { home: 'home', words: 'book', review: 'review', stats: 'stats', settings: 'settings' };
  function svgIcon(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[name] || '') + '</svg>';
  }

  /* ---------------------------- 界面状态 ---------------------------- */
  const ui = {
    view: 'home',
    filter: { q: '', year: 'all', section: 'all', level: 'all', favorite: false, sort: 'recent' },
    reviewFilter: { year: 'all', section: 'all' },
    selectMode: false,
    selection: new Set(),
    editingId: null,
    session: null,
    dockReady: false
  };

  /* ============================ 导航路由 ============================ */
  const VIEWS = ['home', 'words', 'review', 'stats', 'settings'];

  function setView(name, opts) {
    if (VIEWS.indexOf(name) === -1) name = 'home';
    ui.view = name;
    VIEWS.forEach(v => {
      const el = $('#view-' + v);
      if (el) el.classList.toggle('is-active', v === name);
    });
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
    if (!opts || !opts.silent) {
      const hash = '#/' + name;
      // file:// 下部分浏览器不允许改写 history，失败不影响使用
      try { if (location.hash !== hash) history.replaceState(null, '', hash); } catch (e) {}
    }
    document.body.classList.toggle('selecting', name === 'words' && ui.selectMode);
    positionDockPill();
    render(name);
    const scroller = $('#view-' + name + ' .view-scroll');
    if (scroller) scroller.scrollTop = 0;
  }

  /* Dock 的选中指示块跟随当前 tab 滑动 */
  function positionDockPill() {
    const pill = $('#dockPill');
    const bar = $('.tab-bar');
    const active = $('.tab.is-active');
    if (!pill || !bar || !active) return;
    const barRect = bar.getBoundingClientRect();
    const tabRect = active.getBoundingClientRect();
    if (!barRect.width || !tabRect.width) return;
    const pad = 6; // 与 .tab-bar 的左右内边距一致
    const width = Math.max(0, tabRect.width - pad * 2);
    const x = tabRect.left - barRect.left + pad;
    if (!ui.dockReady) {
      pill.style.transition = 'none';
      pill.style.width = width + 'px';
      pill.style.transform = 'translateX(' + x + 'px)';
      void pill.offsetHeight;
      pill.style.transition = '';
      ui.dockReady = true;
      return;
    }
    pill.style.width = width + 'px';
    pill.style.transform = 'translateX(' + x + 'px)';
  }

  function render(name) {
    const view = name || ui.view;
    if (view === 'home') renderHome();
    if (view === 'words') renderWords();
    if (view === 'review') renderReview();
    if (view === 'stats') renderStats();
    if (view === 'settings') renderSettings();
    renderTabBadge();
  }
  function renderAll() { render(ui.view); }

  function renderTabBadge() {
    const due = V.dueCount();
    const badge = $('#tabBadge');
    badge.hidden = due <= 0;
    badge.textContent = due > 99 ? '99+' : String(due);
  }

  /* ============================== 首页 ============================== */
  function renderHome() {
    const now = new Date();
    const hour = now.getHours();
    const greet = hour < 6 ? '凌晨好' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
    $('#homeDate').textContent = now.toLocaleDateString('zh-CN', {
      month: 'long', day: 'numeric', weekday: 'long'
    }) + ' · ' + greet;

    const s = V.stats();
    $('#homeDue').textContent = s.due;
    $('#homeDueSub').textContent = s.due > 0
      ? (s.fresh > 0 ? '其中 ' + s.fresh + ' 个是还没复习过的新词' : '优先复习“不认识 / 模糊”的单词')
      : (s.total ? '所有单词都在复习计划内' : '先去添加你的第一个真题单词');

    $('#homeStats').innerHTML = [
      { v: s.total, k: '单词总数' },
      { v: s.mastered, k: '已掌握' },
      { v: s.rate + '%', k: '掌握率' }
    ].map(item => '<div class="stat-item"><div class="v">' + item.v + '</div><div class="k">' + item.k + '</div></div>').join('');

    renderHomeRing(s);

    const recent = V.recent(5);
    $('#homeRecent').innerHTML = recent.length
      ? '<div class="list-card">' + recent.map(wordRow).join('') + '</div>'
      : emptyState(svgIcon('book'), '还没有单词', '在上面的输入框里填一个词，就能开始建立自己的真题词库。');
  }

  /* 今日进度环：已完成 = 今日已复习次数，总量 = 已完成 + 仍待复习 */
  function renderHomeRing(s) {
    const ring = $('#homeRing');
    const todayTotal = s.reviewedToday + s.due;
    if (!s.total || !todayTotal) { ring.hidden = true; ring.innerHTML = ''; return; }
    const pct = Math.min(1, s.reviewedToday / todayTotal);
    const C = 2 * Math.PI * 35; // viewBox 78×78、stroke 8 → r = 35
    ring.hidden = false;
    ring.innerHTML =
      '<svg viewBox="0 0 78 78">' +
        '<circle class="ring-track" cx="39" cy="39" r="35"/>' +
        '<circle class="ring-fill" cx="39" cy="39" r="35" stroke-dasharray="' + C.toFixed(1) + '" ' +
          'stroke-dashoffset="' + (C * (1 - pct)).toFixed(1) + '"/>' +
      '</svg>' +
      '<div class="ring-text"><span class="n">' + Math.round(pct * 100) + '%</span><span class="t">今日进度</span></div>';
  }

  /* ============================= 单词本 ============================= */
  function wordRow(w) {
    const checked = ui.selection.has(w.id);
    return '' +
      '<div class="row" data-action="row-tap" data-id="' + w.id + '">' +
        (ui.selectMode ? '<span class="checkbox' + (checked ? ' is-on' : '') + '"></span>' : '') +
        '<div class="row-main">' +
          '<div class="row-word">' + esc(w.word) +
            (w.isSample ? '<span class="badge sample">示例</span>' : '') + '</div>' +
          (w.meaning ? '<div class="row-meaning">' + esc(w.meaning) + '</div>' : '') +
          '<div class="row-meta">' + metaLine(w) + '</div>' +
        '</div>' +
        '<div class="row-side">' +
          levelBadge(w.level) +
          (ui.selectMode ? '' :
            '<button class="star-btn' + (w.favorite ? ' is-on' : '') + '" data-action="toggle-fav" data-id="' + w.id + '" aria-label="收藏">' + svgIcon('star') + '</button>') +
        '</div>' +
      '</div>';
  }

  function emptyState(icon, title, text, action) {
    return '<div class="empty">' +
      '<div class="empty-badge">' + icon + '</div>' +
      '<p class="empty-title">' + esc(title) + '</p>' +
      '<p class="empty-text">' + esc(text) + '</p>' +
      (action || '') + '</div>';
  }

  function renderWords() {
    const f = ui.filter;
    const rows = V.list(f);
    const total = V.all().length;

    // 筛选按钮文案
    $('#chipYear').textContent = '年份：' + (f.year === 'all' ? '全部' : f.year);
    $('#chipYear').classList.toggle('is-active', f.year !== 'all');
    $('#chipLevel').textContent = '熟悉度：' + (f.level === 'all' ? '全部' : V.LEVEL_LABELS[f.level]);
    $('#chipLevel').classList.toggle('is-active', f.level !== 'all');
    $('#chipSection').textContent = '题型：' + (f.section === 'all' ? '全部' : V.SECTION_LABELS[f.section]);
    $('#chipSection').classList.toggle('is-active', f.section !== 'all');
    $('#chipFav').classList.toggle('is-active', !!f.favorite);
    const sortLabels = { recent: '最新', oldest: '最早', az: 'A-Z', level: '熟悉度', due: '待复习', year: '年份' };
    $('#chipSort').textContent = '排序：' + sortLabels[f.sort];

    $('#wordsCount').textContent = total === 0
      ? '共 0 个单词'
      : '显示 ' + rows.length + ' / ' + total + ' 个单词';

    // 有任何筛选/搜索/非默认排序时，给出显式的清除入口
    const filterActive = !!(f.q || f.year !== 'all' || f.section !== 'all' ||
      f.level !== 'all' || f.favorite || f.sort !== 'recent');
    $('#wordsReset').hidden = !filterActive;

    let html;
    if (total === 0) {
      html = emptyState(svgIcon('book'), '单词本还是空的',
        '点右上角「选择」旁的加号，或到首页快速添加第一个真题单词。',
        '<button class="btn btn-primary" data-action="open-add-sheet">添加单词</button>' +
        '<button class="btn" data-action="add-samples">加载示例数据</button>');
    } else if (!rows.length) {
      html = emptyState(svgIcon('search'), '没有符合条件的单词', '试试换个关键词，或清除筛选条件。',
        '<button class="btn" data-action="reset-filter">清除筛选</button>');
    } else {
      html = '<div class="list-card">' + rows.map(wordRow).join('') + '</div>';
    }
    $('#wordsList').innerHTML = html;

    // 批量操作栏
    document.body.classList.toggle('selecting', ui.selectMode);
    $('#bulkBar').hidden = !ui.selectMode;
    $('#selectToggle').textContent = ui.selectMode ? '完成' : '选择';
    $('#wordsTitle').textContent = ui.selectMode ? '批量管理' : '单词本';
    $('#wordsNavTitle').textContent = ui.selectMode ? '批量管理' : '单词本';
    $('#bulkCount').textContent = '已选 ' + ui.selection.size + ' 项' + (ui.selectMode ? '（点击词条勾选）' : '');
    const allSelected = rows.length > 0 && rows.every(w => ui.selection.has(w.id));
    $('#bulkAll').textContent = allSelected ? '取消全选' : '全选';
  }

  /* ============================== 复习 ============================== */
  function renderReview() {
    const s = ui.session;
    const track = $('#reviewProgressTrack');
    const ptext = $('#reviewProgressText');
    const quit = $('#reviewQuit');

    if (!s) {
      track.hidden = true; ptext.hidden = true; quit.hidden = true;
      $('#reviewUndo').hidden = true;
      const due = V.dueCount();
      const unmastered = V.all().filter(w => w.level < 3).length;
      const years = V.years();
      const sections = V.sectionsUsed();
      $('#reviewBody').innerHTML = '' +
        '<div class="page-header"><h1 class="page-title">复习</h1></div>' +
        '<div class="card">' +
          '<p class="hero-label">今日待复习</p>' +
          '<p class="hero-number"><span>' + due + '</span><span class="hero-unit">词</span></p>' +
          '<p class="hero-sub">' + (unmastered ? '未掌握单词共 ' + unmastered + ' 个' : '暂时没有需要复习的单词') + '</p>' +
        '</div>' +
        '<div class="block">' +
          '<div class="block-head"><h2 class="block-title">可选筛选</h2></div>' +
          '<div class="card form-card">' +
            '<div class="field-row">' +
              '<div class="field"><label for="rvYear">年份</label><select id="rvYear"><option value="all">全部年份</option>' +
                years.map(y => '<option value="' + esc(y) + '">' + esc(y) + '</option>').join('') + '</select></div>' +
              '<div class="field"><label for="rvSection">题型</label><select id="rvSection"><option value="all">全部题型</option>' +
                sections.map(k => '<option value="' + k + '">' + esc(V.SECTION_LABELS[k]) + '</option>').join('') + '</select></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<button class="btn btn-primary btn-block" data-action="start-review">开始复习（' + due + '）</button>' +
        (unmastered > due ? '<button class="btn btn-block" data-action="review-all-unmastered">复习全部未掌握（' + unmastered + '）</button>' : '') +
        '<p class="set-hint">复习顺序：不认识的词优先，其次是模糊的词；标记为「认识」后间隔会逐步拉长（1 → 2 → 4 → 7 → 15 → 30 → 60 → 90 天），因此不会越积越多。</p>';
      return;
    }

    track.hidden = false; ptext.hidden = false; quit.hidden = false;
    // 「上一词」在本轮有过作答后才可用（没有可撤销的就置灰，保持入口可见）
    $('#reviewUndo').hidden = false;
    $('#reviewUndo').disabled = s.history.length === 0;

    if (s.finished) {
      $('#reviewProgressFill').style.width = '100%';
      const remaining = V.dueCount();
      const unmastered = V.all().filter(w => w.level < 3).length;
      ptext.textContent = '本轮 ' + s.queue.length + ' 词已完成';
      $('#reviewBody').innerHTML = '' +
        '<div class="review-summary">' +
          '<div class="card" style="text-align:center">' +
            '<p class="hero-label">本轮复习完成</p>' +
            '<p class="hero-number"><span>' + s.queue.length + '</span><span class="hero-unit">词</span></p>' +
            '<p class="hero-sub">' + (remaining ? '还有 ' + remaining + ' 个词到期，可以再来一轮' : '今天的复习计划已清空') + '</p>' +
          '</div>' +
          '<div class="summary-grid">' +
            '<div class="summary-cell"><div class="v" style="color:var(--green)">' + s.counts.known + '</div><div class="k">认识</div></div>' +
            '<div class="summary-cell"><div class="v" style="color:var(--orange)">' + s.counts.fuzzy + '</div><div class="k">模糊</div></div>' +
            '<div class="summary-cell"><div class="v" style="color:var(--red)">' + s.counts.unknown + '</div><div class="k">不认识</div></div>' +
          '</div>' +
          '<button class="btn btn-primary btn-block" data-action="start-review">' + (remaining ? '再来一轮待复习（' + remaining + '）' : '再复习一轮未掌握') + '</button>' +
          (unmastered > 0 ? '<button class="btn btn-block" data-action="review-all-unmastered">复习全部未掌握（' + unmastered + '）</button>' : '') +
          '<button class="btn btn-block" data-action="quit-review">返回</button>' +
          '<p class="set-hint" style="text-align:center">选错了？点右上角「‹ 上一词」可以撤销上一次评分。</p>' +
        '</div>';
      return;
    }

    const w = V.get(s.queue[s.index]);
    if (!w) { // 数据被删除等异常，自动跳过
      s.index++;
      if (s.index >= s.queue.length) s.finished = true;
      renderReview();
      return;
    }

    const pct = Math.round((s.index / s.queue.length) * 100);
    $('#reviewProgressFill').style.width = pct + '%';
    ptext.textContent = '第 ' + (s.index + 1) + ' / ' + s.queue.length + ' 词' +
      (s.counts.known + s.counts.fuzzy + s.counts.unknown > 0
        ? ' · 认识 ' + s.counts.known + ' · 模糊 ' + s.counts.fuzzy + ' · 不认识 ' + s.counts.unknown
        : '');

    $('#reviewBody').innerHTML = '' +
      '<div class="review-stage">' +
        '<div class="flash-card' + (s.flipped ? ' is-flipped' : '') + '" data-action="flip-card">' +
          '<div class="flash-inner">' +
            '<div class="flash-face">' +
              '<div class="flash-word">' + esc(w.word) + '</div>' +
              '<div class="flash-meta">' + metaLine(w) + '</div>' +
              '<div class="flash-hint">' + (w.favorite ? '★ 已收藏 · ' : '') + '点击卡片查看释义</div>' +
            '</div>' +
            '<div class="flash-face flash-back">' +
              '<div class="flash-back-word">' + esc(w.word) + '</div>' +
              (w.meaning ? '<div class="flash-meaning">' + esc(w.meaning) + '</div>'
                         : '<div class="flash-meaning" style="color:var(--text-3)">（未填写释义）</div>') +
              (w.sentence ? '<div class="flash-section-label">原文例句</div><div class="flash-quote">' + esc(w.sentence) + '</div>' : '') +
              (w.note ? '<div class="flash-section-label">笔记</div><div class="flash-note">' + esc(w.note) + '</div>' : '') +
              '<div class="flash-meta" style="justify-content:flex-start;margin-top:14px">' + metaLine(w) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        (s.flipped
          ? '<div class="review-actions">' +
              '<button class="grade-btn grade-unknown" data-action="grade" data-result="unknown">不认识<small>10 分钟后再来</small></button>' +
              '<button class="grade-btn grade-fuzzy" data-action="grade" data-result="fuzzy">模糊<small>明天重来</small></button>' +
              '<button class="grade-btn grade-known" data-action="grade" data-result="known">认识<small>拉长间隔</small></button>' +
            '</div>'
          : '<button class="btn btn-primary btn-block" data-action="flip-card">显示释义</button>') +
      '</div>';
  }

  function readReviewFilter() {
    // 筛选控件只存在于复习首页，复习过程中沿用上一次的选择
    if ($('#rvYear')) ui.reviewFilter.year = $('#rvYear').value;
    if ($('#rvSection')) ui.reviewFilter.section = $('#rvSection').value;
    return ui.reviewFilter;
  }

  function startReview(scope) {
    const f = readReviewFilter();
    const queue = V.buildQueue({ scope: scope, year: f.year, section: f.section, limit: 40 });
    if (!queue.length) {
      toast(scope === 'due' ? '当前没有到期的单词' : '没有未掌握的单词');
      return;
    }
    ui.session = {
      queue: queue,
      index: 0,
      flipped: false,
      counts: { known: 0, fuzzy: 0, unknown: 0 },
      finished: false,
      scope: scope,
      history: []
    };
    setView('review');
  }

  function grade(result) {
    const s = ui.session;
    if (!s || s.finished) return;
    const id = s.queue[s.index];
    const snap = V.snapshot(id);   // 先存快照，撤销时要靠它还原
    const r = V.review(id, result);
    if (r) {
      s.counts[result]++;
      s.history.push({ id: id, result: result, snapshot: snap });
    }
    s.index++;
    s.flipped = false;
    if (s.index >= s.queue.length) s.finished = true;
    renderReview();
    renderTabBadge();
  }

  /* 回退一步：还原该词的熟悉度与复习进度、删掉这次记录，然后重新展示它 */
  function undoReview() {
    const s = ui.session;
    if (!s || !s.history.length) return;
    const last = s.history.pop();
    V.undoReview(last.id, last.snapshot);
    if (s.counts[last.result] > 0) s.counts[last.result]--;
    s.index = Math.max(0, s.index - 1);
    s.finished = false;
    s.flipped = true;   // 已经看过答案，直接展示释义，方便重新评分
    renderReview();
    renderTabBadge();
    toast('已回到上一词，可重新评分');
  }

  /* ============================== 统计 ============================== */
  function barList(rows, colorFn) {
    const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
    return '<div class="bar-list">' + rows.map(r => {
      const pct = Math.max(2, Math.round((r.count / max) * 100));
      const color = colorFn ? colorFn(r) : 'var(--blue)';
      return '<div class="bar-row">' +
        '<span class="bar-label" title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%;background:' + color + '"></span></span>' +
        '<span class="bar-value">' + r.count + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderStats() {
    const s = V.stats();
    const body = $('#statsBody');

    if (s.total === 0) {
      body.innerHTML = emptyState(svgIcon('stats'), '还没有可统计的数据',
        '添加几个真题单词后，这里会显示总量、掌握率、年份与题型分布。',
        '<button class="btn btn-primary" data-action="open-add-sheet">添加单词</button>' +
        '<button class="btn" data-action="add-samples">加载示例数据</button>');
      return;
    }

    const levelColors = ['var(--red)', 'var(--orange)', 'var(--blue)', 'var(--green)'];
    body.innerHTML = '' +
      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="v">' + s.total + '</div><div class="k">单词总数</div></div>' +
        '<div class="stat-card"><div class="v" style="color:var(--green)">' + s.mastered + '</div><div class="k">已掌握</div></div>' +
        '<div class="stat-card"><div class="v" style="color:var(--orange)">' + s.due + '</div><div class="k">待复习</div></div>' +
        '<div class="stat-card"><div class="v">' + s.rate + '<small>%</small></div><div class="k">掌握率</div></div>' +
      '</div>' +

      '<div class="block">' +
        '<div class="block-head"><h2 class="block-title">今日复习</h2>' +
          '<span class="list-count">累计 ' + s.totalReviews + ' 次</span></div>' +
        '<div class="card">' +
          '<div class="summary-grid">' +
            '<div class="summary-cell"><div class="v" style="color:var(--green)">' + s.todayCounts.known + '</div><div class="k">认识</div></div>' +
            '<div class="summary-cell"><div class="v" style="color:var(--orange)">' + s.todayCounts.fuzzy + '</div><div class="k">模糊</div></div>' +
            '<div class="summary-cell"><div class="v" style="color:var(--red)">' + s.todayCounts.unknown + '</div><div class="k">不认识</div></div>' +
          '</div>' +
          '<p class="set-hint" style="padding-top:10px">今天共复习 ' + s.reviewedToday + ' 次；未复习过的词 ' + s.fresh + ' 个。</p>' +
        '</div>' +
      '</div>' +

      '<div class="block">' +
        '<div class="block-head"><h2 class="block-title">熟悉程度分布</h2></div>' +
        '<div class="card">' + barList(s.byLevel.map(l => ({ label: l.label, count: l.count })), r => levelColors[s.byLevel.findIndex(x => x.label === r.label)] || 'var(--blue)') + '</div>' +
      '</div>' +

      '<div class="block">' +
        '<div class="block-head"><h2 class="block-title">年份分布</h2>' +
          '<span class="list-count">共 ' + s.byYear.length + ' 个年份</span></div>' +
        '<div class="card">' + barList(s.byYear.map(y => ({ label: y.label, count: y.count }))) + '</div>' +
      '</div>' +

      '<div class="block">' +
        '<div class="block-head"><h2 class="block-title">题型分布</h2></div>' +
        '<div class="card">' + barList(s.bySection.map(x => ({ label: x.label, count: x.count })), () => 'var(--purple)') + '</div>' +
      '</div>' +

      '<div class="block">' +
        '<div class="block-head"><h2 class="block-title">近 7 天复习量</h2></div>' +
        '<div class="card">' + barList(s.trend.slice().reverse().map(t => ({ label: t.label, count: t.count })), () => 'var(--green)') + '</div>' +
      '</div>' +

      '<p class="set-hint">收藏单词 ' + s.favorites + ' 个' + (s.samples ? ' · 示例词条 ' + s.samples + ' 个（非真题，可到设置中删除）' : '') + '。所有数字均由本地实际数据计算。</p>';
  }

  /* ============================== 设置 ============================== */
  function row(action, label, sub, value, extra) {
    return '<button class="set-row' + (extra === 'danger' ? ' danger' : '') + '" data-action="' + action + '">' +
      '<span><span class="set-row-label">' + esc(label) + '</span>' +
      (sub ? '<span class="set-row-sub" style="display:block">' + esc(sub) + '</span>' : '') + '</span>' +
      (value ? '<span class="set-row-value">' + esc(value) + '</span>' : '') +
    '</button>';
  }

  function renderSettings() {
    const s = V.stats();
    const bytes = V.storageSize();
    const kb = bytes ? (bytes / 1024).toFixed(1) + ' KB' : '0 KB';
    const last = (function () {
      const all = V.all();
      if (!all.length) return '暂无数据';
      const t = all.reduce((m, w) => Math.max(m, w.updatedAt || w.createdAt), 0);
      return new Date(t).toLocaleDateString('zh-CN');
    })();

    $('#settingsBody').innerHTML = '' +
      (V.isMemoryOnly()
        ? '<div class="card" style="border:1px solid var(--red)"><p class="set-row-sub" style="color:var(--red)">当前浏览器无法写入本地存储（可能处于无痕模式），数据只在本次会话内有效，请及时导出备份。</p></div>'
        : '') +
      (V.hasLoadError()
        ? '<div class="card" style="border:1px solid var(--red)"><p class="set-row-sub" style="color:var(--red)">检测到本地数据损坏，已备份原始内容到 wordvault.data.v1.broken，当前词库为空。</p></div>'
        : '')

      + '<div class="block"><div class="block-head"><h2 class="block-title">数据概览</h2></div>' +
        '<div class="set-group">' +
          row('noop', '单词条数', null, s.total + ' 个') +
          row('noop', '复习记录', null, s.totalReviews + ' 条') +
          row('noop', '本地占用', null, kb) +
          row('noop', '最近更新', null, last) +
        '</div></div>'

      + '<div class="block"><div class="block-head"><h2 class="block-title">导出</h2></div>' +
        '<div class="set-group">' +
          row('export-file', '导出为 JSON 文件', '包含全部字段与复习进度，可再导入回来') +
          row('export-copy', '复制 JSON 到剪贴板', '适合直接粘到备忘录 / 云笔记') +
        '</div>' +
        '<p class="set-hint">建议定期导出备份。数据只保存在这台设备上，不会上传到任何服务器。</p></div>'

      + '<div class="block"><div class="block-head"><h2 class="block-title">导入</h2></div>' +
        '<div class="set-group">' +
          row('import-file', '选择 JSON 文件导入', '支持 WordVault 导出的文件或词条数组') +
          row('import-paste-toggle', '粘贴 JSON 文本导入', '从剪贴板粘贴内容导入') +
        '</div>' +
        '<div class="set-group" id="importPasteBox" hidden>' +
          '<textarea id="importPaste" rows="5" placeholder=\'粘贴 JSON，例如 {"words":[{"word":"sustainable","meaning":"adj. 可持续的"}]}\'></textarea>' +
          '<div style="padding:0 15px 13px"><button class="btn btn-primary btn-block" data-action="import-paste-run">校验并导入</button></div>' +
        '</div>' +
        '<p class="set-hint">导入前会先校验格式：缺少 word 字段的条目会被跳过并统计，不会覆盖现有数据（除非你选择“清空后替换”）。</p></div>'

      + '<div class="block"><div class="block-head"><h2 class="block-title">示例数据</h2></div>' +
        '<div class="set-group">' +
          row('add-samples', '加载示例词条', '3 条演示数据，非真题原文') +
          (s.samples ? row('remove-samples', '删除示例词条', null, s.samples + ' 个') : '') +
        '</div></div>'

      + '<div class="block"><div class="block-head"><h2 class="block-title">危险操作</h2></div>' +
        '<div class="set-group">' +
          row('clear-logs', '清空复习记录', '保留单词，仅清除复习历史与进度统计', null, 'danger') +
          row('clear-all', '清空全部数据', '删除全部单词与复习记录，需二次确认', null, 'danger') +
        '</div>' +
        '<p class="set-hint">清空不可恢复，操作前请先导出备份。</p></div>'

      + '<div class="block"><div class="block-head"><h2 class="block-title">关于</h2></div>' +
        '<div class="set-group"><div class="about-box">' +
          '<b>WordVault v1.0</b><br>考研英语二真题单词收集器。<br>' +
          '纯前端网页，无后端、无登录、无网络请求，数据保存在本机 localStorage。' +
          'iPhone 上可「分享 → 添加到主屏幕」当作独立 App 使用，支持离线打开。' +
        '</div></div></div>';
  }

  /* ============================ 编辑面板 ============================ */
  function buildLevelSegmented() {
    $('#fLevel').innerHTML = V.LEVELS.map(l =>
      '<button type="button" data-action="pick-level" data-level="' + l.value + '" class="' + (l.value === 0 ? 'is-active' : '') + '">' + l.label + '</button>'
    ).join('');
  }
  function setSegmentedLevel(level) {
    $$('#fLevel button').forEach(b => b.classList.toggle('is-active', Number(b.dataset.level) === Number(level)));
  }
  function currentLevel() {
    const active = $('#fLevel button.is-active');
    return active ? Number(active.dataset.level) : 0;
  }
  function toggleReadingRow() {
    // Part / 文章编号只对阅读理解有意义，其他题型自动隐藏，避免填错
    $('#readingRow').hidden = $('#fSection').value !== 'reading';
  }

  function openSheet(id) {
    ui.editingId = id || null;
    const w = id ? V.get(id) : null;
    if (id && !w) { toast('单词不存在'); return; }

    $('#sheetTitle').textContent = w ? '编辑单词' : '添加单词';
    $('#sheetDelete').hidden = !w;
    $('#sheetMeta').textContent = w
      ? '创建于 ' + new Date(w.createdAt).toLocaleDateString('zh-CN') +
        ' · 已复习 ' + w.review.reviews + ' 次' +
        (w.review.lastReviewAt ? ' · 上次 ' + new Date(w.review.lastReviewAt).toLocaleDateString('zh-CN') : '')
      : '年份、题型、例句等字段都可以留空，之后再补。';

    $('#fWord').value = w ? w.word : '';
    $('#fMeaning').value = w ? w.meaning : '';
    $('#fYear').value = w ? w.year : '';
    $('#fSection').value = w ? w.section : '';
    $('#fPart').value = w ? w.part : '';
    $('#fPassage').value = w ? w.passage : '';
    $('#fParagraph').value = w ? w.paragraph : '';
    $('#fSentence').value = w ? w.sentence : '';
    $('#fNote').value = w ? w.note : '';
    $('#fFavorite').checked = w ? w.favorite : false;
    setSegmentedLevel(w ? w.level : 0);
    toggleReadingRow();

    const sheet = $('#wordSheet');
    const backdrop = $('#sheetBackdrop');
    sheet.hidden = false; backdrop.hidden = false;
    void sheet.offsetHeight; // 强制重排，保证从屏外滑入的过渡能触发
    sheet.classList.add('is-open');
    backdrop.classList.add('is-open');
  }

  function closeSheet() {
    const sheet = $('#wordSheet');
    const backdrop = $('#sheetBackdrop');
    sheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    setTimeout(() => { sheet.hidden = true; backdrop.hidden = true; }, 260);
    ui.editingId = null;
  }

  function saveSheet() {
    const word = $('#fWord').value.trim();
    if (!word) { toast('请填写英文单词'); $('#fWord').focus(); return; }
    const payload = {
      word: word,
      meaning: $('#fMeaning').value,
      year: $('#fYear').value,
      section: $('#fSection').value,
      part: $('#fPart').value,
      passage: $('#fPassage').value,
      paragraph: $('#fParagraph').value,
      sentence: $('#fSentence').value,
      note: $('#fNote').value,
      favorite: $('#fFavorite').checked,
      level: currentLevel()
    };
    if (ui.editingId) {
      const r = V.update(ui.editingId, payload);
      if (!r) { toast('保存失败：单词不能为空'); return; }
      toast('已保存修改');
    } else {
      const r = V.add(payload);
      if (!r) { toast('保存失败：请检查单词内容'); return; }
      toast('已添加到单词本');
    }
    closeSheet();
    renderAll();
  }

  /* ============================ 通用对话框 ============================ */
  function closeDialog() {
    const b = $('#dialogBackdrop');
    b.classList.remove('is-open');
    setTimeout(() => { b.hidden = true; }, 200);
  }

  /* opts: { title, text, field:{placeholder,type,value}, actions:[{label,kind,onClick,keep}] } */
  function showDialog(opts) {
    $('#dialogTitle').textContent = opts.title || '提示';
    $('#dialogText').textContent = opts.text || '';
    $('#dialogFields').innerHTML = opts.field
      ? '<div class="field"><input id="dialogInput" type="' + (opts.field.type || 'text') + '" placeholder="' + esc(opts.field.placeholder || '') + '"></div>'
      : '';
    const actions = opts.actions || [{ label: '好', kind: 'primary' }];
    $('#dialogActions').innerHTML = actions.map((a, i) =>
      '<button type="button" class="' + (a.kind === 'primary' ? 'primary' : a.kind === 'destructive' ? 'destructive' : '') + '" data-dialog-index="' + i + '">' + esc(a.label) + '</button>'
    ).join('');

    const backdrop = $('#dialogBackdrop');
    backdrop.hidden = false;
    void backdrop.offsetHeight;
    backdrop.classList.add('is-open');

    const input = $('#dialogInput');
    if (input) {
      input.value = opts.field.value || '';
      if (opts.field.focus !== false) setTimeout(() => input.focus(), 260);
    }
    $('#dialogActions').onclick = (e) => {
      const btn = e.target.closest('[data-dialog-index]');
      if (!btn) return;
      const a = actions[Number(btn.dataset.dialogIndex)];
      const val = input ? input.value : '';
      if (!a.keep) closeDialog();
      if (a.onClick) a.onClick(val);
    };
  }

  function pickOne(title, options, current, onPick) {
    showDialog({
      title: title,
      text: '',
      actions: options.map(o => ({
        label: (String(o.value) === String(current) ? '✓ ' : '') + o.label,
        onClick: () => onPick(o.value)
      })).concat([{ label: '取消' }])
    });
  }

  /* ============================ 导入 / 导出 ============================ */
  function downloadJSON(text, filename) {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast('已导出 ' + filename);
    } catch (e) {
      toast('导出失败，请改用「复制 JSON」');
    }
  }

  function copyText(text) {
    const done = () => toast('已复制到剪贴板');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('复制失败，请手动选择文本'); }
    ta.remove();
  }

  function handleImportText(text, sourceLabel) {
    const parsed = V.parseImport(text);
    if (!parsed.ok) {
      showDialog({
        title: '导入失败',
        text: parsed.error,
        actions: [{ label: '知道了', kind: 'primary' }]
      });
      return;
    }
    const invalidNote = parsed.invalid && parsed.invalid.length
      ? '\n\n跳过 ' + parsed.invalid.length + ' 条无效数据（第 ' + parsed.invalid.slice(0, 5).map(x => x.index).join('、') +
        (parsed.invalid.length > 5 ? '…' : '') + ' 条）。'
      : '';
    const existing = V.all().length;
    showDialog({
      title: '确认导入',
      text: (sourceLabel ? sourceLabel + '：' : '') + '共解析到 ' + parsed.words.length + ' 条有效词条，当前已有 ' + existing + ' 条。' + invalidNote +
        '\n\n合并导入：跳过重复（同单词 + 同年份 + 同题型）。',
      actions: [
        { label: '合并导入（保留现有）', kind: 'primary', onClick: () => runImport(parsed.words, 'merge') },
        { label: '合并并覆盖同名词条', onClick: () => runImport(parsed.words, 'update') },
        { label: '清空后替换全部', kind: 'destructive', onClick: () => confirmReplace(parsed.words) },
        { label: '取消' }
      ]
    });
  }

  function confirmReplace(words) {
    showDialog({
      title: '清空后替换？',
      text: '将删除现有 ' + V.all().length + ' 个单词（含复习进度），再导入 ' + words.length + ' 条新数据。此操作无法撤销。',
      actions: [
        { label: '我已导出备份，替换', kind: 'destructive', onClick: () => runImport(words, 'replace') },
        { label: '取消' }
      ]
    });
  }

  function runImport(words, mode) {
    const r = V.importWords(words, mode);
    renderAll();
    showDialog({
      title: '导入完成',
      text: '新增 ' + r.added + ' 条' +
        (r.updated ? '，更新 ' + r.updated + ' 条' : '') +
        (r.skipped ? '，跳过重复 ' + r.skipped + ' 条' : '') +
        '。\n当前共 ' + r.total + ' 个单词。',
      actions: [{ label: '好', kind: 'primary' }]
    });
  }

  /* ============================ 清空数据 ============================ */
  function clearLogsFlow() {
    const n = V.stats().totalReviews;
    if (!n) { toast('没有复习记录'); return; }
    showDialog({
      title: '清空复习记录？',
      text: '将删除 ' + n + ' 条复习记录，并重置所有单词的复习进度（熟悉程度保持不变）。单词本身会保留。',
      actions: [
        { label: '清空复习记录', kind: 'destructive', onClick: () => { V.clear('logs'); renderAll(); toast('复习记录已清空'); } },
        { label: '取消' }
      ]
    });
  }

  function clearAllFlow() {
    const s = V.stats();
    if (!s.total && !s.totalReviews) { toast('当前没有数据'); return; }
    showDialog({
      title: '清空全部数据？',
      text: '将删除 ' + s.total + ' 个单词与 ' + s.totalReviews + ' 条复习记录，且无法恢复。\n建议先到上面「导出」备份一份。',
      actions: [
        { label: '继续', kind: 'destructive', keep: true, onClick: clearAllConfirm },
        { label: '取消' }
      ]
    });
  }

  function clearAllConfirm() {
    closeDialog();
    setTimeout(() => {
      showDialog({
        title: '最后确认',
        text: '请输入“清空”两个字以完成删除。',
        field: { placeholder: '清空' },
        actions: [
          {
            label: '确认清空', kind: 'destructive', onClick: (val) => {
              if (String(val).trim() !== '清空') { toast('输入不匹配，已取消'); return; }
              const n = V.clear('all');
              ui.selection.clear();
              ui.session = null;
              renderAll();
              toast('已清空 ' + n + ' 个单词');
            }
          },
          { label: '取消' }
        ]
      });
    }, 220);
  }

  /* ============================ 批量管理 ============================ */
  function selectedIds() { return Array.from(ui.selection); }

  function bulkDelete() {
    const ids = selectedIds();
    if (!ids.length) { toast('请先勾选单词'); return; }
    showDialog({
      title: '删除 ' + ids.length + ' 个单词？',
      text: '删除后无法恢复，需要重新录入。',
      actions: [
        {
          label: '删除', kind: 'destructive', onClick: () => {
            V.remove(ids);
            ui.selection.clear();
            renderAll();
            toast('已删除 ' + ids.length + ' 个单词');
          }
        },
        { label: '取消' }
      ]
    });
  }

  /* ============================ 事件绑定 ============================ */
  const ACTIONS = {
    'start-review': () => startReview('due'),
    'review-all-unmastered': () => startReview('unmastered'),
    'quit-review': () => {
      if (!ui.session) { setView('home'); return; }
      showDialog({
        title: '结束本轮复习？',
        text: '已经标记过的单词会保留复习进度。',
        actions: [
          { label: '结束', kind: 'destructive', onClick: () => { ui.session = null; renderReview(); } },
          { label: '继续复习' }
        ]
      });
    },
    'flip-card': () => {
      // 只在正面时翻到背面：已翻开时点击不收回，避免阅读/滚动时误触
      if (!ui.session || ui.session.finished || ui.session.flipped) return;
      ui.session.flipped = true;
      renderReview();
    },
    'grade': (el) => grade(el.dataset.result),
    'undo-review': undoReview,

    'go-words': () => setView('words'),
    'open-add-sheet': () => openSheet(null),
    'close-sheet': closeSheet,
    'save-word': saveSheet,
    'pick-level': (el) => setLevelOf(el.dataset.level),
    'delete-current': () => {
      const id = ui.editingId;
      if (!id) return;
      showDialog({
        title: '删除这个单词？',
        text: '删除后无法恢复。',
        actions: [
          {
            label: '删除', kind: 'destructive', onClick: () => {
              V.remove([id]);
              closeSheet();
              renderAll();
              toast('已删除');
            }
          },
          { label: '取消' }
        ]
      });
    },
    'quick-add': () => {
      const wordEl = $('#quickWord');
      const meaningEl = $('#quickMeaning');
      const word = wordEl.value.trim();
      if (!word) { toast('请先填写英文单词'); wordEl.focus(); return; }
      const r = V.add({ word: word, meaning: meaningEl.value.trim() });
      if (!r) { toast('添加失败，请检查单词内容'); return; }
      wordEl.value = '';
      meaningEl.value = '';
      wordEl.focus();
      renderAll();
      toast('已添加：' + r.word);
    },

    'toggle-select': () => {
      ui.selectMode = !ui.selectMode;
      if (!ui.selectMode) ui.selection.clear();
      renderWords();
    },
    'row-tap': (el) => {
      const id = el.dataset.id;
      if (ui.selectMode) {
        if (ui.selection.has(id)) ui.selection.delete(id); else ui.selection.add(id);
        renderWords();
      } else {
        openSheet(id);
      }
    },
    'toggle-fav': (el) => {
      const w = V.get(el.dataset.id);
      if (!w) return;
      V.setFavorite([w.id], !w.favorite);
      renderAll();
      toast(w.favorite ? '已取消收藏' : '已加入收藏');
    },
    'clear-search': () => {
      $('#searchInput').value = '';
      $('#searchClear').hidden = true;
      ui.filter.q = '';
      renderWords();
    },
    'reset-filter': () => {
      ui.filter = { q: '', year: 'all', section: 'all', level: 'all', favorite: false, sort: 'recent' };
      $('#searchInput').value = '';
      $('#searchClear').hidden = true;
      renderWords();
    },
    'filter-year': () => {
      const opts = [{ value: 'all', label: '全部年份' }].concat(V.years().map(y => ({ value: y, label: y })));
      pickOne('按年份筛选', opts, ui.filter.year, (v) => { ui.filter.year = v; renderWords(); });
    },
    'filter-level': () => {
      const opts = [{ value: 'all', label: '全部熟悉度' }].concat(V.LEVELS.map(l => ({ value: l.value, label: l.label })));
      pickOne('按熟悉程度筛选', opts, ui.filter.level, (v) => { ui.filter.level = v; renderWords(); });
    },
    'filter-section': () => {
      const opts = [{ value: 'all', label: '全部题型' }].concat(V.SECTIONS.map(s => ({ value: s.key, label: s.label })));
      pickOne('按题型筛选', opts, ui.filter.section, (v) => { ui.filter.section = v; renderWords(); });
    },
    'sort-words': () => {
      const opts = [
        { value: 'recent', label: '最新添加' },
        { value: 'oldest', label: '最早添加' },
        { value: 'az', label: '单词 A-Z' },
        { value: 'level', label: '熟悉程度（生→熟）' },
        { value: 'due', label: '待复习优先' },
        { value: 'year', label: '年份（新→旧）' }
      ];
      pickOne('排序方式', opts, ui.filter.sort, (v) => { ui.filter.sort = v; renderWords(); });
    },
    'toggle-fav-filter': () => {
      ui.filter.favorite = !ui.filter.favorite;
      renderWords();
    },
    'bulk-all': () => {
      const rows = V.list(ui.filter);
      const allSelected = rows.length > 0 && rows.every(w => ui.selection.has(w.id));
      if (allSelected) rows.forEach(w => ui.selection.delete(w.id));
      else rows.forEach(w => ui.selection.add(w.id));
      renderWords();
    },
    'bulk-fav-on': () => { const ids = selectedIds(); if (!ids.length) return toast('请先勾选单词'); V.setFavorite(ids, true); renderAll(); toast('已收藏 ' + ids.length + ' 个'); },
    'bulk-fav-off': () => { const ids = selectedIds(); if (!ids.length) return toast('请先勾选单词'); V.setFavorite(ids, false); renderAll(); toast('已取消收藏 ' + ids.length + ' 个'); },
    'bulk-master': () => { const ids = selectedIds(); if (!ids.length) return toast('请先勾选单词'); V.setLevel(ids, 3); renderAll(); toast('已设为已掌握 ' + ids.length + ' 个'); },
    'bulk-delete': bulkDelete,

    'export-file': () => downloadJSON(V.exportJSON(), 'wordvault-' + stamp() + '.json'),
    'export-copy': () => copyText(V.exportJSON()),
    'import-file': () => $('#importFile').click(),
    'import-paste-toggle': () => {
      const box = $('#importPasteBox');
      box.hidden = !box.hidden;
      if (!box.hidden) $('#importPaste').focus();
    },
    'import-paste-run': () => {
      const ta = $('#importPaste');
      const text = ta.value.trim();
      if (!text) { toast('请先粘贴 JSON 内容'); return; }
      handleImportText(text, '粘贴内容');
    },
    'add-samples': () => {
      const n = V.addSamples();
      renderAll();
      toast(n ? '已添加 ' + n + ' 条示例词条（非真题）' : '示例词条已存在');
    },
    'remove-samples': () => {
      const s = V.stats();
      if (!s.samples) { toast('没有示例词条'); return; }
      showDialog({
        title: '删除示例词条？',
        text: '将删除 ' + s.samples + ' 条示例数据，你自己录入的单词不受影响。',
        actions: [
          { label: '删除', kind: 'destructive', onClick: () => { const n = V.removeSamples(); renderAll(); toast('已删除 ' + n + ' 条示例'); } },
          { label: '取消' }
        ]
      });
    },
    'clear-logs': clearLogsFlow,
    'clear-all': clearAllFlow,
    'noop': () => {}
  };

  function setLevelOf(level) {
    setSegmentedLevel(level);
  }

  document.addEventListener('click', (e) => {
    if (e.target.id === 'sheetBackdrop') { closeSheet(); return; }
    if (e.target.id === 'dialogBackdrop') { closeDialog(); return; }

    const tabBtn = e.target.closest('.tab');
    if (tabBtn) { setView(tabBtn.dataset.tab); return; }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (!ACTIONS[action]) return;
    e.preventDefault();
    ACTIONS[action](el, e);
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'fSection') toggleReadingRow();
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'searchInput') {
      ui.filter.q = e.target.value.trim();
      $('#searchClear').hidden = !e.target.value;
      clearTimeout(ACTIONS._searchTimer);
      ACTIONS._searchTimer = setTimeout(renderWords, 140);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#dialogBackdrop').hidden) closeDialog();
      else if (!$('#wordSheet').hidden) closeSheet();
    }
    if (e.key === 'Enter' && e.target.id === 'quickWord') {
      e.preventDefault();
      if ($('#quickMeaning').value.trim()) ACTIONS['quick-add']();
      else $('#quickMeaning').focus();
    }
    if (e.key === 'Enter' && e.target.id === 'quickMeaning') {
      e.preventDefault();
      ACTIONS['quick-add']();
    }
  });

  /* --------------------------- 初始化 --------------------------- */
  function init() {
    V.load();

    // 下拉选择：题型 / Part
    $('#fSection').innerHTML = '<option value="">未填写</option>' +
      V.SECTIONS.map(s => '<option value="' + s.key + '">' + s.label + '</option>').join('');
    $('#fPart').innerHTML = '<option value="">未填写</option>' +
      V.PARTS.map(p => '<option value="' + p + '">' + p + '</option>').join('');
    buildLevelSegmented();

    // 图标统一注入（齿轮、书本等图形只在 ICON 里定义一次）
    $$('.tab').forEach(tab => {
      const svg = tab.querySelector('svg');
      if (svg) svg.innerHTML = ICON[TAB_ICON[tab.dataset.tab]] || '';
    });
    const searchIcon = $('.search-icon');
    if (searchIcon) searchIcon.innerHTML = ICON.search;

    // 隐藏的导入文件输入
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'importFile';
    fileInput.accept = 'application/json,.json,text/plain';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => handleImportText(String(reader.result), file.name);
      reader.onerror = () => toast('文件读取失败');
      reader.readAsText(file);
      fileInput.value = '';
    });
    document.body.appendChild(fileInput);

    // 底部导航与其余按钮已通过事件委托绑定；初始化路由
    const hashView = (location.hash || '').replace('#/', '');
    setView(VIEWS.indexOf(hashView) >= 0 ? hashView : 'home', { silent: true });

    // 滚动后顶栏顶部的标题淡入；用滞回阈值避免在临界点反复触发
    $$('.view-scroll').forEach(scroller => {
      const head = scroller.querySelector('.page-head');
      if (!head) return;
      scroller.addEventListener('scroll', () => {
        const top = scroller.scrollTop;
        const compact = head.classList.contains('is-compact');
        if (!compact && top > 28) head.classList.add('is-compact');
        else if (compact && top < 10) head.classList.remove('is-compact');
      }, { passive: true });
    });

    window.addEventListener('resize', positionDockPill);
    window.addEventListener('orientationchange', () => setTimeout(positionDockPill, 120));

    // 离线缓存（仅在 http/https 下可用；本地直接打开文件时跳过）
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
