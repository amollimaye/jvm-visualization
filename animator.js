(() => {
const { captureObjectLayout, render, finalizeDeletion, state } = window.JVMSim;

const ANIMATION_SPEED = 2.0;
const HIGHLIGHT_DURATION = 300;
const MOTION_DURATION = 700;
const SETTLE_DURATION = 200;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function scaledDuration(duration) {
  return duration * ANIMATION_SPEED;
}

function highlightPhase(duration = HIGHLIGHT_DURATION) {
  return wait(scaledDuration(duration));
}

function settlePhase(duration = SETTLE_DURATION) {
  return wait(scaledDuration(duration));
}

function setTransitionTiming(node, duration) {
  node.style.transition = `transform ${duration}ms ease-in-out, opacity ${duration}ms ease-in-out, box-shadow 220ms ease, outline-color 220ms ease`;
}

function setReferenceLayerVisibility(isVisible) {
  const layer = document.getElementById("reference-layer");
  if (!layer) {
    return;
  }

  layer.style.transition = "opacity 180ms ease";
  layer.style.opacity = isVisible ? "1" : "0";
}

function isReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches);
}

function clearTransferHighlights() {
  document.querySelectorAll(".heap-section.is-transfer-source, .heap-section.is-transfer-target").forEach((node) => {
    node.classList.remove("is-transfer-source", "is-transfer-target");
  });
}

function setTransferHighlights(sourceSection, targetSection) {
  clearTransferHighlights();
  if (sourceSection) {
    const sourceNode = document.querySelector(`.heap-section[data-section="${sourceSection}"]`);
    if (sourceNode) {
      sourceNode.classList.add("is-transfer-source");
    }
  }
  if (targetSection) {
    const targetNode = document.querySelector(`.heap-section[data-section="${targetSection}"]`);
    if (targetNode) {
      targetNode.classList.add("is-transfer-target");
    }
  }
}

function animateCreate(duration) {
  const objectNode = document.querySelector(`.heap-object[data-object-id="${state.ui.pendingObjectId}"]`);
  if (!objectNode) {
    return wait(duration);
  }

  setTransitionTiming(objectNode, duration);
  objectNode.classList.add("enter-start");
  requestAnimationFrame(() => {
    objectNode.classList.add("enter-active");
    objectNode.classList.remove("enter-start");
  });

  return wait(duration).then(() => {
    objectNode.classList.remove("enter-active");
    objectNode.style.transition = "";
  });
}

function animateDelete(previousLayout, onSelect, objectId, duration) {
  const objectNode = document.querySelector(`.heap-object[data-object-id="${state.ui.pendingObjectId}"]`);
  if (!objectNode) {
    finalizeDeletion(objectId);
    render(onSelect);
    return wait(duration);
  }

  setTransitionTiming(objectNode, duration / 2);
  objectNode.classList.add("delete-active");
  return wait(duration / 2).then(async () => {
    finalizeDeletion(objectId);
    render(onSelect);
    await animateMove(previousLayout, duration / 2);
  });
}

function animateMove(previousLayout, duration) {
  const reducedMotion = isReducedMotion();
  const pendingMove = state.ui.pendingMove || null;
  const movingNodeIds = [];
  let maxDelayMs = 0;
  let effectiveDuration = duration;
  document.querySelectorAll(".heap-object").forEach((node, index) => {
    const previousBox = previousLayout[node.dataset.objectId];
    if (!previousBox) {
      return;
    }

    const currentBox = node.getBoundingClientRect();
    const deltaX = previousBox.left - currentBox.left;
    const deltaY = previousBox.top - currentBox.top;
    if (!deltaX && !deltaY) {
      return;
    }

    const thisDuration = reducedMotion ? 80 : duration;
    const delayMs = reducedMotion ? 0 : Math.min(index * 70, 220);
    effectiveDuration = Math.max(effectiveDuration, thisDuration);
    maxDelayMs = Math.max(maxDelayMs, delayMs);
    setTransitionTiming(node, thisDuration);
    node.style.transitionDelay = `${delayMs}ms`;
    node.classList.add("is-moving");
    movingNodeIds.push(node.dataset.objectId);
    node.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    requestAnimationFrame(() => {
      node.style.transform = reducedMotion ? "scale(1)" : "scale(1.03)";
      requestAnimationFrame(() => {
        node.style.transform = "";
      });
    });
  });

  if (pendingMove) {
    setTransferHighlights(pendingMove.from, pendingMove.to);
  }

  const totalWaitMs = reducedMotion ? 90 : effectiveDuration + maxDelayMs + 40;
  return wait(totalWaitMs).then(() => {
    document.querySelectorAll(".heap-object").forEach((node) => {
      node.style.transition = "";
      node.style.transitionDelay = "";
      if (movingNodeIds.includes(node.dataset.objectId)) {
        node.classList.remove("is-moving");
      }
    });
    clearTransferHighlights();
  });
}

function runAnimation(step, previousLayout, onSelect, duration) {
  if (step.type === "MARK_OBJECTS" || step.type === "CLEAR_MARKS" || step.type === "MEMORY_VISIBILITY") {
    return wait(duration);
  }
  if (step.type === "CREATE_OBJECT") {
    return animateCreate(duration);
  }
  if (step.type === "DELETE_OBJECT") {
    return animateDelete(previousLayout, onSelect, step.payload.id, duration);
  }
  if (step.type === "MOVE_OBJECT") {
    return animateMove(previousLayout, duration);
  }
  return wait(duration);
}

async function animateStep(step, previousLayout, onSelect) {
  const reducedMotion = isReducedMotion();
  if (step.instantRender) {
    await wait(reducedMotion ? 20 : scaledDuration(20));
    delete state.ui.pendingObjectId;
    delete state.ui.pendingMove;
    return;
  }

  const hasMotion = step.type === "CREATE_OBJECT" || step.type === "MOVE_OBJECT" || step.type === "DELETE_OBJECT";
  await highlightPhase(reducedMotion ? 40 : HIGHLIGHT_DURATION);
  if (hasMotion) {
    setReferenceLayerVisibility(false);
  }
  await runAnimation(step, previousLayout, onSelect, reducedMotion ? 80 : scaledDuration(MOTION_DURATION));
  await settlePhase(reducedMotion ? 40 : SETTLE_DURATION);
  if (hasMotion) {
    setReferenceLayerVisibility(true);
  }

  delete state.ui.pendingObjectId;
  delete state.ui.pendingMove;
}

function prepareForAnimation(step) {
  if (step.type === "CREATE_OBJECT" || step.type === "DELETE_OBJECT") {
    state.ui.pendingObjectId = step.payload.id;
  }
  if (step.type === "MOVE_OBJECT") {
    state.ui.pendingMove = {
      id: step.payload.id,
      from: state.objects[step.payload.id]?.section || null,
      to: step.payload.to || null
    };
  } else {
    delete state.ui.pendingMove;
  }

  return captureObjectLayout();
}

window.JVMSim = {
  ...(window.JVMSim || {}),
  ANIMATION_SPEED,
  animateStep,
  prepareForAnimation,
  wait
};
})();
