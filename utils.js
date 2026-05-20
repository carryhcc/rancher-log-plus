(() => {
  window.RLS = {
    STATE: {
      mountedModal: null,    // The Rancher Modal node that is active
      rawView: null,         // The raw <pre class="log-body"> element inside the Rancher Modal
      prettyView: null,
      controls: null,
      observer: null,
      bodyObserver: null,
      refreshTimer: null,
      lines: [],
      mode: "raw",
      level: localStorage.getItem("rls_level") || "ALL",
      keyword: localStorage.getItem("rls_keyword") || "",
      pauseScroll: false,
      host: null,            // Inline control bar in Raw Mode
      backdrop: null,        // Blur overlay backdrop
      modal: null,           // Centered popup modal container
      rawOriginalDisplay: "",
      lastRawText: "",
      lastChildrenCount: 0,
    },
    LEVELS: ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"],
    REFRESH_DELAY: 60,
    MAX_RENDER_LINES: 5000,
    MAX_CACHE_LIMIT: 20000,

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

      // Check if it's a regex (e.g. /error.*/i or /error.*/)
      const regexMatch = filterStr.match(/^\/(.+)\/([gimsuy]*)$/);
      if (regexMatch) {
        try {
          const [, pattern, flags] = regexMatch;
          const regex = new RegExp(pattern, flags);
          return regex.test(text);
        } catch (e) {
          // If regex compiles with errors (invalid syntax), fall back to standard substring check
        }
      }

      // Standard case-insensitive substring search
      return text.toLowerCase().includes(filterStr.toLowerCase());
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
