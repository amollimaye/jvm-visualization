(() => {
const { captureObjectLayout, render, finalizeDeletion, state } = window.JVMSim;

const ANIMATION_SPEED = 2.0;
const HIGHLIGHT_DURATION = 300;
const MOTION_DURATION = 700;
const SETTLE_DURATION = 200;

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
  node.style.transition = `transform ${duration}ms ease, opacity ${duration}ms ease, box-shadow 220ms ease, outline-color 220ms ease`;
}

function setReferenceLayerVisibility(isVisible) {
  const layer = document.getElementById("reference-layer");
  if (!layer) {
    return;
  }

  layer.style.transition = "opacity 180ms ease";
  layer.style.opacity = isVisible ? "1" : "0";
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
  document.querySelectorAll(".heap-object").forEach((node) => {
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

    setTransitionTiming(node, duration);
    node.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    requestAnimationFrame(() => {
      node.style.transform = "";
    });
  });

  return wait(duration).then(() => {
    document.querySelectorAll(".heap-object").forEach((node) => {
      node.style.transition = "";
    });
  });
}

function runAnimation(step, previousLayout, onSelect, duration) {
  if (step.type === "MARK_OBJECTS" || step.type === "CLEAR_MARKS") {
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
  if (step.instantRender) {
    await wait(scaledDuration(20));
    delete state.ui.pendingObjectId;
    return;
  }

  const hasMotion = step.type === "CREATE_OBJECT" || step.type === "MOVE_OBJECT" || step.type === "DELETE_OBJECT";
  await highlightPhase();
  if (hasMotion) {
    setReferenceLayerVisibility(false);
  }
  await runAnimation(step, previousLayout, onSelect, scaledDuration(MOTION_DURATION));
  await settlePhase();
  if (hasMotion) {
    setReferenceLayerVisibility(true);
  }

  delete state.ui.pendingObjectId;
}

function prepareForAnimation(step) {
  if (step.type === "CREATE_OBJECT" || step.type === "DELETE_OBJECT") {
    state.ui.pendingObjectId = step.payload.id;
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
