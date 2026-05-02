(() => {
const { getHeapDetails, getObjectDetails, getReachableObjectIds, state } = window.JVMSim;
let currentCodeLines = [];
let currentActiveLine = null;
let executionStepSerial = 0;
let memoryHistory = [];
let lastMemorySignature = null;

const sectionZoneMap = {
  eden: "eden-zone",
  s0: "s0-zone",
  s1: "s1-zone",
  old: "old-zone",
  stringPool: "stringPool-zone"
};

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function generationLabel(section) {
  if (section === "eden") {
    return "eden";
  }
  if (section === "s0" || section === "s1") {
    return "survivor";
  }
  if (section === "old") {
    return "old";
  }
  return "pool";
}

function getReferenceNamesForObject(objectId) {
  const names = [];
  const scanStack = (stack) => {
    stack.forEach((frame) => {
      Object.entries(frame.locals).forEach(([name, value]) => {
        if (value === objectId) {
          names.push(name);
        }
      });
    });
  };
  scanStack(state.stack);
  scanStack(state.stack2 || []);
  return names;
}

/** Human-readable stack local value; keeps object id in data-object-anchor for arrows/GC. */
function formatStackLocalTarget(value, threadKey) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (value === "volatileShared" && state.ui.volatileShowSecondStack) {
    if (state.sharedObject.volatile === true) {
      return threadKey === "T2" ? "volatile SharedObject s2" : "volatile SharedObject s1";
    }
    return "SharedObject";
  }
  return String(value);
}

function renderStackPanel(stackRootId, stackFrames, threadKey, onSelect) {
  const stackRoot = el(stackRootId);
  if (!stackRoot) {
    return;
  }
  stackRoot.innerHTML = "";

  stackFrames.forEach((frame, frameIndex) => {
    const frameNode = document.createElement("article");
    frameNode.className = "stack-frame";
    frameNode.dataset.frameIndex = String(frameIndex);

    const selThread = state.ui.selected?.thread ?? "T1";
    if (state.ui.selected?.kind === "frame" && selThread === threadKey && state.ui.selected.index === frameIndex) {
      frameNode.classList.add("is-selected");
    }

    const localRows = Object.entries(frame.locals).map(([name, value]) => `
      <div class="local-row" data-object-anchor="${value ?? ""}">
        <span class="local-name">${escapeHtml(name)}</span>
        <span class="local-target">${escapeHtml(formatStackLocalTarget(value, threadKey))}</span>
      </div>
    `).join("") || `<div class="local-row"><span class="local-name">No locals</span><span class="local-target">empty</span></div>`;

    frameNode.innerHTML = `
      <h3>${frame.method}()</h3>
      <span class="frame-badge">Frame ${frameIndex}</span>
      <div class="locals-list">${localRows}</div>
    `;

    frameNode.addEventListener("click", () => onSelect({
      kind: "frame",
      thread: threadKey,
      index: frameIndex
    }));

    stackRoot.appendChild(frameNode);
  });

  const cacheEl = document.querySelector(`[data-thread-cache="${threadKey}"]`);
  if (cacheEl) {
    const tl = state.threadLocal[threadKey];
    const counterVal = tl ? tl.counter : 0;
    cacheEl.innerHTML = `
      <div class="local-cache-title">Local Cache</div>
      <div class="local-cache-row"><span class="local-cache-key">counter</span><span class="local-cache-val">${counterVal}</span></div>
    `;
  }

  const panel = document.querySelector(`[data-thread-panel="${threadKey}"]`);
  if (panel) {
    panel.classList.toggle("is-thread-highlight", state.ui.highlightThread === threadKey);
  }
}

function renderStack(onSelect) {
  renderStackPanel("stack-root", state.stack, "T1", onSelect);
  renderStackPanel("stack-root-t2", state.stack2 || [], "T2", onSelect);
}

function buildObjectNode(objectId, onSelect) {
  const object = getObjectDetails(objectId);
  if (!object) {
    return null;
  }
  const reachableIds = new Set(getReachableObjectIds());
  const isOrphan = object.type === "SharedObject" ? false : !reachableIds.has(objectId);
  const referenceNames = getReferenceNamesForObject(objectId);
  let objectLabel = referenceNames.length ? referenceNames.join(", ") : "orphan";
  if (object.type === "SharedObject") {
    objectLabel = object.value || "SharedObject";
  }

  const node = document.createElement("article");
  node.className = "heap-object";
  node.dataset.objectId = objectId;
  node.dataset.generation = generationLabel(object.section);
  node.classList.toggle("is-orphan", isOrphan);

  if (object.markStatus === "reachable") {
    node.classList.add("mark-reachable");
  } else if (object.markStatus === "unreachable") {
    node.classList.add("mark-unreachable");
  }

  node.innerHTML = `
    <div class="object-label">${objectLabel}</div>
  `;

  if (state.ui.selected?.kind === "object" && state.ui.selected.id === objectId) {
    node.classList.add("is-selected");
  }

  node.addEventListener("click", (event) => {
    event.stopPropagation();
    onSelect({
      kind: "object",
      id: objectId
    });
  });

  return node;
}

function renderHeap(onSelect) {
  Object.entries(sectionZoneMap).forEach(([section, zoneId]) => {
    const zone = el(zoneId);
    zone.innerHTML = "";

    state.heap[section].forEach((objectId) => {
      const object = state.objects[objectId];
      if (!object) {
        return;
      }

      const node = buildObjectNode(objectId, onSelect);
      if (node) {
        if (object.pendingDelete) {
          node.dataset.pendingDelete = "true";
        }
        zone.appendChild(node);
      }
    });
  });

  document.querySelectorAll(".heap-section").forEach((sectionNode) => {
    sectionNode.classList.toggle(
      "is-selected",
      state.ui.selected?.kind === "section" && state.ui.selected.section === sectionNode.dataset.section
    );
    sectionNode.onclick = () => onSelect({
      kind: "section",
      section: sectionNode.dataset.section
    });
  });
}

function renderSidePanel() {
  el("event-text").textContent = state.ui.lastEvent;
  el("explanation-text").textContent = state.ui.explanation;

  const selectionRoot = el("selection-content");
  const selected = state.ui.selected;

  if (!selected) {
    selectionRoot.innerHTML = "<p>No object or section selected yet.</p>";
    return;
  }

  if (selected.kind === "object") {
    const object = getObjectDetails(selected.id);
    if (!object) {
      selectionRoot.innerHTML = "<p>The selected object no longer exists.</p>";
      return;
    }

    selectionRoot.innerHTML = `
      <div class="selection-card">
        <dl>
          <dt>ID</dt><dd>${object.id}</dd>
          <dt>Type</dt><dd>${object.type}</dd>
          <dt>Value</dt><dd>${String(object.value)}</dd>
          <dt>Section</dt><dd>${object.section}</dd>
          <dt>Age</dt><dd>${object.age}</dd>
          <dt>Generation</dt><dd>${object.generation}</dd>
        </dl>
      </div>
    `;
    return;
  }

  if (selected.kind === "section") {
    const section = getHeapDetails(selected.section);
    selectionRoot.innerHTML = `
      <div class="selection-card">
        <p><strong>${selected.section}</strong></p>
        <p>${section.description}</p>
      </div>
    `;
    return;
  }

  if (selected.kind === "frame") {
    const selThread = selected.thread ?? "T1";
    const stackFrames = selThread === "T2" ? state.stack2 : state.stack;
    const frame = stackFrames[selected.index];
    if (!frame) {
      selectionRoot.innerHTML = "<p>The selected frame is no longer on the stack.</p>";
      return;
    }

    const items = Object.entries(frame.locals)
      .map(
        ([name, value]) =>
          `<li><strong>${escapeHtml(name)}</strong> -> ${escapeHtml(formatStackLocalTarget(value, selThread))}</li>`
      )
      .join("");
    const threadLabel = selThread === "T2" ? "Thread 2" : "Thread 1";
    selectionRoot.innerHTML = `
      <div class="selection-card">
        <p><strong>${threadLabel}: ${frame.method}()</strong></p>
        ${items ? `<ul>${items}</ul>` : "<p>No local variables in this frame.</p>"}
      </div>
    `;
  }
}

function volatileLocalAnchor(threadKey) {
  return document.querySelector(
    `.stack-panel[data-thread-panel="${threadKey}"] .local-row[data-object-anchor="volatileShared"]`
  );
}

function stackRoot(threadKey) {
  return threadKey === "T2"
    ? document.querySelector("#stack-root-t2")
    : document.querySelector("#stack-root");
}

function renderMemoryFlowArrow(layer, svgRect) {
  const flow = state.ui.memoryArrow;
  if (!flow || !flow.from || !flow.to) {
    return;
  }
  if (state.ui.runningScenario !== "volatileBehavior") {
    return;
  }

  const heapNode = document.querySelector('.heap-object[data-object-id="volatileShared"]');
  const pad = 8;

  /** Thread stacks sit to the right of Eden: emit toward heap from local row western edge */
  function anchorWestOfThread(threadKey) {
    const anchor = volatileLocalAnchor(threadKey);
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      return {
        x: r.left - svgRect.left - pad,
        y: r.top + r.height / 2 - svgRect.top
      };
    }

    const root = stackRoot(threadKey);
    if (root) {
      const r = root.getBoundingClientRect();
      return {
        x: r.left - svgRect.left + pad,
        y: r.top + Math.min(r.height * 0.28, 48) - svgRect.top
      };
    }

    const panel = document.querySelector(`.stack-panel[data-thread-panel="${threadKey}"]`);
    if (!panel) {
      return null;
    }
    const r = panel.getBoundingClientRect();
    return {
      x: r.left - svgRect.left + pad * 2,
      y: r.top + 120 - svgRect.top
    };
  }

  let fromPt;
  let toPt;

  // Layout: Heap (left columns) → Thread panels (middle/right). Writes go toward SharedObject western face;
  // reads originate from eastern face of SharedObject toward the reading thread's local row.
  if (flow.from === "T1" && flow.to === "heap" && heapNode) {
    fromPt = anchorWestOfThread("T1");
    const rHeap = heapNode.getBoundingClientRect();
    toPt = {
      x: rHeap.left - svgRect.left - pad,
      y: rHeap.top + rHeap.height / 2 - svgRect.top
    };
  } else if (flow.from === "heap" && flow.to === "T2" && heapNode) {
    const rHeap = heapNode.getBoundingClientRect();
    fromPt = {
      x: rHeap.right - svgRect.left + pad,
      y: rHeap.top + rHeap.height / 2 - svgRect.top
    };
    toPt = anchorWestOfThread("T2");
  }

  if (!fromPt || !toPt) {
    return;
  }

  const d = `M ${fromPt.x} ${fromPt.y} L ${toPt.x} ${toPt.y}`;

  layer.innerHTML = `
    <defs>
      <marker id="memory-arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
        <path class="reference-arrow" d="M0,0 L8,4 L0,8 z"></path>
      </marker>
    </defs>
    <path class="reference-line is-visible" d="${d}" marker-end="url(#memory-arrow-head)"></path>
  `;
}

function renderVisibilityBanner() {
  const strip = document.querySelector(".heap-panel .education-strip");
  if (!strip) {
    return;
  }
  let banner = strip.querySelector(".visibility-banner");
  const msg = state.ui.visibilityBanner;
  if (!msg) {
    if (banner) {
      banner.remove();
    }
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "visibility-banner";
    strip.insertBefore(banner, strip.firstChild);
  }
  banner.textContent = msg;
}

function renderReferenceLines() {
  const layer = el("reference-layer");
  if (!layer) {
    return;
  }
  const svgRect = layer.getBoundingClientRect();
  layer.innerHTML = "";
  renderMemoryFlowArrow(layer, svgRect);
}

function scheduleReferenceLinesRedraw() {
  window.requestAnimationFrame(() => renderReferenceLines());
}

function syncVolatileCodeLineDisplay() {
  const lineNode = document.querySelector('#code-panel .code-line[data-line-number="1"] .code-line-text');
  if (!lineNode || !currentCodeLines.length) {
    return;
  }
  const base = currentCodeLines[0];
  if (state.ui.highlightCodeVolatile) {
    lineNode.innerHTML = `<span class="code-volatile-keyword">volatile</span> ${escapeHtml("int counter = 0;")}`;
  } else {
    lineNode.textContent = base;
  }
}

function renderCodePanel(codeLines) {
  currentCodeLines = codeLines || [];
  const panel = el("code-panel");
  if (!panel) {
    return;
  }
  panel.innerHTML = currentCodeLines.map((line, index) => `
    <div class="code-line${currentActiveLine === index + 1 ? " active-line" : ""}" data-line-number="${index + 1}">
      <span class="code-line-number">${index + 1}</span>
      <span class="code-line-text">${escapeHtml(line)}</span>
    </div>
  `).join("") || `<div class="code-line"><span class="code-line-number">1</span><span class="code-line-text">Run a scenario to load Java code.</span></div>`;
  syncVolatileCodeLineDisplay();
}

function highlightCodeLine(lineNumber) {
  currentActiveLine = lineNumber ?? null;
  document.querySelectorAll("#code-panel .code-line").forEach((lineNode) => {
    lineNode.classList.toggle("active-line", Number(lineNode.dataset.lineNumber) === currentActiveLine);
  });
  syncVolatileCodeLineDisplay();

  const activeNode = document.querySelector(`#code-panel .code-line[data-line-number="${currentActiveLine}"]`);
  if (activeNode) {
    const panel = el("code-panel");
    const lineTop = activeNode.offsetTop;
    const lineBottom = lineTop + activeNode.offsetHeight;
    const viewTop = panel.scrollTop;
    const viewBottom = viewTop + panel.clientHeight;

    if (lineTop < viewTop) {
      panel.scrollTop = lineTop;
    } else if (lineBottom > viewBottom) {
      panel.scrollTop = lineBottom - panel.clientHeight;
    }
  }
}

function scrollExecutionHostsToBottom() {
  const hosts = [el("step-description"), el("side-step-description")].filter(Boolean);
  window.requestAnimationFrame(() => {
    hosts.forEach((host) => {
      host.scrollTop = host.scrollHeight;
    });
    window.requestAnimationFrame(() => {
      hosts.forEach((host) => {
        host.scrollTop = host.scrollHeight;
      });
    });
  });
}

function executionStepMarkup(bodyText, sequence, { placeholder = false } = {}) {
  const extraClass = placeholder ? " execution-step-entry-placeholder" : "";
  const marker = placeholder
    ? ""
    : `<div class="execution-step-marker">Step ${sequence}</div>`;
  const dataAttr = placeholder ? "" : ` data-step-index="${sequence}"`;
  return `
    <div class="execution-step-entry is-current${extraClass}"${dataAttr}>
      ${marker}
      <p class="execution-step-body">${escapeHtml(bodyText)}</p>
    </div>
  `;
}

function clearExecutionSteps(placeholderText) {
  executionStepSerial = 0;
  const mainFeed = el("execution-steps-feed");
  const sideFeed = el("side-execution-steps-feed");
  const fallback = "Choose a scenario to follow each JVM step.";
  const text =
    placeholderText === undefined || placeholderText === null ? fallback : placeholderText;

  const clearFeeds = () => {
    if (mainFeed) {
      mainFeed.innerHTML = "";
    }
    if (sideFeed) {
      sideFeed.innerHTML = "";
    }
  };

  if (text.trim() === "") {
    clearFeeds();
    scrollExecutionHostsToBottom();
    return;
  }

  const html = executionStepMarkup(text, 0, { placeholder: true });
  if (mainFeed) {
    mainFeed.innerHTML = html;
  }
  if (sideFeed) {
    sideFeed.innerHTML = html;
  }
  scrollExecutionHostsToBottom();
}

function appendExecutionStep(description) {
  const body = typeof description === "string" ? description.trim() : "";
  const text = body || "(No description)";
  executionStepSerial += 1;
  const n = executionStepSerial;
  const html = executionStepMarkup(text, n);

  [[el("execution-steps-feed"), el("step-description")], [el("side-execution-steps-feed"), el("side-step-description")]].forEach(
    ([feed]) => {
      if (!feed) {
        return;
      }
      feed.querySelectorAll(".execution-step-entry.is-current").forEach((node) => {
        node.classList.remove("is-current");
      });
      feed.querySelectorAll(".execution-step-entry-placeholder").forEach((node) => {
        node.remove();
      });
      feed.insertAdjacentHTML("beforeend", html);
    }
  );

  scrollExecutionHostsToBottom();
}

/** @deprecated single-line updates; playback uses append-only timeline */
function setStepDescription(text) {
  clearExecutionSteps(text);
}

function getMemorySnapshot() {
  const counts = {
    eden: state.heap.eden.length,
    s0: state.heap.s0.length,
    s1: state.heap.s1.length,
    old: state.heap.old.length,
    stringPool: state.heap.stringPool.length
  };
  // Keep per-object heap cost stable across generations so promotions shift usage
  // between regions without artificially inflating total heap consumption.
  const regularObjectSize = 12;
  const pooledStringSize = 8;
  const youngUsed = (counts.eden + counts.s0 + counts.s1) * regularObjectSize;
  const oldUsed = counts.old * regularObjectSize;
  const poolUsed = counts.stringPool * pooledStringSize;
  const heapUsed = youngUsed + oldUsed + poolUsed;
  const stackRoots2 = (state.stack2 || []).reduce((sum, frame) => sum + Object.keys(frame.locals).length, 0);
  const stackRoots =
    state.stack.reduce((sum, frame) => sum + Object.keys(frame.locals).length, 0) + stackRoots2;
  const stackFrameCount = state.stack.length + (state.stack2 || []).length;
  const stackUsed = stackRoots * 6 + stackFrameCount * 10;
  return {
    youngUsed,
    oldUsed,
    poolUsed,
    heapUsed,
    stackUsed,
    totalObjects: Object.keys(state.objects).length
  };
}

function pushMemorySnapshot() {
  const snapshot = getMemorySnapshot();
  const signature = JSON.stringify({
    heap: state.heap,
    stack: state.stack,
    stack2: state.stack2 || [],
    deleted: Object.keys(state.objects).filter((id) => state.objects[id]?.deleted)
  });

  if (signature === lastMemorySignature) {
    return;
  }

  lastMemorySignature = signature;
  memoryHistory.push(snapshot);
  if (memoryHistory.length > 28) {
    memoryHistory = memoryHistory.slice(-28);
  }
}

function linePath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function areaPath(points, baseY) {
  if (!points.length) {
    return "";
  }
  return `${linePath(points)} L ${points[points.length - 1].x} ${baseY} L ${points[0].x} ${baseY} Z`;
}

function renderMemoryLegend(snapshot) {
  const legend = el("memory-legend");
  const items = [
    { label: "Heap Used", color: "#38bdf8", value: `${snapshot.heapUsed} MB` },
    { label: "Young Gen", color: "#0ea5e9", value: `${snapshot.youngUsed} MB` },
    { label: "Old Gen", color: "#f59e0b", value: `${snapshot.oldUsed} MB` },
    { label: "Stack", color: "#22c55e", value: `${snapshot.stackUsed} MB` }
  ];

  legend.innerHTML = items.map((item) => `
    <div class="memory-card">
      <div class="memory-card-label">
        <span class="memory-swatch" style="background:${item.color}"></span>
        <span>${item.label}</span>
      </div>
      <div class="memory-card-value">${item.value}</div>
    </div>
  `).join("");
}

function renderMemoryChart() {
  pushMemorySnapshot();
  const chart = el("memory-chart");
  if (!chart || !memoryHistory.length) {
    return;
  }

  const width = 960;
  const height = 240;
  const padding = { top: 18, right: 20, bottom: 28, left: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxHeap = Math.max(...memoryHistory.map((entry) => Math.max(entry.heapUsed, entry.stackUsed, 12)));
  const scaleMax = Math.max(80, Math.ceil(maxHeap / 10) * 10);
  const xStep = memoryHistory.length > 1 ? plotWidth / (memoryHistory.length - 1) : plotWidth;
  const toY = (value) => padding.top + plotHeight - (value / scaleMax) * plotHeight;
  const heapPoints = memoryHistory.map((entry, index) => ({
    x: padding.left + index * xStep,
    y: toY(entry.heapUsed)
  }));
  const oldPoints = memoryHistory.map((entry, index) => ({
    x: padding.left + index * xStep,
    y: toY(entry.oldUsed)
  }));
  const stackPoints = memoryHistory.map((entry, index) => ({
    x: padding.left + index * xStep,
    y: toY(entry.stackUsed)
  }));
  const baseY = padding.top + plotHeight;
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padding.top + plotHeight * ratio;
    const value = Math.round(scaleMax * (1 - ratio));
    return `
      <line class="chart-grid-line" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>
      <text class="chart-label" x="8" y="${y + 4}">${value} MB</text>
    `;
  }).join("");

  const tickLabels = memoryHistory.map((entry, index) => {
    if (memoryHistory.length > 10 && index % 3 !== 0 && index !== memoryHistory.length - 1) {
      return "";
    }
    return `<text class="chart-label" x="${padding.left + index * xStep}" y="${height - 8}" text-anchor="middle">t${index + 1}</text>`;
  }).join("");

  chart.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
    ${gridLines}
    <line class="chart-axis-line" x1="${padding.left}" y1="${baseY}" x2="${width - padding.right}" y2="${baseY}"></line>
    <path class="chart-area-heap" d="${areaPath(heapPoints, baseY)}"></path>
    <path class="chart-line-old" d="${linePath(oldPoints)}"></path>
    <path class="chart-line-stack" d="${linePath(stackPoints)}"></path>
    <path class="chart-line-heap" d="${linePath(heapPoints)}"></path>
    ${heapPoints.map((point) => `<circle class="chart-dot" cx="${point.x}" cy="${point.y}" r="3.8" fill="#38bdf8"></circle>`).join("")}
    ${tickLabels}
  `;

  renderMemoryLegend(memoryHistory[memoryHistory.length - 1]);
}

function resetMemoryTelemetry() {
  memoryHistory = [];
  lastMemorySignature = null;
}

function render(onSelect) {
  const workspace = document.querySelector(".workspace");
  if (workspace) {
    workspace.classList.toggle("dual-thread-layout", Boolean(state.ui.volatileShowSecondStack));
  }

  renderStack(onSelect);
  renderHeap(onSelect);
  renderSidePanel();
  renderVisibilityBanner();
  scheduleReferenceLinesRedraw();
  syncVolatileCodeLineDisplay();
  renderMemoryChart();
}

function captureObjectLayout() {
  const positions = {};
  document.querySelectorAll(".heap-object").forEach((node) => {
    positions[node.dataset.objectId] = node.getBoundingClientRect();
  });
  return positions;
}

window.JVMSim = {
  ...(window.JVMSim || {}),
  render,
  captureObjectLayout,
  renderCodePanel,
  highlightCodeLine,
  clearExecutionSteps,
  appendExecutionStep,
  setStepDescription,
  resetMemoryTelemetry
};
})();
