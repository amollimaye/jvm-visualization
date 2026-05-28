(() => {
const MAX_OBJECTS = 10;

const baseUi = () => ({
  selected: null,
  lastEvent: "The simulator is ready. Choose a scenario to start.",
  explanation: "This visualization models simplified JVM memory rules with deterministic behavior.",
  runningScenario: null,
  highlightThread: null,
  memoryArrow: null,
  visibilityBanner: null,
  highlightCodeVolatile: false,
  heapDumpModalOpen: false,
  heapDumpCapturing: false,
  heapDumpSelectedId: null,
  threadDumpModalOpen: false,
  threadDumpModalThreadKey: null,
  threadDumpSelectedFrameIndex: null,
  stepCounter: 0,
  // Dual-stack layout after Volatile Behavior; cleared when another scenario starts or reset.
  volatileShowSecondStack: false
});

const baseState = () => ({
  objects: {},
  heap: {
    eden: [],
    s0: [],
    s1: [],
    old: [],
    stringPool: []
  },
  stack: [],
  stack2: [],
  sharedObject: {
    counter: 0,
    volatile: false
  },
  threadLocal: {
    T1: { counter: 0 },
    T2: { counter: 0 }
  },
  heapDump: null,
  threadDumps: {
    T1: null,
    T2: null
  },
  ui: baseUi()
});

const state = baseState();

let objectCounter = 0;

function resetObjectCounter() {
  objectCounter = 0;
}

function nextObjectId() {
  objectCounter += 1;
  return `obj${objectCounter}`;
}

function heapSections() {
  return ["eden", "s0", "s1", "old", "stringPool"];
}

function removeObjectFromHeap(objectId) {
  for (const section of heapSections()) {
    state.heap[section] = state.heap[section].filter((id) => id !== objectId);
  }
}

function currentHeapSection(objectId) {
  return heapSections().find((section) => state.heap[section].includes(objectId)) || null;
}

function localReferences() {
  const from1 = state.stack.flatMap((frame) => Object.values(frame.locals)).filter(Boolean);
  const from2 = (state.stack2 || []).flatMap((frame) => Object.values(frame.locals)).filter(Boolean);
  return [...from1, ...from2];
}

function markEvent(lastEvent, explanation) {
  state.ui.lastEvent = lastEvent;
  state.ui.explanation = explanation;
}

function resetState() {
  const fresh = baseState();
  state.objects = fresh.objects;
  state.heap = fresh.heap;
  state.stack = fresh.stack;
  state.stack2 = fresh.stack2;
  state.sharedObject = fresh.sharedObject;
  state.threadLocal = fresh.threadLocal;
  state.ui = fresh.ui;
  resetObjectCounter();
}

function setSelectedSelection(selection) {
  state.ui.selected = selection;
}

function setScenarioRunning(name) {
  state.ui.runningScenario = name;
}

function clearScenarioRunning() {
  state.ui.runningScenario = null;
  // MEMORY_VISIBILITY-only UI; clear so overlays do not linger after playback ends.
  state.ui.memoryArrow = null;
  state.ui.highlightThread = null;
  state.ui.visibilityBanner = null;
  state.ui.highlightCodeVolatile = false;
  // Keep volatileShowSecondStack: Thread 2 stays visible after Volatile Behavior until another scenario or reset.
}

function liveObjects() {
  return Object.values(state.objects).filter((object) => object && !object.deleted);
}

function objectLabelFromLocals(objectId) {
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
  return names[0] || objectId;
}

function shallowSizeKB(object) {
  if (object.type === "String") {
    return 8;
  }
  if (object.type === "SharedObject") {
    return 20;
  }
  return 12;
}

function retainedSizeKB(object, gcRoots) {
  const shallow = shallowSizeKB(object);
  const ageWeight = Math.max(1, Number(object.age || 0) + 1);
  const rootBonus = gcRoots.has(object.id) ? 8 : 2;
  return shallow * ageWeight + rootBonus;
}

function sectionObjects(section, gcRoots) {
  return state.heap[section].map((id) => state.objects[id]).filter((object) => object && !object.deleted).map((object) => ({
    id: object.id,
    type: object.type,
    label: objectLabelFromLocals(object.id),
    generation: object.generation,
    age: object.age ?? 0,
    section: object.section,
    markStatus: object.markStatus ?? null,
    reachability: gcRoots.has(object.id) ? "gc-root-linked" : (object.markStatus === "unreachable" ? "unreachable" : "reachable"),
    shallowSizeKB: shallowSizeKB(object),
    retainedSizeKB: retainedSizeKB(object, gcRoots)
  }));
}

function memoryFromHeap() {
  const heapCounts = {
    eden: state.heap.eden.length,
    s0: state.heap.s0.length,
    s1: state.heap.s1.length,
    old: state.heap.old.length,
    stringPool: state.heap.stringPool.length
  };
  return (heapCounts.eden + heapCounts.s0 + heapCounts.s1 + heapCounts.old) * 12 + heapCounts.stringPool * 8;
}

function captureHeapDumpSnapshot() {
  const gcRoots = new Set(localReferences());
  const objects = liveObjects();
  const classes = new Set(objects.map((object) => object.type));
  const regions = {
    eden: sectionObjects("eden", gcRoots),
    s0: sectionObjects("s0", gcRoots),
    s1: sectionObjects("s1", gcRoots),
    old: sectionObjects("old", gcRoots),
    stringPool: sectionObjects("stringPool", gcRoots)
  };
  state.heapDump = {
    capturedAtStep: `t${state.ui.stepCounter}`,
    capturedAtIso: new Date().toISOString(),
    summary: {
      heapUsedMB: memoryFromHeap(),
      objectCount: objects.length,
      threadCount: 1 + ((state.stack2 || []).length > 0 ? 1 : 0),
      classCount: classes.size,
      gcRootsCount: gcRoots.size
    },
    regions
  };
  state.ui.heapDumpSelectedId = null;
  return state.heapDump;
}

function clearHeapDumpSnapshot() {
  state.heapDump = null;
  state.ui.heapDumpModalOpen = false;
  state.ui.heapDumpSelectedId = null;
}

function stackForThread(threadKey) {
  return threadKey === "T2" ? (state.stack2 || []) : state.stack;
}

function localTargetLabel(value, threadKey) {
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

function captureThreadDumpSnapshot(threadKey) {
  const frames = stackForThread(threadKey).map((frame, index) => {
    const locals = Object.entries(frame.locals).map(([name, value]) => ({
      name,
      value,
      displayValue: localTargetLabel(value, threadKey)
    }));
    return {
      index,
      method: frame.method,
      localCount: locals.length,
      locals
    };
  });

  const localValues = frames.flatMap((frame) => frame.locals.map((local) => local.value));
  const rootRefCount = localValues.filter((value) => typeof value === "string" && Boolean(state.objects[value])).length;
  const threadLabel = threadKey === "T2" ? "Thread 2" : "Thread 1";

  state.threadDumps[threadKey] = {
    threadKey,
    capturedAtStep: `t${state.ui.stepCounter}`,
    capturedAtIso: new Date().toISOString(),
    summary: {
      frameCount: frames.length,
      localCount: frames.reduce((sum, frame) => sum + frame.localCount, 0),
      rootRefCount,
      topMethod: frames.length ? frames[frames.length - 1].method : "none",
      threadState: state.ui.runningScenario ? "RUNNABLE" : "WAITING",
      threadLabel
    },
    frames
  };
  state.ui.threadDumpSelectedFrameIndex = null;
  return state.threadDumps[threadKey];
}

function clearThreadDumpSnapshots() {
  state.threadDumps = {
    T1: null,
    T2: null
  };
  state.ui.threadDumpModalOpen = false;
  state.ui.threadDumpModalThreadKey = null;
  state.ui.threadDumpSelectedFrameIndex = null;
}

function setThreadDumpModalOpen(isOpen, threadKey = null) {
  state.ui.threadDumpModalOpen = Boolean(isOpen);
  state.ui.threadDumpModalThreadKey = isOpen ? threadKey : null;
  if (!isOpen) {
    state.ui.threadDumpSelectedFrameIndex = null;
  }
}

function setThreadDumpSelectedFrame(index) {
  state.ui.threadDumpSelectedFrameIndex = Number.isInteger(index) ? index : null;
}

function setHeapDumpCapturing(isCapturing) {
  state.ui.heapDumpCapturing = Boolean(isCapturing);
}

function setHeapDumpModalOpen(isOpen) {
  state.ui.heapDumpModalOpen = Boolean(isOpen);
}

function setHeapDumpSelectedObject(objectId) {
  state.ui.heapDumpSelectedId = objectId || null;
}

function incrementStepCounter() {
  state.ui.stepCounter += 1;
}

function getStateSnapshot() {
  return structuredClone(state);
}

function getReachableObjectIds() {
  return [...new Set(localReferences())].filter((id) => state.objects[id] && !state.objects[id].deleted);
}

function createObject(payload) {
  if (Object.keys(state.objects).filter((key) => !state.objects[key].deleted).length >= MAX_OBJECTS) {
    throw new Error("Maximum object count reached.");
  }

  const objectId = payload.id || nextObjectId();

  // The single state tree is the source of truth for both simulation and rendering.
  state.objects[objectId] = {
    id: objectId,
    type: payload.type,
    value: payload.value,
    generation: payload.generation,
    age: payload.age ?? 0,
    section: payload.section,
    literal: payload.literal ?? false,
    markStatus: payload.markStatus ?? null,
    deleted: false,
    pendingDelete: false
  };

  state.heap[payload.section].push(objectId);
  return objectId;
}

function updateStack(payload) {
  switch (payload.action) {
    case "PUSH_FRAME": {
      state.stack.push({
        method: payload.method,
        locals: { ...(payload.locals || {}) }
      });
      break;
    }
    case "POP_FRAME": {
      state.stack.pop();
      break;
    }
    case "SET_LOCAL": {
      const frame = state.stack[payload.frameIndex];
      if (!frame) {
        throw new Error(`No stack frame at index ${payload.frameIndex}`);
      }
      if (payload.value === null) {
        delete frame.locals[payload.name];
      } else {
        frame.locals[payload.name] = payload.value;
      }
      break;
    }
    default:
      throw new Error(`Unknown stack action: ${payload.action}`);
  }
}

function moveObject(payload) {
  const object = state.objects[payload.id];
  if (!object || object.deleted) {
    throw new Error(`Cannot move missing object: ${payload.id}`);
  }

  removeObjectFromHeap(payload.id);
  state.heap[payload.to].push(payload.id);
  object.section = payload.to;
  object.generation = payload.generation ?? object.generation;
  object.age = payload.age ?? object.age;
  object.markStatus = payload.markStatus ?? object.markStatus;
}

function markObjects(payload) {
  const reachable = new Set(payload.reachable || []);
  const unreachable = new Set(payload.unreachable || []);

  Object.values(state.objects).forEach((object) => {
    if (reachable.has(object.id)) {
      object.markStatus = "reachable";
    } else if (unreachable.has(object.id)) {
      object.markStatus = "unreachable";
    } else if (payload.clearOthers) {
      object.markStatus = null;
    }
  });
}

function clearObjectMarks() {
  Object.values(state.objects).forEach((object) => {
    object.markStatus = null;
  });
}

function deleteObject(payload) {
  const object = state.objects[payload.id];
  if (!object || object.deleted) {
    return;
  }

  // Mark first so the renderer can animate the disappearing object before final removal.
  object.pendingDelete = true;
  object.deleted = true;
  const purgeRefsFrom = (stack) => {
    stack.forEach((frame) => {
      Object.entries(frame.locals).forEach(([name, value]) => {
        if (value === payload.id) {
          delete frame.locals[name];
        }
      });
    });
  };
  purgeRefsFrom(state.stack);
  purgeRefsFrom(state.stack2 || []);
}

function finalizeDeletion(objectId) {
  removeObjectFromHeap(objectId);
  delete state.objects[objectId];

  if (state.ui.selected?.kind === "object" && state.ui.selected.id === objectId) {
    state.ui.selected = null;
  }
}

function ensureStringLiteral(value) {
  const existingId = state.heap.stringPool.find((objectId) => {
    const object = state.objects[objectId];
    return object && object.value === value && !object.deleted;
  });

  if (existingId) {
    return { objectId: existingId, reused: true };
  }

  const objectId = createObject({
    type: "String",
    value,
    generation: "pool",
    age: 0,
    section: "stringPool",
    literal: true
  });

  return { objectId, reused: false };
}

function getObjectDetails(objectId) {
  const object = state.objects[objectId];
  if (!object) {
    return null;
  }

  return {
    ...object,
    section: currentHeapSection(objectId) || object.section
  };
}

function getHeapDetails(section) {
  const descriptions = {
    eden: "Eden is where every newly allocated regular object starts in this simulator.",
    s0: "Survivor S0 stores objects that made it through a minor GC pass.",
    s1: "Survivor S1 is the alternate survivor space used on the next minor GC cycle.",
    old: "Old Gen holds objects that survived at least two collections in the young generation.",
    stringPool: "The string pool reuses literal String objects, while new String() still allocates a distinct heap object."
  };

  return {
    section,
    description: descriptions[section]
  };
}

function annotateStep(lastEvent, explanation) {
  markEvent(lastEvent, explanation);
}

function syncSharedHeapObject(objectId) {
  if (!objectId || !state.objects[objectId]) {
    return;
  }
  const o = state.objects[objectId];
  if (o.type !== "SharedObject") {
    return;
  }
  const vol = state.sharedObject.volatile ? ", volatile" : "";
  o.value = `SharedObject { counter: ${state.sharedObject.counter}${vol} }`;
}

function applyMemoryVisibility(payload) {
  if (payload.sharedObject) {
    state.sharedObject = {
      ...state.sharedObject,
      ...payload.sharedObject
    };
  }
  if (payload.threadLocal) {
    if (payload.threadLocal.T1) {
      state.threadLocal.T1 = { ...state.threadLocal.T1, ...payload.threadLocal.T1 };
    }
    if (payload.threadLocal.T2) {
      state.threadLocal.T2 = { ...state.threadLocal.T2, ...payload.threadLocal.T2 };
    }
  }
  if (payload.stacks) {
    if (Object.prototype.hasOwnProperty.call(payload.stacks, "t1")) {
      state.stack = payload.stacks.t1.map((frame) => ({
        method: frame.method,
        locals: { ...(frame.locals || {}) }
      }));
    }
    if (Object.prototype.hasOwnProperty.call(payload.stacks, "t2")) {
      state.stack2 = payload.stacks.t2.map((frame) => ({
        method: frame.method,
        locals: { ...(frame.locals || {}) }
      }));
    }
  }
  if (payload.ensureHeapObject) {
    const spec = payload.ensureHeapObject;
    if (!state.objects[spec.id]) {
      createObject({
        id: spec.id,
        type: "SharedObject",
        value: "",
        generation: "eden",
        age: 0,
        section: spec.section || "eden"
      });
    }
    syncSharedHeapObject(spec.id);
  }
  if (payload.volatileSharedId) {
    syncSharedHeapObject(payload.volatileSharedId);
  }
}

function setMemoryVisibilityUi(ui) {
  if (!ui) {
    state.ui.highlightThread = null;
    state.ui.memoryArrow = null;
    state.ui.visibilityBanner = null;
    state.ui.highlightCodeVolatile = false;
    state.ui.volatileShowSecondStack = false;
    return;
  }
  state.ui.highlightThread = ui.highlightThread ?? null;
  state.ui.memoryArrow = ui.memoryArrow ?? null;
  state.ui.visibilityBanner = ui.visibilityBanner ?? null;
  state.ui.highlightCodeVolatile = ui.highlightCodeVolatile ?? false;
  if (Object.prototype.hasOwnProperty.call(ui, "volatileShowSecondStack")) {
    state.ui.volatileShowSecondStack = Boolean(ui.volatileShowSecondStack);
  }
}

window.JVMSim = {
  ...(window.JVMSim || {}),
  state,
  resetState,
  setSelectedSelection,
  setScenarioRunning,
  clearScenarioRunning,
  captureHeapDumpSnapshot,
  clearHeapDumpSnapshot,
  captureThreadDumpSnapshot,
  clearThreadDumpSnapshots,
  setHeapDumpCapturing,
  setHeapDumpModalOpen,
  setHeapDumpSelectedObject,
  setThreadDumpModalOpen,
  setThreadDumpSelectedFrame,
  incrementStepCounter,
  getStateSnapshot,
  getReachableObjectIds,
  createObject,
  updateStack,
  moveObject,
  markObjects,
  clearObjectMarks,
  deleteObject,
  finalizeDeletion,
  ensureStringLiteral,
  getObjectDetails,
  getHeapDetails,
  annotateStep,
  applyMemoryVisibility,
  setMemoryVisibilityUi,
  syncSharedHeapObject
};
})();
