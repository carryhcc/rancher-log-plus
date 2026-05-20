(() => {
  if (!window.RLS) {
    window.RLS = {
      STATE: {
        mountedModal: null,
        rawView: null,
        prettyView: null,
        controls: null,
        observer: null,
        bodyObserver: null,
        titleObserver: null,
        refreshTimer: null,
        lines: [],
        mode: "raw",
        level: localStorage.getItem("rls_level") || "ALL",
        keyword: localStorage.getItem("rls_keyword") || "",
        pauseScroll: false,
        keydownHandler: null,
        host: null,
        backdrop: null,
        modal: null,
        rawOriginalDisplay: "",
        compiledQueryKey: "",
        compiledQuery: null,
        filteredCacheKey: "",
        filteredLines: null,
      },
      LEVELS: ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"],
      REFRESH_DELAY: 60,
      MAX_RENDER_LINES: 5000,
      MAX_CACHE_LIMIT: 20000,
      I18N: {
        en: {
          rawView: "Raw view",
          rawCached: "Raw view (cached {total} lines)",
          beautifyLogs: "Beautify Logs",
          beautified: "Beautified ({total} lines)",
          unread: "No logs loaded",
          cachedLogs: "Cached {total} log lines",
          cachedFiltered: "Cached {total} lines | {matched} matched",
          filterPlaceholder: "Filter... supports and, not, /regex/i",
          pauseScroll: "Pause Scroll",
          resumeScroll: "Resume Scroll",
          clearLogs: "Clear Logs",
          downloadLogs: "Download Logs",
          close: "Close",
          empty: "No logs match the current filter",
          renderNotice: "Showing the latest {rendered} of {total} matched lines",
          noDownload: "No logs match the current filter.",
        },
        zh: {
          rawView: "原始视图",
          rawCached: "原始视图 (已缓存 {total} 行)",
          beautifyLogs: "美化日志",
          beautified: "已开启美化 ({total} 行)",
          unread: "未读取到日志",
          cachedLogs: "已缓存 {total} 行日志",
          cachedFiltered: "已缓存 {total} 行 | 过滤匹配 {matched} 行",
          filterPlaceholder: "过滤...支持 and、not、/regex/i",
          pauseScroll: "暂停滚动",
          resumeScroll: "恢复滚动",
          clearLogs: "清除日志",
          downloadLogs: "下载日志",
          close: "关闭",
          empty: "当前过滤条件下没有日志",
          renderNotice: "仅显示匹配的 {total} 行中的后 {rendered} 行",
          noDownload: "当前过滤条件下没有可下载的日志！",
        },
      },
    };
  }

  const { RLS } = window;

  const { STATE, LEVELS, REFRESH_DELAY, MAX_RENDER_LINES, MAX_CACHE_LIMIT } = RLS;

  RLS.getLocale = RLS.getLocale || function() {
    return /^zh\b/i.test(navigator.language || "") ? "zh" : "en";
  };

  RLS.t = RLS.t || function(key, params = {}) {
    const locale = RLS.getLocale();
    const text = RLS.I18N[locale]?.[key] || RLS.I18N.en[key] || key;
    return Object.entries(params).reduce(
      (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
      text
    );
  };

  RLS.isSupportedPage = RLS.isSupportedPage || function() {
    return /Rancher/i.test(document.title || "");
  };

  RLS.invalidateFilterCache = RLS.invalidateFilterCache || function() {
    STATE.filteredCacheKey = "";
    STATE.filteredLines = null;
  };

  RLS.buildCompiledTerm = RLS.buildCompiledTerm || function(filterStr) {
    const regexMatch = filterStr.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
      try {
        const [, pattern, flags] = regexMatch;
        return { type: "regex", regex: new RegExp(pattern, flags) };
      } catch (e) {
        // Invalid regex falls back to plain text matching.
      }
    }

    return { type: "text", text: filterStr.toLowerCase() };
  };

  RLS.getCompiledQuery = RLS.getCompiledQuery || function() {
    if (STATE.compiledQueryKey === STATE.keyword && STATE.compiledQuery) {
      return STATE.compiledQuery;
    }

    const { includes, excludes } = RLS.parseQuery(STATE.keyword);
    STATE.compiledQueryKey = STATE.keyword;
    STATE.compiledQuery = {
      includes: includes.map((value) => RLS.buildCompiledTerm(value)),
      excludes: excludes.map((value) => RLS.buildCompiledTerm(value)),
    };
    return STATE.compiledQuery;
  };

  RLS.matchesCompiledTerm = RLS.matchesCompiledTerm || function(text, term) {
    if (term.type === "regex") {
      term.regex.lastIndex = 0;
      return term.regex.test(text);
    }
    return text.toLowerCase().includes(term.text);
  };

  RLS.escapeRegExp = RLS.escapeRegExp || function(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  RLS.getHighlightTerms = RLS.getHighlightTerms || function() {
    if (!STATE.keyword) {
      return [];
    }
    return RLS.getCompiledQuery().includes;
  };

  RLS.buildHighlightRanges = RLS.buildHighlightRanges || function(text, terms) {
    const ranges = [];
    const lowerText = text.toLowerCase();

    for (const term of terms) {
      if (term.type === "regex") {
        const baseFlags = term.regex.flags.replace(/g/g, "");
        const regex = new RegExp(term.regex.source, `${baseFlags}g`);
        let match = regex.exec(text);
        while (match) {
          const matchedText = match[0] || "";
          if (matchedText.length > 0) {
            ranges.push([match.index, match.index + matchedText.length]);
          } else {
            regex.lastIndex += 1;
          }
          match = regex.exec(text);
        }
        continue;
      }

      if (!term.text) {
        continue;
      }

      let start = 0;
      while (start < lowerText.length) {
        const index = lowerText.indexOf(term.text, start);
        if (index === -1) {
          break;
        }
        ranges.push([index, index + term.text.length]);
        start = index + term.text.length;
      }
    }

    if (ranges.length === 0) {
      return [];
    }

    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [ranges[0]];
    for (let i = 1; i < ranges.length; i += 1) {
      const current = ranges[i];
      const previous = merged[merged.length - 1];
      if (current[0] <= previous[1]) {
        previous[1] = Math.max(previous[1], current[1]);
      } else {
        merged.push(current);
      }
    }
    return merged;
  };

  RLS.highlightText = RLS.highlightText || function(text) {
    const safeText = text || "";
    const terms = RLS.getHighlightTerms();
    if (terms.length === 0) {
      return RLS.escapeHtml(safeText);
    }

    const ranges = RLS.buildHighlightRanges(safeText, terms);
    if (ranges.length === 0) {
      return RLS.escapeHtml(safeText);
    }

    let cursor = 0;
    let html = "";
    for (const [start, end] of ranges) {
      html += RLS.escapeHtml(safeText.slice(cursor, start));
      html += `<mark class="rancher-log-style__highlight">${RLS.escapeHtml(safeText.slice(start, end))}</mark>`;
      cursor = end;
    }
    html += RLS.escapeHtml(safeText.slice(cursor));
    return html;
  };

  RLS.getFilteredLines = RLS.getFilteredLines || function() {
    const lastLineId = STATE.lines[STATE.lines.length - 1]?.id || "";
    const cacheKey = `${STATE.level}\u0000${STATE.keyword}\u0000${STATE.lines.length}\u0000${lastLineId}`;
    if (STATE.filteredCacheKey === cacheKey && STATE.filteredLines) {
      return STATE.filteredLines;
    }

    const matchedLines = [];
    for (const line of STATE.lines) {
      if (RLS.matchesFilters(line)) {
        matchedLines.push(line);
      }
    }

    STATE.filteredCacheKey = cacheKey;
    STATE.filteredLines = matchedLines;
    return matchedLines;
  };

  RLS.escapeHtml = RLS.escapeHtml || function(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  };

  RLS.getElementLogText = RLS.getElementLogText || function(element) {
    if (!element) {
      return "";
    }

    if (element.matches?.("textarea, input")) {
      return element.value || "";
    }

    if (element === STATE.rawView && element.children && element.children.length > 0) {
      return Array.from(element.children)
        .map((child) => child.textContent || child.innerText || "")
        .join("\n");
    }

    return element.textContent || element.innerText || "";
  };

  RLS.getModalTitle = RLS.getModalTitle || function(element) {
    const ownText = element.textContent?.trim() || "";
    if (ownText.includes("日志查看") || ownText.includes("View Logs") || ownText.includes("Logs")) {
      return "日志查看";
    }

    const headers = element.querySelectorAll("h1, h2, h3, h4, .modal-title, .title, header");
    for (const header of headers) {
      const text = header.textContent?.trim() || "";
      if (text.includes("日志查看") || text.includes("View Logs") || text.includes("Logs")) {
        return text;
      }
    }
    return "";
  };

  RLS.findActiveLogModal = RLS.findActiveLogModal || function() {
    const logBody = document.querySelector("pre.log-body");
    if (logBody) {
      return logBody.closest(".container-log, .modal-container, .modal-overlay") || logBody.parentElement;
    }

    const candidates = document.querySelectorAll(".container-log, .modal-container, .modal-overlay, body *");
    for (const element of candidates) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (!RLS.getModalTitle(element)) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width >= 300 && rect.height >= 80) {
        return element;
      }
    }
    return null;
  };

  RLS.scoreRawCandidate = RLS.scoreRawCandidate || function(element) {
    if (!(element instanceof HTMLElement)) {
      return -1;
    }

    if (element.matches("pre.log-body")) {
      return RLS.getElementLogText(element).trim() ? 10000 : -1;
    }

    const text = RLS.getElementLogText(element).trim();
    if (!text || text.length < 60) {
      return -1;
    }
    if (text.includes("日志查看") || element.querySelector(".rancher-log-style__inline-bar")) {
      return -1;
    }
    if (!element.matches("textarea") && element.querySelector("button, input, select, textarea")) {
      return -1;
    }

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const lines = text.split(/\n/).length;
    const darkScore = style.backgroundColor.includes("rgb(0, 0, 0)") ? 80 : 0;
    const scrollScore = element.scrollHeight > element.clientHeight + 20 ? 60 : 0;
    const areaScore = Math.min(rect.width * rect.height / 5000, 120);
    const lineScore = Math.min(lines, 120);
    const overflowScore = style.overflowY === "auto" || style.overflowY === "scroll" ? 40 : 0;

    return darkScore + scrollScore + areaScore + lineScore + overflowScore;
  };

  RLS.findRawLogContainer = RLS.findRawLogContainer || function(modal) {
    const logBody = modal.querySelector("pre.log-body");
    if (logBody) {
      return logBody;
    }

    const candidates = modal.querySelectorAll("div, pre, code, section, textarea");
    let best = null;
    let bestScore = -1;

    for (const element of candidates) {
      const score = RLS.scoreRawCandidate(element);
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }

    return bestScore > 120 ? best : null;
  };

  RLS.matchTextOrRegex = RLS.matchTextOrRegex || function(text, filterStr) {
    if (!filterStr) return true;
    return RLS.matchesCompiledTerm(text, RLS.buildCompiledTerm(filterStr));
  };

  RLS.parseQuery = RLS.parseQuery || function(queryString) {
    const includes = [];
    const excludes = [];
    if (!queryString) {
      return { includes, excludes };
    }

    let str = queryString.trim();
    let firstIsExclude = false;
    if (str.toLowerCase().startsWith("not ")) {
      firstIsExclude = true;
      str = str.slice(4).trim();
    } else if (str.toLowerCase().startsWith("and ")) {
      str = str.slice(4).trim();
    }

    const parts = str.split(/\s+(and|not)\s+/i);
    const firstVal = parts[0]?.trim();
    if (firstVal) {
      if (firstIsExclude) {
        excludes.push(firstVal);
      } else {
        includes.push(firstVal);
      }
    }

    for (let i = 1; i < parts.length; i += 2) {
      const operator = parts[i].toLowerCase();
      const value = parts[i + 1]?.trim();
      if (value) {
        if (operator === "not") {
          excludes.push(value);
        } else {
          includes.push(value);
        }
      }
    }

    return { includes, excludes };
  };

  RLS.parseLine = RLS.parseLine || function(line, index, precedingLine = null) {
    const timestampMatch = line.match(
      /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)/
    );
    const timestamp = timestampMatch ? timestampMatch[1] : "";
    const isStack = /^\s*at\b/.test(line) || /^\s*\.\.\./.test(line);
    const isErrorDetail = /Exception|Error:|Caused by:/.test(line);
    const isBlank = line.trim() === "";

    if (!timestamp && !isStack && !isErrorDetail && !isBlank && precedingLine) {
      precedingLine.raw += line;
      precedingLine.message += line;
      return null;
    }

    const rest = timestamp ? line.slice(timestamp.length).trimStart() : line;
    let level = "PLAIN";
    if (timestamp) {
      const levelMatch = line.match(/\b(ERROR|WARN|INFO|DEBUG|TRACE)\b/);
      level = levelMatch ? levelMatch[1] : "PLAIN";
    } else if (isStack || isErrorDetail) {
      level = precedingLine && (precedingLine.level === "ERROR" || precedingLine.level === "WARN")
        ? precedingLine.level
        : "ERROR";
    } else {
      level = precedingLine ? precedingLine.level : "PLAIN";
    }

    return {
      id: `${index}-${line.length}`,
      raw: line,
      level,
      timestamp,
      message: rest,
      isStack,
      isErrorDetail,
    };
  };

  RLS.parseNewLines = RLS.parseNewLines || function() {
    if (!STATE.rawView) {
      return [];
    }

    const children = STATE.rawView.children || [];
    if (children.length === 0) {
      STATE.lines = [];
      RLS.invalidateFilterCache();
      return [];
    }

    const newLines = [];
    let i = children.length - 1;
    const pendingNodes = [];

    while (i >= 0) {
      const child = children[i];
      if (child.__parsed) {
        break;
      }
      pendingNodes.push(child);
      i--;
    }

    pendingNodes.reverse();
    pendingNodes.forEach((child) => {
      child.__parsed = true;
      const text = RLS.getElementLogText(child);
      const sublines = text.split(/\r?\n/);
      sublines.forEach((line) => {
        const preceding = newLines[newLines.length - 1] || STATE.lines[STATE.lines.length - 1] || null;
        const parsed = RLS.parseLine(line, STATE.lines.length + newLines.length, preceding);
        if (parsed) {
          newLines.push(parsed);
        }
      });
    });

    return newLines;
  };

  RLS.createRowElement = RLS.createRowElement || function(line) {
    const classes = [
      "rancher-log-style__line",
      `is-${line.level.toLowerCase()}`,
      line.isStack ? "is-stack" : "",
      line.isErrorDetail ? "is-detail" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const parts = [];
    if (line.timestamp) {
      parts.push(`<span class="rancher-log-style__timestamp">${RLS.highlightText(line.timestamp)}</span>`);
    }
    if (line.level !== "PLAIN") {
      parts.push(`<span class="rancher-log-style__level">${RLS.highlightText(line.level)}</span>`);
    }
    parts.push(`<span class="rancher-log-style__message">${RLS.highlightText(line.message)}</span>`);

    const div = document.createElement("div");
    div.className = classes;
    div.setAttribute("data-line-id", line.id);
    div.innerHTML = parts.join("");
    return div;
  };

  RLS.createLevelSelect = RLS.createLevelSelect || function() {
    const root = document.createElement("div");
    root.className = "rancher-log-style__level-select";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "rancher-log-style__level-trigger";

    const label = document.createElement("span");
    label.className = "rancher-log-style__level-trigger-label";
    label.textContent = STATE.level;

    const chevron = document.createElement("span");
    chevron.className = "rancher-log-style__level-trigger-icon";
    chevron.textContent = "⌄";

    button.appendChild(label);
    button.appendChild(chevron);

    const menu = document.createElement("div");
    menu.className = "rancher-log-style__level-menu";

    const setValue = (value) => {
      STATE.level = value;
      localStorage.setItem("rls_level", STATE.level);
      RLS.invalidateFilterCache();
      label.textContent = value;
      menu.querySelectorAll(".rancher-log-style__level-option").forEach((option) => {
        option.classList.toggle("is-selected", option.dataset.value === value);
      });
      root.classList.remove("is-open");
      RLS.renderPrettyLines();
      RLS.updateStatusText();
    };

    for (const value of ["ALL", ...LEVELS]) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "rancher-log-style__level-option";
      option.dataset.value = value;
      option.textContent = value;
      option.classList.toggle("is-selected", value === STATE.level);
      option.addEventListener("click", () => setValue(value));
      menu.appendChild(option);
    }

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      root.classList.toggle("is-open");
    });

    const handleOutsideClick = (event) => {
      if (!root.contains(event.target)) {
        root.classList.remove("is-open");
      }
    };
    document.addEventListener("click", handleOutsideClick);

    root.appendChild(button);
    root.appendChild(menu);
    root.cleanup = () => {
      document.removeEventListener("click", handleOutsideClick);
    };
    return root;
  };

  RLS.scheduleRefresh = function() {
    window.clearTimeout(STATE.refreshTimer);
    STATE.refreshTimer = window.setTimeout(() => RLS.refreshLogView(false), REFRESH_DELAY);
  };

  RLS.matchesFilters = function(line) {
    if (STATE.level !== "ALL" && line.level !== STATE.level) {
      return false;
    }

    if (!STATE.keyword) {
      return true;
    }

    const { includes, excludes } = RLS.getCompiledQuery();

    for (const inc of includes) {
      if (!RLS.matchesCompiledTerm(line.raw, inc)) {
        return false;
      }
    }

    for (const exc of excludes) {
      if (RLS.matchesCompiledTerm(line.raw, exc)) {
        return false;
      }
    }

    return true;
  };

  RLS.renderPrettyLines = function(newLinesOnly = null) {
    if (!STATE.prettyView) {
      return;
    }

    // 1. FULL REBUILD: Clear and rebuild the entire view (triggered by filter changes or opening the modal)
    if (!newLinesOnly) {
      STATE.prettyView.innerHTML = "";

      const matchedLines = RLS.getFilteredLines();
      const hiddenCount = Math.max(matchedLines.length - MAX_RENDER_LINES, 0);

      if (hiddenCount > 0) {
        const notice = document.createElement("div");
        notice.className = "rancher-log-style__notice";
        notice.textContent = RLS.t("renderNotice", {
          total: hiddenCount + Math.min(matchedLines.length, MAX_RENDER_LINES),
          rendered: MAX_RENDER_LINES,
        });
        STATE.prettyView.appendChild(notice);
      }

      const linesToRender = matchedLines.slice(-MAX_RENDER_LINES);
      if (linesToRender.length === 0) {
        const empty = document.createElement("div");
        empty.className = "rancher-log-style__empty";
        empty.textContent = RLS.t("empty");
        STATE.prettyView.appendChild(empty);
        return;
      }

      // Rebuild entire list inside a single DocumentFragment for optimal reflow
      const fragment = document.createDocumentFragment();
      linesToRender.forEach((line) => {
        fragment.appendChild(RLS.createRowElement(line));
      });
      STATE.prettyView.appendChild(fragment);

      if (!STATE.pauseScroll) {
        STATE.prettyView.scrollTop = STATE.prettyView.scrollHeight;
      }
      return;
    }

    // 2. INCREMENTAL UPDATE: Only render and append the new lines (triggered in real-time)
    const matchingNew = newLinesOnly.filter(RLS.matchesFilters);
    if (matchingNew.length === 0) {
      return;
    }

    // Remove empty notice if present
    const emptyEl = STATE.prettyView.querySelector(".rancher-log-style__empty");
    if (emptyEl) {
      emptyEl.remove();
    }

    const fragment = document.createDocumentFragment();
    matchingNew.forEach((line) => {
      fragment.appendChild(RLS.createRowElement(line));
    });
    STATE.prettyView.appendChild(fragment);

    // Keep the DOM size within MAX_RENDER_LINES to prevent scroll lag
    const children = STATE.prettyView.children;
    let startIndex = 0;
    if (children[0]?.classList.contains("rancher-log-style__notice")) {
      startIndex = 1;
    }

    const currentCount = children.length - startIndex;
    if (currentCount > MAX_RENDER_LINES) {
      const overflow = currentCount - MAX_RENDER_LINES;
      // Remove oldest rendered elements from the top of DOM
      for (let i = 0; i < overflow; i++) {
        children[startIndex].remove();
      }

      // Add or update the overflow notice
      let noticeEl = STATE.prettyView.querySelector(".rancher-log-style__notice");
      const totalMatched = RLS.getFilteredLines().length;
      if (totalMatched > MAX_RENDER_LINES) {
        if (!noticeEl) {
          noticeEl = document.createElement("div");
          noticeEl.className = "rancher-log-style__notice";
          STATE.prettyView.insertBefore(noticeEl, STATE.prettyView.firstChild);
        }
        noticeEl.textContent = RLS.t("renderNotice", {
          total: totalMatched,
          rendered: MAX_RENDER_LINES,
        });
      }
    }

    if (!STATE.pauseScroll) {
      STATE.prettyView.scrollTop = STATE.prettyView.scrollHeight;
    }
  };

  RLS.updateStatusText = function() {
    const totalCount = STATE.lines.length;
    const matchedCount =
      STATE.keyword || STATE.level !== "ALL" ? RLS.getFilteredLines().length : totalCount;

    if (STATE.controls?.inlineStatus) {
      STATE.controls.inlineStatus.textContent = 
        STATE.mode === "pretty"
          ? RLS.t("beautified", { total: totalCount })
          : RLS.t("rawCached", { total: totalCount });
    }

    if (STATE.controls?.modalStatus) {
      if (STATE.keyword || STATE.level !== "ALL") {
        STATE.controls.modalStatus.textContent = RLS.t("cachedFiltered", {
          total: totalCount,
          matched: matchedCount,
        });
      } else {
        STATE.controls.modalStatus.textContent = RLS.t("cachedLogs", { total: totalCount });
      }
    }
  };

  RLS.refreshLogView = function(force = false) {
    if (!STATE.rawView) {
      return;
    }

    if (force) {
      if (STATE.rawView.children) {
        for (const child of STATE.rawView.children) {
          child.__parsed = false;
        }
      }
      STATE.lines = [];
      RLS.invalidateFilterCache();
    }

    const nextNewLines = RLS.parseNewLines();
    if (nextNewLines.length > 0) {
      STATE.lines = STATE.lines.concat(nextNewLines);

      if (STATE.lines.length > MAX_CACHE_LIMIT) {
        STATE.lines = STATE.lines.slice(-MAX_CACHE_LIMIT);
      }

      RLS.invalidateFilterCache();

      if (STATE.mode === "pretty") {
        RLS.renderPrettyLines(nextNewLines); // Incremental Update!
      }
    } else {
      if (STATE.mode === "pretty" && force) {
        RLS.renderPrettyLines(); // Full rebuild on force
      }
    }

    RLS.updateStatusText();
  };

  RLS.attachRawObserver = function() {
    if (!STATE.rawView) {
      return;
    }

    STATE.observer?.disconnect();
    STATE.observer = new MutationObserver(() => {
      RLS.scheduleRefresh();
    });
    STATE.observer.observe(STATE.rawView, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  };

  RLS.openBeautifiedModal = function() {
    STATE.mode = "pretty";

    // Completely hide original raw log view in background to prevent CPU/rendering overhead!
    if (STATE.rawView) {
      STATE.rawView.style.display = "none";
    }

    // Re-verify and parse everything
    RLS.refreshLogView(false);

    // Force a full clean rebuild of matching lines in modal
    RLS.renderPrettyLines();

    if (STATE.backdrop && STATE.modal) {
      STATE.backdrop.classList.add("is-visible");
      STATE.modal.classList.add("is-visible");
    }

    document.body.style.overflow = "hidden";

    if (STATE.prettyView && !STATE.pauseScroll) {
      window.setTimeout(() => {
        STATE.prettyView.scrollTop = STATE.prettyView.scrollHeight;
      }, 50);
    }

    RLS.updateStatusText();
  };

  RLS.isNativeRancherCloseButton = function(button) {
    if (!button || button.closest(".rancher-log-style__modal")) {
      return false;
    }

    const text = button.textContent?.trim();
    if (text !== "关闭" && text !== "Close") {
      return false;
    }

    const hasEmberAction = Array.from(button.attributes || []).some((attr) =>
      attr.name.startsWith("data-ember-action")
    );
    const inLogModal =
      Boolean(button.closest(".container-log, .modal-container, .modal-overlay, .modal")) ||
      Boolean(button.closest("body")?.textContent?.includes("日志查看"));

    return hasEmberAction && inLogModal;
  };

  RLS.findNativeCloseButton = function() {
    const scopedButtons = [];
    if (STATE.mountedModal) {
      scopedButtons.push(...STATE.mountedModal.querySelectorAll("button, a, [role='button']"));
    }

    const directCandidates = Array.from(
      document.querySelectorAll("button.btn.bg-primary[type='button']")
    ).filter((button) =>
      Array.from(button.attributes || []).some((attr) => attr.name.startsWith("data-ember-action"))
    );
    const allButtons = Array.from(document.querySelectorAll("button, a, [role='button']"));

    return [...scopedButtons, ...directCandidates, ...allButtons].find((button) =>
      RLS.isNativeRancherCloseButton(button)
    );
  };

  RLS.isNativeRancherClearButton = function(button) {
    if (!button || button.closest(".rancher-log-style__modal")) {
      return false;
    }

    const text = button.textContent?.trim();
    if (text !== "清除屏幕" && text !== "Clear Screen") {
      return false;
    }

    const hasEmberAction = Array.from(button.attributes || []).some((attr) =>
      attr.name.startsWith("data-ember-action")
    );
    const inLogModal =
      Boolean(button.closest(".container-log, .modal-container, .modal-overlay, .modal")) ||
      Boolean(button.closest("body")?.textContent?.includes("日志查看"));

    return hasEmberAction && inLogModal;
  };

  RLS.findNativeClearButton = function() {
    const scopedButtons = [];
    if (STATE.mountedModal) {
      scopedButtons.push(...STATE.mountedModal.querySelectorAll("button, a, [role='button']"));
    }

    const allButtons = Array.from(document.querySelectorAll("button, a, [role='button']"));
    return [...scopedButtons, ...allButtons].find((button) => RLS.isNativeRancherClearButton(button));
  };

  RLS.clickNativeButton = function(button) {
    if (!button) {
      return false;
    }

    button.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );
    return true;
  };

  RLS.clearLogCacheAndScreen = function() {
    const nativeClearButton = RLS.findNativeClearButton();
    const clickedNativeClear = RLS.clickNativeButton(nativeClearButton);

    if (!clickedNativeClear && STATE.rawView) {
      STATE.rawView.replaceChildren();
      STATE.rawView.textContent = "";
    }

    STATE.lines = [];
    RLS.invalidateFilterCache();

    if (STATE.rawView?.children) {
      for (const child of STATE.rawView.children) {
        child.__parsed = false;
      }
    }

    if (STATE.prettyView) {
      RLS.renderPrettyLines();
    }

    RLS.updateStatusText();
  };

  RLS.closeBeautifiedModal = function() {
    const originalCloseBtn = RLS.findNativeCloseButton();
    const clickedNativeClose = RLS.clickNativeButton(originalCloseBtn);

    RLS.cleanupEnhancer();

    if (!clickedNativeClose) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        })
      );
    }
  };

  RLS.cleanupEnhancer = function() {
    STATE.observer?.disconnect();
    STATE.observer = null;

    window.clearTimeout(STATE.refreshTimer);
    STATE.refreshTimer = null;

    if (STATE.keydownHandler) {
      window.removeEventListener("keydown", STATE.keydownHandler);
      STATE.keydownHandler = null;
    }

    STATE.controls?.levelSelect?.cleanup?.();
    STATE.lines = [];
    RLS.invalidateFilterCache();

    if (STATE.rawView) {
      STATE.rawView.style.display = STATE.rawOriginalDisplay;
    }

    if (STATE.host) {
      STATE.host.remove();
      STATE.host = null;
    }
    if (STATE.backdrop) {
      STATE.backdrop.remove();
      STATE.backdrop = null;
    }
    if (STATE.modal) {
      STATE.modal.remove();
      STATE.modal = null;
    }

    document.body.style.overflow = "";

    STATE.mountedModal = null;
    STATE.rawView = null;
    STATE.prettyView = null;
    STATE.controls = null;
    STATE.mode = "raw";
    STATE.pauseScroll = false;
  };

  RLS.mountEnhancer = function(modal, rawView) {
    if (
      STATE.mountedModal === modal &&
      STATE.rawView === rawView &&
      STATE.host &&
      document.body.contains(STATE.host)
    ) {
      return;
    }

    // Clean up previous enhancer before mounting a new one
    RLS.cleanupEnhancer();

    STATE.mountedModal = modal;
    STATE.rawView = rawView;
    STATE.rawOriginalDisplay = rawView.style.display === "none" ? "" : rawView.style.display || "";

    // Clear any leftover elements from previous runs
    document
      .querySelectorAll(".rancher-log-style__inline-bar, .rancher-log-style__backdrop, .rancher-log-style__modal")
      .forEach((el) => el.remove());

    // 1. Create the compact inline bar for raw view
    const inlineBar = document.createElement("div");
    inlineBar.className = "rancher-log-style__inline-bar";

    const inlineLeft = document.createElement("div");
    inlineLeft.className = "rancher-log-style__inline-left";

    const inlineBadge = document.createElement("div");
    inlineBadge.className = "rancher-log-style__badge";
    inlineBadge.textContent = "Log Style";

    const inlineStatus = document.createElement("span");
    inlineStatus.className = "rancher-log-style__status";
    inlineStatus.textContent = RLS.t("rawView");

    inlineLeft.appendChild(inlineBadge);
    inlineLeft.appendChild(inlineStatus);

    const inlineRight = document.createElement("div");
    inlineRight.className = "rancher-log-style__inline-right";

    const inlineButton = document.createElement("button");
    inlineButton.type = "button";
    inlineButton.className = "rancher-log-style__button is-primary";
    inlineButton.textContent = RLS.t("beautifyLogs");
    inlineButton.addEventListener("click", () => {
      RLS.openBeautifiedModal();
    });

    inlineRight.appendChild(inlineButton);
    inlineBar.appendChild(inlineLeft);
    inlineBar.appendChild(inlineRight);

    // Position inline bar just above the raw view
    const hostTarget = modal.matches(".container-log") && modal.parentElement ? modal : rawView;
    hostTarget.insertAdjacentElement("beforebegin", inlineBar);

    STATE.host = inlineBar;

    // 2. Create the blur backdrop overlay
    const backdrop = document.createElement("div");
    backdrop.className = "rancher-log-style__backdrop";
    backdrop.addEventListener("click", () => {
      RLS.closeBeautifiedModal();
    });
    document.body.appendChild(backdrop);
    STATE.backdrop = backdrop;

    // 3. Create the centered popup modal container
    const modalDiv = document.createElement("div");
    modalDiv.className = "rancher-log-style__modal";

    // Modal Header Toolbar
    const toolbar = document.createElement("div");
    toolbar.className = "rancher-log-style__toolbar";

    const toolbarLeft = document.createElement("div");
    toolbarLeft.className = "rancher-log-style__toolbar-left";

    const modalBadge = document.createElement("div");
    modalBadge.className = "rancher-log-style__badge";
    modalBadge.textContent = "Log Style";

    const modalStatus = document.createElement("span");
    modalStatus.className = "rancher-log-style__status";
    modalStatus.textContent = RLS.t("unread");

    toolbarLeft.appendChild(modalBadge);
    toolbarLeft.appendChild(modalStatus);

    const toolbarActions = document.createElement("div");
    toolbarActions.className = "rancher-log-style__toolbar-actions";

    const levelSelect = RLS.createLevelSelect();

    const keywordInput = document.createElement("input");
    keywordInput.className = "rancher-log-style__input unified-query-input";
    keywordInput.placeholder = RLS.t("filterPlaceholder");
    keywordInput.value = STATE.keyword;
    keywordInput.addEventListener("input", () => {
      STATE.keyword = keywordInput.value;
      localStorage.setItem("rls_keyword", STATE.keyword);
      RLS.invalidateFilterCache();
      RLS.renderPrettyLines();
      RLS.updateStatusText();
    });

    const pauseButton = document.createElement("button");
    pauseButton.type = "button";
    pauseButton.className = "rancher-log-style__button";
    pauseButton.textContent = RLS.t("pauseScroll");
    pauseButton.addEventListener("click", () => {
      STATE.pauseScroll = !STATE.pauseScroll;
      pauseButton.textContent = STATE.pauseScroll ? RLS.t("resumeScroll") : RLS.t("pauseScroll");
      pauseButton.classList.toggle("is-active", STATE.pauseScroll);
      if (!STATE.pauseScroll && STATE.prettyView) {
        STATE.prettyView.scrollTop = STATE.prettyView.scrollHeight;
      }
    });

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "rancher-log-style__button is-warning";
    clearButton.textContent = RLS.t("clearLogs");
    clearButton.addEventListener("click", () => {
      RLS.clearLogCacheAndScreen();
    });

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "rancher-log-style__button is-success";
    exportButton.textContent = RLS.t("downloadLogs");
    exportButton.addEventListener("click", () => {
      const matchedLines = STATE.lines.filter(RLS.matchesFilters);
      if (matchedLines.length === 0) {
        alert(RLS.t("noDownload"));
        return;
      }

      const content = matchedLines
        .map((line) => {
          const parts = [];
          if (line.timestamp) parts.push(line.timestamp);
          if (line.level && line.level !== "PLAIN") parts.push(`[${line.level}]`);
          parts.push(line.message);
          return parts.join(" ");
        })
        .join("\n");

      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const timeStr = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `rancher-beautified-logs-${timeStr}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "rancher-log-style__button is-danger";
    closeButton.textContent = RLS.t("close");
    closeButton.addEventListener("click", () => {
      RLS.closeBeautifiedModal();
    });

    toolbarActions.appendChild(levelSelect);
    toolbarActions.appendChild(keywordInput);
    toolbarActions.appendChild(pauseButton);
    toolbarActions.appendChild(clearButton);
    toolbarActions.appendChild(exportButton);
    toolbarActions.appendChild(closeButton);

    toolbar.appendChild(toolbarLeft);
    toolbar.appendChild(toolbarActions);

    // Scrollable Pretty view panel
    const prettyView = document.createElement("div");
    prettyView.className = "rancher-log-style__panel";

    modalDiv.appendChild(toolbar);
    modalDiv.appendChild(prettyView);
    document.body.appendChild(modalDiv);

    STATE.modal = modalDiv;
    STATE.prettyView = prettyView;

    STATE.controls = {
      inlineStatus,
      modalStatus,
      levelSelect,
      keywordInput,
      pauseButton,
    };

    // Keyboard shortcuts (Escape, Ctrl+F, Ctrl+Shift+F / Ctrl+E)
    const handleKeys = (e) => {
      if (STATE.mode !== "pretty") return;

      if (e.key === "Escape") {
        RLS.closeBeautifiedModal();
        return;
      }

      const isCtrlCmd = e.ctrlKey || e.metaKey;
      if (isCtrlCmd) {
        if (e.key.toLowerCase() === "f") {
          e.preventDefault(); // Prevent native browser search
          keywordInput.focus();
          if (e.shiftKey) {
            if (keywordInput.value && !keywordInput.value.endsWith(" ")) {
              keywordInput.value += " not ";
            } else {
              keywordInput.value += "not ";
            }
            keywordInput.dispatchEvent(new Event("input"));
          } else {
            keywordInput.select();
          }
        } else if (e.key.toLowerCase() === "e") {
          e.preventDefault();
          keywordInput.focus();
          if (keywordInput.value && !keywordInput.value.endsWith(" ")) {
            keywordInput.value += " not ";
          } else {
            keywordInput.value += "not ";
          }
          keywordInput.dispatchEvent(new Event("input"));
        }
      }
    };
    if (STATE.keydownHandler) {
      window.removeEventListener("keydown", STATE.keydownHandler);
    }
    STATE.keydownHandler = handleKeys;
    window.addEventListener("keydown", STATE.keydownHandler);

    RLS.attachRawObserver();
    RLS.refreshLogView(true); // Force initial full parse
  };

  RLS.inspectPage = function() {
    if (!RLS.isSupportedPage()) {
      if (STATE.mountedModal) {
        RLS.cleanupEnhancer();
      }
      return;
    }

    // If the modal we mounted to is no longer in the DOM, clean up our states immediately
    if (STATE.mountedModal && !document.body.contains(STATE.mountedModal)) {
      RLS.cleanupEnhancer();
      return;
    }

    const directRawView = document.querySelector("pre.log-body");
    if (directRawView) {
      const directModal =
        directRawView.closest(".container-log, .modal-container, .modal-overlay") ||
        directRawView.parentElement;
      if (directModal) {
        RLS.mountEnhancer(directModal, directRawView);
        return;
      }
    }

    const modal = RLS.findActiveLogModal();
    if (!modal) {
      return;
    }

    const rawView = RLS.findRawLogContainer(modal);
    if (!rawView) {
      return;
    }

    RLS.mountEnhancer(modal, rawView);
  };

  RLS.startBodyObserver = function() {
    if (STATE.bodyObserver) {
      return;
    }

    STATE.bodyObserver = new MutationObserver(() => {
      RLS.inspectPage();
    });
    STATE.bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  };

  RLS.stopBodyObserver = function() {
    STATE.bodyObserver?.disconnect();
    STATE.bodyObserver = null;
  };

  RLS.syncPageActivation = function() {
    if (RLS.isSupportedPage()) {
      RLS.inspectPage();
      RLS.startBodyObserver();
      return;
    }

    RLS.stopBodyObserver();
    if (STATE.mountedModal || STATE.host || STATE.modal || STATE.backdrop) {
      RLS.cleanupEnhancer();
    }
  };

  RLS.bootstrap = function() {
    RLS.syncPageActivation();

    STATE.titleObserver?.disconnect();
    STATE.titleObserver = new MutationObserver(() => {
      RLS.syncPageActivation();
    });

    const titleNode = document.querySelector("title");
    if (titleNode) {
      STATE.titleObserver.observe(titleNode, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    } else if (document.head) {
      STATE.titleObserver.observe(document.head, {
        childList: true,
        subtree: true,
      });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", RLS.bootstrap, { once: true });
  } else {
    RLS.bootstrap();
  }
})();
