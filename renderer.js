(() => {
const { getHeapDetails, getObjectDetails, getReachableObjectIds, state } = window.JVMSim;
let currentCodeLines = [];
let currentActiveLine = null;
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
  state.stack.forEach((frame) => {
    Object.entries(frame.locals).forEach(([name, value]) => {
      if (value === objectId) {
        names.push(name);
      }
    });
  });
  return names;
}

function renderStack(onSelect) {
  const stackRoot = el("stack-root");
  stackRoot.innerHTML = "";

  state.stack.forEach((frame, frameIndex) => {
    const frameNode = document.createElement("article");
    frameNode.className = "stack-frame";
    frameNode.dataset.frameIndex = String(frameIndex);

    if (state.ui.selected?.kind === "frame" && state.ui.selected.index === frameIndex) {
      frameNode.classList.add("is-selected");
    }

    const localRows = Object.entries(frame.locals).map(([name, value]) => `
      <div class="local-row" data-object-anchor="${value}">
        <span class="local-name">${name}</span>
        <span class="local-target">${value ?? "null"}</span>
      </div>
    `).join("") || `<div class="local-row"><span class="local-name">No locals</span><span class="local-target">empty</span></div>`;

    frameNode.innerHTML = `
      <h3>${frame.method}()</h3>
      <span class="frame-badge">Frame ${frameIndex}</span>
      <div class="locals-list">${localRows}</div>
    `;

    frameNode.addEventListener("click", () => onSelect({
      kind: "frame",
      index: frameIndex
    }));

    stackRoot.appendChild(frameNode);
  });
}

function buildObjectNode(objectId, onSelect) {
  const object = getObjectDetails(objectId);
  if (!object) {
    return null;
  }
  const reachableIds = new Set(getReachableObjectIds());
  const isOrphan = !reachableIds.has(objectId);
  const referenceNames = getReferenceNamesForObject(objectId);
  const objectLabel = referenceNames.length ? referenceNames.join(", ") : "orphan";

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
    const frame = state.stack[selected.index];
    if (!frame) {
      selectionRoot.innerHTML = "<p>The selected frame is no longer on the stack.</p>";
      return;
    }

    const items = Object.entries(frame.locals).map(([name, value]) => `<li><strong>${name}</strong> -> ${value}</li>`).join("");
    selectionRoot.innerHTML = `
      <div class="selection-card">
        <p><strong>${frame.method}()</strong></p>
        ${items ? `<ul>${items}</ul>` : "<p>No local variables in this frame.</p>"}
      </div>
    `;
  }
}

function renderReferenceLines() {
  const layer = el("reference-layer");
  layer.innerHTML = "";
}

function renderCodePanel(codeLines) {
  currentCodeLines = codeLines || [];
  const panel = el("code-panel");
  panel.innerHTML = currentCodeLines.map((line, index) => `
    <div class="code-line${currentActiveLine === index + 1 ? " active-line" : ""}" data-line-number="${index + 1}">
      <span class="code-line-number">${index + 1}</span>
      <span class="code-line-text">${escapeHtml(line)}</span>
    </div>
  `).join("") || `<div class="code-line"><span class="code-line-number">1</span><span class="code-line-text">Run a scenario to load Java code.</span></div>`;
}

function highlightCodeLine(lineNumber) {
  currentActiveLine = lineNumber ?? null;
  document.querySelectorAll("#code-panel .code-line").forEach((lineNode) => {
    lineNode.classList.toggle("active-line", Number(lineNode.dataset.lineNumber) === currentActiveLine);
  });

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

function setStepDescription(text) {
  const description = text || "Choose a scenario to follow each JVM step.";
  el("step-description").textContent = description;
  el("side-step-description").textContent = description;
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
  const stackRoots = state.stack.reduce((sum, frame) => sum + Object.keys(frame.locals).length, 0);
  const stackUsed = stackRoots * 6 + state.stack.length * 10;
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
  renderStack(onSelect);
  renderHeap(onSelect);
  renderSidePanel();
  renderReferenceLines();
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
  setStepDescription,
  resetMemoryTelemetry
};
})();
