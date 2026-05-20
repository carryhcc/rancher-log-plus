(() => {
  const { RLS } = window;
  if (!RLS) return;

  RLS.createRowElement = function(line) {
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
      parts.push(
        `<span class="rancher-log-style__timestamp">${RLS.escapeHtml(line.timestamp)}</span>`
      );
    }
    if (line.level !== "PLAIN") {
      parts.push(`<span class="rancher-log-style__level">${RLS.escapeHtml(line.level)}</span>`);
    }
    parts.push(`<span class="rancher-log-style__message">${RLS.escapeHtml(line.message)}</span>`);

    const div = document.createElement("div");
    div.className = classes;
    div.setAttribute("data-line-id", line.id);
    div.innerHTML = parts.join("");
    return div;
  };

  RLS.createLevelSelect = function() {
    const root = document.createElement("div");
    root.className = "rancher-log-style__level-select";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "rancher-log-style__level-trigger";

    const label = document.createElement("span");
    label.className = "rancher-log-style__level-trigger-label";
    label.textContent = RLS.STATE.level;

    const chevron = document.createElement("span");
    chevron.className = "rancher-log-style__level-trigger-icon";
    chevron.textContent = "⌄";

    button.appendChild(label);
    button.appendChild(chevron);

    const menu = document.createElement("div");
    menu.className = "rancher-log-style__level-menu";

    const setValue = (value) => {
      RLS.STATE.level = value;
      localStorage.setItem("rls_level", RLS.STATE.level);
      label.textContent = value;
      menu.querySelectorAll(".rancher-log-style__level-option").forEach((option) => {
        option.classList.toggle("is-selected", option.dataset.value === value);
      });
      root.classList.remove("is-open");
      RLS.renderPrettyLines();
      RLS.updateStatusText();
    };

    for (const value of ["ALL", ...RLS.LEVELS]) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "rancher-log-style__level-option";
      option.dataset.value = value;
      option.textContent = value;
      option.classList.toggle("is-selected", value === RLS.STATE.level);
      option.addEventListener("click", () => setValue(value));
      menu.appendChild(option);
    }

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      root.classList.toggle("is-open");
    });

    document.addEventListener("click", (event) => {
      if (!root.contains(event.target)) {
        root.classList.remove("is-open");
      }
    });

    root.appendChild(button);
    root.appendChild(menu);
    return root;
  };
})();
