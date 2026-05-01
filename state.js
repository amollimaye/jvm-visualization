(() => {
const MAX_OBJECTS = 10;

const baseUi = () => ({
  selected: null,
  lastEvent: "The simulator is ready. Choose a scenario to start.",
  explanation: "This visualization models simplified JVM memory rules with deterministic behavior.",
  runningScenario: null
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
  return state.stack.flatMap((frame) => Object.values(frame.locals)).filter(Boolean);
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
  state.stack.forEach((frame) => {
    Object.entries(frame.locals).forEach(([name, value]) => {
      if (value === payload.id) {
        delete frame.locals[name];
      }
    });
  });
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

window.JVMSim = {
  ...(window.JVMSim || {}),
  state,
  resetState,
  setSelectedSelection,
  setScenarioRunning,
  clearScenarioRunning,
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
  annotateStep
};
})();
