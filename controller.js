(() => {
const {
  animateStep,
  prepareForAnimation,
  render,
  renderCodePanel,
  highlightCodeLine,
  resetMemoryTelemetry,
  clearExecutionSteps,
  captureHeapDumpSnapshot,
  clearHeapDumpSnapshot,
  captureThreadDumpSnapshot,
  clearThreadDumpSnapshots,
  appendExecutionStep,
  setHeapDumpCapturing,
  setHeapDumpModalOpen,
  setHeapDumpSelectedObject,
  setThreadDumpModalOpen,
  setThreadDumpSelectedFrame,
  incrementStepCounter,
  annotateStep,
  applyMemoryVisibility,
  clearScenarioRunning,
  clearObjectMarks,
  createObject,
  deleteObject,
  markObjects,
  moveObject,
  resetState,
  setScenarioRunning,
  setMemoryVisibilityUi,
  setSelectedSelection,
  state,
  updateStack,
  scenarios
} = window.JVMSim;

const playbackState = {
  paused: false,
  stepAdvanceRequested: false,
  resolver: null,
  modalForcedPause: false
};

function onSelect(selection) {
  if (state.ui.runningScenario && selection.kind !== "heapDumpObject" && selection.kind !== "threadDumpFrame") {
    return;
  }
  if (selection.kind === "heapDumpObject") {
    setHeapDumpSelectedObject(selection.id);
    render(onSelect);
    return;
  }
  if (selection.kind === "threadDumpFrame") {
    setThreadDumpSelectedFrame(selection.index);
    render(onSelect);
    return;
  }

  setSelectedSelection(selection);
  render(onSelect);
}

function setButtonsDisabled(disabled) {
  document.querySelectorAll("button[data-scenario], #reset-button").forEach((button) => {
    button.disabled = disabled;
  });
}

function updateScenarioButtons() {
  const running = state.ui.runningScenario;
  document.querySelectorAll("button[data-scenario]").forEach((button) => {
    button.classList.toggle("is-active", Boolean(running) && button.dataset.scenario === running);
  });
}

function updatePlaybackButtons() {
  const hasScenario = Boolean(state.ui.runningScenario);
  document.getElementById("pause-button").disabled = !hasScenario || playbackState.paused;
  document.getElementById("next-step-button").disabled = !hasScenario || !playbackState.paused;
  document.getElementById("resume-button").disabled = !hasScenario || !playbackState.paused;
}

function releasePlaybackWait() {
  if (playbackState.resolver) {
    const resolve = playbackState.resolver;
    playbackState.resolver = null;
    resolve();
  }
}

function resetPlaybackState() {
  playbackState.paused = false;
  playbackState.stepAdvanceRequested = false;
  playbackState.resolver = null;
  playbackState.modalForcedPause = false;
  updatePlaybackButtons();
  updateScenarioButtons();
}

function pausePlayback() {
  if (!state.ui.runningScenario) {
    return;
  }

  playbackState.paused = true;
  playbackState.stepAdvanceRequested = false;
  playbackState.modalForcedPause = false;
  updatePlaybackButtons();
}

function resumePlayback() {
  if (!state.ui.runningScenario) {
    return;
  }

  playbackState.paused = false;
  playbackState.stepAdvanceRequested = false;
  playbackState.modalForcedPause = false;
  releasePlaybackWait();
  updatePlaybackButtons();
}

function advanceSingleStep() {
  if (!state.ui.runningScenario || !playbackState.paused) {
    return;
  }

  playbackState.stepAdvanceRequested = true;
  releasePlaybackWait();
}

function waitForPlaybackGate() {
  if (!playbackState.paused) {
    return Promise.resolve();
  }

  if (playbackState.stepAdvanceRequested) {
    playbackState.stepAdvanceRequested = false;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    playbackState.resolver = resolve;
  }).then(() => {
    if (playbackState.stepAdvanceRequested) {
      playbackState.stepAdvanceRequested = false;
    }
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function applyStep(step) {
  if (step.type === "CREATE_OBJECT") {
    createObject(step.payload);
  } else if (step.type === "MARK_OBJECTS") {
    markObjects(step.payload);
  } else if (step.type === "CLEAR_MARKS") {
    clearObjectMarks();
  } else if (step.type === "UPDATE_STACK") {
    updateStack(step.payload);
  } else if (step.type === "MOVE_OBJECT") {
    moveObject(step.payload);
  } else if (step.type === "DELETE_OBJECT") {
    deleteObject(step.payload);
  } else if (step.type === "MEMORY_VISIBILITY") {
    applyMemoryVisibility(step.payload);
    setMemoryVisibilityUi(step.ui);
  } else {
    throw new Error(`Unknown step type: ${step.type}`);
  }
}

async function runSteps(steps) {
  for (const step of steps) {
    await waitForPlaybackGate();
    incrementStepCounter();
    highlightCodeLine(step.codeLine);
    appendExecutionStep(step.description);

    // Capture the old layout first so movement and compaction can use FLIP-style transitions.
    const previousLayout = prepareForAnimation(step);
    applyStep(step);
    annotateStep(step.narration, step.explanation);
    render(onSelect);
    await animateStep(step, previousLayout, onSelect);
  }
}

async function captureHeapDump() {
  if (state.ui.heapDumpCapturing) {
    return;
  }
  if (state.ui.runningScenario) {
    pausePlayback();
  }
  setHeapDumpCapturing(true);
  render(onSelect);
  await wait(2000);
  captureHeapDumpSnapshot();
  setHeapDumpCapturing(false);
  setHeapDumpModalOpen(false);
  annotateStep(
    `Heap Snapshot Captured (${state.heapDump?.capturedAtStep || "t0"})`,
    "Captured conceptual heap snapshot from current runtime state."
  );
  render(onSelect);
}

function openHeapDumpModal() {
  if (!state.heapDump) {
    return;
  }
  setHeapDumpModalOpen(true);
  syncModalDrivenPlayback();
  render(onSelect);
}

function closeHeapDumpModal() {
  setHeapDumpModalOpen(false);
  syncModalDrivenPlayback();
  render(onSelect);
}

function syncModalDrivenPlayback() {
  const anyDumpModalOpen = Boolean(state.ui.heapDumpModalOpen || state.ui.threadDumpModalOpen);
  if (!state.ui.runningScenario) {
    playbackState.modalForcedPause = false;
    return;
  }

  if (anyDumpModalOpen) {
    if (!playbackState.paused) {
      playbackState.paused = true;
      playbackState.stepAdvanceRequested = false;
      playbackState.modalForcedPause = true;
      updatePlaybackButtons();
    }
    return;
  }

  if (playbackState.modalForcedPause && playbackState.paused) {
    playbackState.paused = false;
    playbackState.stepAdvanceRequested = false;
    playbackState.modalForcedPause = false;
    releasePlaybackWait();
    updatePlaybackButtons();
  }
}

function captureThreadDump(threadKey) {
  captureThreadDumpSnapshot(threadKey);
  setThreadDumpModalOpen(false);
  annotateStep(
    `${threadKey === "T2" ? "Thread 2" : "Thread 1"} Snapshot Captured (${state.threadDumps?.[threadKey]?.capturedAtStep || "t0"})`,
    "Captured conceptual thread dump from current stack frames."
  );
  render(onSelect);
}

function openThreadDumpModal(threadKey) {
  if (!state.threadDumps?.[threadKey]) {
    return;
  }
  setThreadDumpModalOpen(true, threadKey);
  syncModalDrivenPlayback();
  render(onSelect);
}

function closeThreadDumpModal() {
  setThreadDumpModalOpen(false);
  syncModalDrivenPlayback();
  render(onSelect);
}

async function runScenario(name) {
  const scenarioSource = scenarios[name];
  const scenario = typeof scenarioSource === "function" ? scenarioSource() : scenarioSource;
  if (!scenario) {
    return;
  }

  // Selecting a new animation/scenario invalidates previous dumps.
  clearHeapDumpSnapshot();
  clearThreadDumpSnapshots();
  setHeapDumpCapturing(false);

  setButtonsDisabled(true);
  if (!scenario.preserveState) {
    resetState();
    resetMemoryTelemetry();
  } else {
    clearObjectMarks();
  }
  if (name !== "volatileBehavior") {
    state.ui.volatileShowSecondStack = false;
  }
  setScenarioRunning(name);
  updateScenarioButtons();
  resetPlaybackState();
  updatePlaybackButtons();
  renderCodePanel(scenario.code);
  highlightCodeLine(null);
  clearExecutionSteps("");
  appendExecutionStep("Choose a highlighted line to follow the next JVM state change.");
  annotateStep(scenario.intro.title, scenario.intro.why);
  render(onSelect);

  try {
    await runSteps(scenario.steps);
  } finally {
    clearScenarioRunning();
    updateScenarioButtons();
    resetPlaybackState();
    setButtonsDisabled(false);
    render(onSelect);
  }
}

function handleReset() {
  resetState();
  clearObjectMarks();
  resetMemoryTelemetry();
  resetPlaybackState();
  clearHeapDumpSnapshot();
  clearThreadDumpSnapshots();
  setHeapDumpCapturing(false);
  renderCodePanel([]);
  highlightCodeLine(null);
  clearExecutionSteps("Choose a scenario to follow each JVM step.");
  annotateStep(
    "Reset the simulator to an empty, deterministic baseline.",
    "All objects, references, and frames were cleared so the next scenario starts from a known state."
  );
  render(onSelect);
  updateScenarioButtons();
}

function initController() {
  document.querySelectorAll("button[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.ui.runningScenario) {
        return;
      }
      runScenario(button.dataset.scenario);
    });
  });

  document.getElementById("pause-button").addEventListener("click", pausePlayback);
  document.getElementById("next-step-button").addEventListener("click", advanceSingleStep);
  document.getElementById("resume-button").addEventListener("click", resumePlayback);
  document.getElementById("reset-button").addEventListener("click", handleReset);
  document.getElementById("heap-dump-button").addEventListener("click", () => {
    captureHeapDump();
  });
  document.getElementById("show-heap-dump-button").addEventListener("click", openHeapDumpModal);
  document.getElementById("close-heap-dump-button").addEventListener("click", closeHeapDumpModal);
  document.querySelector('[data-heap-dump-close="overlay"]')?.addEventListener("click", closeHeapDumpModal);
  document.getElementById("thread-dump-button-t1").addEventListener("click", () => {
    captureThreadDump("T1");
  });
  document.getElementById("thread-dump-button-t2").addEventListener("click", () => {
    captureThreadDump("T2");
  });
  document.getElementById("show-thread-dump-button-t1").addEventListener("click", () => {
    openThreadDumpModal("T1");
  });
  document.getElementById("show-thread-dump-button-t2").addEventListener("click", () => {
    openThreadDumpModal("T2");
  });
  document.getElementById("close-thread-dump-button").addEventListener("click", closeThreadDumpModal);
  document.querySelector('[data-thread-dump-close="overlay"]')?.addEventListener("click", closeThreadDumpModal);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.ui.heapDumpModalOpen) {
      closeHeapDumpModal();
      return;
    }
    if (event.key === "Escape" && state.ui.threadDumpModalOpen) {
      closeThreadDumpModal();
    }
  });

  window.addEventListener("resize", () => {
    if (state.ui.runningScenario) {
      return;
    }
    render(onSelect);
  });
  updatePlaybackButtons();
  handleReset();
}

window.JVMSim = {
  ...(window.JVMSim || {}),
  runScenario,
  initController
};
})();
