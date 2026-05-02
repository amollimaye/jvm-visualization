(() => {
const {
  animateStep,
  prepareForAnimation,
  render,
  renderCodePanel,
  highlightCodeLine,
  resetMemoryTelemetry,
  clearExecutionSteps,
  appendExecutionStep,
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
  resolver: null
};

function onSelect(selection) {
  if (state.ui.runningScenario) {
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
  updatePlaybackButtons();
}

function pausePlayback() {
  if (!state.ui.runningScenario) {
    return;
  }

  playbackState.paused = true;
  playbackState.stepAdvanceRequested = false;
  updatePlaybackButtons();
}

function resumePlayback() {
  if (!state.ui.runningScenario) {
    return;
  }

  playbackState.paused = false;
  playbackState.stepAdvanceRequested = false;
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

async function runScenario(name) {
  const scenarioSource = scenarios[name];
  const scenario = typeof scenarioSource === "function" ? scenarioSource() : scenarioSource;
  if (!scenario) {
    return;
  }

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
  renderCodePanel([]);
  highlightCodeLine(null);
  clearExecutionSteps("Choose a scenario to follow each JVM step.");
  annotateStep(
    "Reset the simulator to an empty, deterministic baseline.",
    "All objects, references, and frames were cleared so the next scenario starts from a known state."
  );
  render(onSelect);
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
