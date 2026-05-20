(() => {
  const { RLS } = window;
  if (!RLS) return;

  RLS.parseLine = function(line, index, precedingLine = null) {
    const timestampMatch = line.match(
      /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)/
    );
    const timestamp = timestampMatch ? timestampMatch[1] : "";
    const isStack = /^\s*at\b/.test(line) || /^\s*\.\.\./.test(line);
    const isErrorDetail = /Exception|Error:|Caused by:/.test(line);
    const isBlank = line.trim() === "";

    // 1. SMART MERGE: If it's a timestamp-less regular packet chunk, merge it directly into the preceding line message
    if (!timestamp && !isStack && !isErrorDetail && !isBlank && precedingLine) {
      precedingLine.raw += line;
      precedingLine.message += line;
      return null; // Signals that it was merged and shouldn't create a new row
    }

    const rest = timestamp ? line.slice(timestamp.length).trimStart() : line;
    let level = "PLAIN";
    if (timestamp) {
      const levelMatch = line.match(/\b(ERROR|WARN|INFO|DEBUG|TRACE)\b/);
      level = levelMatch ? levelMatch[1] : "PLAIN";
    } else {
      // Continuation stack trace or blank row
      if (isStack || isErrorDetail) {
        if (precedingLine && (precedingLine.level === "ERROR" || precedingLine.level === "WARN")) {
          level = precedingLine.level;
        } else {
          level = "ERROR"; // Default stack frames to ERROR
        }
      } else {
        level = precedingLine ? precedingLine.level : "PLAIN";
      }
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

  // Incremental backward parsing algorithm to completely avoid UI freeze
  RLS.parseNewLines = function() {
    if (!RLS.STATE.rawView) {
      return [];
    }

    const children = RLS.STATE.rawView.children || [];

    // Reset cache ONLY if the log view was explicitly cleared/emptied by Rancher
    if (children.length === 0) {
      RLS.STATE.lines = [];
      RLS.invalidateFilterCache?.();
      return [];
    }

    const newLines = [];
    let i = children.length - 1;
    const pendingNodes = [];

    // Traverse backward until we hit an already parsed child node
    while (i >= 0) {
      const child = children[i];
      if (child.__parsed) {
        break;
      }
      pendingNodes.push(child);
      i--;
    }

    // Process nodes chronologically (reverse the backward scan list)
    pendingNodes.reverse();

    pendingNodes.forEach((child) => {
      child.__parsed = true;
      const text = RLS.getElementLogText(child);
      const sublines = text.split(/\r?\n/);
      sublines.forEach((line) => {
        // Keep blank lines to preserve original logging structure and spacing
        const preceding = newLines[newLines.length - 1] || RLS.STATE.lines[RLS.STATE.lines.length - 1] || null;
        const parsed = RLS.parseLine(line, RLS.STATE.lines.length + newLines.length, preceding);
        if (parsed) {
          newLines.push(parsed);
        }
      });
    });

    return newLines;
  };
})();
