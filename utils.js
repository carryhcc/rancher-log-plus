(() => {
  window.RLS = {
    STATE: {
      mountedModal: null,    // The Rancher Modal node that is active
      rawView: null,         // The raw <pre class="log-body"> element inside the Rancher Modal
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
      host: null,            // Inline control bar in Raw Mode
      backdrop: null,        // Blur overlay backdrop
      modal: null,           // Centered popup modal container
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

    getLocale() {
      return /^zh\b/i.test(navigator.language || "") ? "zh" : "en";
    },

    t(key, params = {}) {
      const locale = RLS.getLocale();
      const text = RLS.I18N[locale]?.[key] || RLS.I18N.en[key] || key;
      return Object.entries(params).reduce(
        (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
        text
      );
    },

    isSupportedPage() {
      return /Rancher/i.test(document.title || "");
    },

    invalidateFilterCache() {
      RLS.STATE.filteredCacheKey = "";
      RLS.STATE.filteredLines = null;
    },

    buildCompiledTerm(filterStr) {
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
    },

    getCompiledQuery() {
      if (RLS.STATE.compiledQueryKey === RLS.STATE.keyword && RLS.STATE.compiledQuery) {
        return RLS.STATE.compiledQuery;
      }

      const { includes, excludes } = RLS.parseQuery(RLS.STATE.keyword);
      RLS.STATE.compiledQueryKey = RLS.STATE.keyword;
      RLS.STATE.compiledQuery = {
        includes: includes.map((value) => RLS.buildCompiledTerm(value)),
        excludes: excludes.map((value) => RLS.buildCompiledTerm(value)),
      };
      return RLS.STATE.compiledQuery;
    },

    matchesCompiledTerm(text, term) {
      if (term.type === "regex") {
        term.regex.lastIndex = 0;
        return term.regex.test(text);
      }
      return text.toLowerCase().includes(term.text);
    },

    escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    },

    getHighlightTerms() {
      if (!RLS.STATE.keyword) {
        return [];
      }
      return RLS.getCompiledQuery().includes;
    },

    buildHighlightRanges(text, terms) {
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
    },

    highlightText(text) {
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
    },

    getFilteredLines() {
      const lastLineId = RLS.STATE.lines[RLS.STATE.lines.length - 1]?.id || "";
      const cacheKey = `${RLS.STATE.level}\u0000${RLS.STATE.keyword}\u0000${RLS.STATE.lines.length}\u0000${lastLineId}`;
      if (RLS.STATE.filteredCacheKey === cacheKey && RLS.STATE.filteredLines) {
        return RLS.STATE.filteredLines;
      }

      const matchedLines = [];
      for (const line of RLS.STATE.lines) {
        if (RLS.matchesFilters(line)) {
          matchedLines.push(line);
        }
      }

      RLS.STATE.filteredCacheKey = cacheKey;
      RLS.STATE.filteredLines = matchedLines;
      return matchedLines;
    },

    escapeHtml(value) {
      return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    },

    getElementLogText(element) {
      if (!element) {
        return "";
      }

      // If it's a textarea or input, get its value
      if (element.matches?.("textarea, input")) {
        return element.value || "";
      }

      // If it's the main rawView container and has children, get all child texts joined by newline
      if (element === RLS.STATE.rawView && element.children && element.children.length > 0) {
        return Array.from(element.children)
          .map((child) => child.textContent || child.innerText || "")
          .join("\n");
      }

      // For any single child node or element, return its text content directly
      return element.textContent || element.innerText || "";
    },

    getModalTitle(element) {
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
    },

    findActiveLogModal() {
      const logBody = document.querySelector("pre.log-body");
      if (logBody) {
        return logBody.closest(".container-log, .modal-container, .modal-overlay") || logBody.parentElement;
      }

      const candidates = document.querySelectorAll(".container-log, .modal-container, .modal-overlay, body *");
      let best = null;

      for (const element of candidates) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }
        if (!RLS.getModalTitle(element)) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width < 300 || rect.height < 80) {
          continue;
        }
        best = element;
        break;
      }

      return best;
    },

    scoreRawCandidate(element) {
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
    },

    findRawLogContainer(modal) {
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
    },

    matchTextOrRegex(text, filterStr) {
      if (!filterStr) return true;
      return RLS.matchesCompiledTerm(text, RLS.buildCompiledTerm(filterStr));
    },

    parseQuery(queryString) {
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
      let firstVal = parts[0]?.trim();
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
    }
  };
})();
