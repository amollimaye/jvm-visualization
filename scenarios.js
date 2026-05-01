(() => {
const {
  markObjects: baseMarkObjects,
  state,
  updateStack: baseUpdateStack
} = window.JVMSim;

function createSnapshotObject(definition) {
  state.objects[definition.id] = {
    id: definition.id,
    type: definition.type,
    value: definition.value,
    generation: definition.generation,
    age: definition.age,
    section: definition.section,
    literal: definition.literal ?? false,
    markStatus: definition.markStatus ?? null,
    deleted: false,
    pendingDelete: false
  };
  state.heap[definition.section].push(definition.id);
}

function hydrateGarbageCollectionSnapshot(payload) {
  state.objects = {};
  state.heap = {
    eden: [],
    s0: [],
    s1: [],
    old: [],
    stringPool: []
  };
  state.stack = [{
    method: payload.method,
    locals: { ...payload.locals }
  }];

  payload.objects.forEach((definition) => {
    createSnapshotObject(definition);
  });
}

window.JVMSim.updateStack = (payload) => {
  if (payload.action === "HYDRATE_GC_SNAPSHOT") {
    hydrateGarbageCollectionSnapshot(payload);
    return;
  }

  baseUpdateStack(payload);
};

window.JVMSim.markObjects = (payload) => {
  if (payload.mode === "CLEAR_SECTION_MARKS") {
    const sectionIds = new Set(state.heap[payload.section] || []);
    Object.values(state.objects).forEach((object) => {
      if (sectionIds.has(object.id)) {
        object.markStatus = null;
      }
    });
    return;
  }

  baseMarkObjects(payload);
};

const explanations = {
  objectCreation: {
    title: "Object creation starts in Eden and becomes reachable through a stack local.",
    why: "New heap objects begin in Eden. They only stay alive if a stack variable points to them."
  },
  garbageCollection: {
    title: "Garbage collection traces from stack roots, collects the young generation first, then cleans Old Gen when needed.",
    why: "Surviving young objects age, alternate through survivor spaces, and promote into Old Gen once they become long-lived."
  },
  threadStack: {
    title: "Stack frames define the active GC roots for a thread.",
    why: "Pushing a frame creates a new root scope. Popping it removes those locals, which can make heap objects unreachable."
  },
  stringHandling: {
    title: "String literals are reused from the pool, while new String() always allocates a distinct object.",
    why: "The string pool interns literals by value, but constructor-based Strings allocate new heap objects even when the contents match."
  }
};

const scenarios = {
  objectCreation: {
    intro: explanations.objectCreation,
    code: [
      "public static void main(String[] args) {",
      "    Integer num = new Integer(10);",
      "}"
    ],
    steps: [
      {
        stepId: 1,
        codeLine: 1,
        description: "Entering main() creates a new stack frame that can hold local references.",
        type: "UPDATE_STACK",
        payload: {
          action: "PUSH_FRAME",
          method: "main",
          locals: {}
        },
        narration: "Created the main stack frame.",
        explanation: "The stack frame for main() acts as a GC root container in this simulator."
      },
      {
        stepId: 2,
        codeLine: 2,
        description: "Creating Integer(10) allocates a fresh heap object in Eden.",
        type: "CREATE_OBJECT",
        payload: {
          id: "obj1",
          type: "Integer",
          value: 10,
          generation: "eden",
          age: 0,
          section: "eden"
        },
        narration: "Allocated Integer(10) in Eden.",
        explanation: "Regular objects begin life in Eden."
      },
      {
        stepId: 3,
        codeLine: 2,
        description: "Assigning num stores a stack reference to the newly created object.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 0,
          name: "num",
          value: "obj1"
        },
        narration: "Stored num as a reference to obj1.",
        explanation: "The object becomes reachable because a stack local now points to it."
      }
    ]
  },
  garbageCollection: {
    intro: explanations.garbageCollection,
    code: [
      "// Program creates objects",
      "// Mark reachable objects",
      "// Collect Young Generation",
      "// Promote survivors",
      "// Collect Old Generation",
      "// Compact memory"
    ],
    steps: [
      {
        stepId: 1,
        codeLine: 1,
        description: "Creating objects across heap with referenced and orphan objects.",
        type: "UPDATE_STACK",
        payload: {
          action: "HYDRATE_GC_SNAPSHOT",
          method: "main",
          locals: {
            obj1: "obj1",
            obj2: "obj2",
            obj3: "obj4",
            obj4: "obj5",
            obj5: "obj6",
            obj6: "obj7",
            obj7: "obj10",
            obj8: "obj11",
            obj9: "obj12",
            obj10: "obj13"
          },
          objects: [
            { id: "obj1", type: "Integer", value: 10, generation: "eden", age: 0, section: "eden", markStatus: "reachable" },
            { id: "obj2", type: "String", value: "eden-live", generation: "eden", age: 0, section: "eden", markStatus: "reachable" },
            { id: "obj3", type: "Integer", value: 99, generation: "eden", age: 0, section: "eden", markStatus: "unreachable" },
            { id: "obj4", type: "String", value: "s0-a", generation: "survivor", age: 1, section: "s0", markStatus: "reachable" },
            { id: "obj5", type: "Integer", value: 17, generation: "survivor", age: 1, section: "s0", markStatus: "reachable" },
            { id: "obj6", type: "String", value: "s1-a", generation: "survivor", age: 1, section: "s1", markStatus: "reachable" },
            { id: "obj7", type: "Integer", value: 81, generation: "survivor", age: 1, section: "s1", markStatus: "reachable" },
            { id: "obj8", type: "String", value: "s1-orphan-a", generation: "survivor", age: 1, section: "s1", markStatus: "unreachable" },
            { id: "obj9", type: "Integer", value: 55, generation: "survivor", age: 1, section: "s1", markStatus: "unreachable" },
            { id: "obj10", type: "String", value: "old-a", generation: "old", age: 2, section: "old", markStatus: "reachable" },
            { id: "obj11", type: "Integer", value: 144, generation: "old", age: 2, section: "old", markStatus: "reachable" },
            { id: "obj12", type: "String", value: "old-b", generation: "old", age: 2, section: "old", markStatus: "reachable" },
            { id: "obj13", type: "Integer", value: 233, generation: "old", age: 2, section: "old", markStatus: "reachable" },
            { id: "obj14", type: "String", value: "old-orphan", generation: "old", age: 2, section: "old", markStatus: "unreachable" }
          ]
        },
        instantRender: true,
        narration: "Loaded a running JVM snapshot with live and orphan objects across the heap.",
        explanation: "Green glow -> Referenced (reachable). Red glow -> Unreferenced (orphan). The whole heap, stack frame, and reference arrows appear at once to represent an already running program."
      },
      {
        stepId: 2,
        codeLine: 2,
        description: "Marking all reachable objects in Eden.",
        type: "MARK_OBJECTS",
        payload: {
          reachable: ["obj1", "obj2"],
          unreachable: ["obj3", "obj8", "obj9", "obj14"],
          clearOthers: false
        },
        narration: "Marked all reachable Eden objects from the stack roots.",
        explanation: "This marking step highlights the entire Eden area at once, so all reachable objects there glow together."
      },
      {
        stepId: 3,
        codeLine: 2,
        description: "Marking all reachable objects in Survivor S0.",
        type: "MARK_OBJECTS",
        payload: {
          reachable: ["obj1", "obj2", "obj4", "obj5"],
          unreachable: ["obj3", "obj8", "obj9", "obj14"],
          clearOthers: false
        },
        narration: "Marked all reachable Survivor S0 objects.",
        explanation: "Previously marked sections stay green while the current survivor space is added to the live set."
      },
      {
        stepId: 4,
        codeLine: 2,
        description: "Marking all reachable objects in Survivor S1.",
        type: "MARK_OBJECTS",
        payload: {
          reachable: ["obj1", "obj2", "obj4", "obj5", "obj6", "obj7"],
          unreachable: ["obj3", "obj8", "obj9", "obj14"],
          clearOthers: false
        },
        narration: "Marked all reachable Survivor S1 objects.",
        explanation: "The entire Survivor S1 area is now marked, including objects that are about to be promoted."
      },
      {
        stepId: 5,
        codeLine: 2,
        description: "Marking all reachable objects in Old Generation.",
        type: "MARK_OBJECTS",
        payload: {
          reachable: ["obj1", "obj2", "obj4", "obj5", "obj6", "obj7", "obj10", "obj11", "obj12", "obj13"],
          unreachable: ["obj3", "obj8", "obj9", "obj14"],
          clearOthers: false
        },
        narration: "Marked all reachable Old Gen objects.",
        explanation: "Old Gen uses the same root-based reachability rule, so only referenced long-lived objects stay green."
      },
      {
        stepId: 6,
        codeLine: 3,
        description: "Removing unreachable objects from Young Generation.",
        type: "DELETE_OBJECT",
        payload: {
          id: "obj3"
        },
        narration: "Deleted orphan obj3 from Eden.",
        explanation: "Young-generation cleanup removes one unreachable object at a time."
      },
      {
        stepId: 7,
        codeLine: 3,
        description: "Removing unreachable objects from Young Generation.",
        type: "DELETE_OBJECT",
        payload: {
          id: "obj8"
        },
        narration: "Deleted orphan obj8 from Survivor S1.",
        explanation: "Unreachable survivor objects are reclaimed during the same young-generation pass."
      },
      {
        stepId: 8,
        codeLine: 3,
        description: "Removing unreachable objects from Young Generation.",
        type: "DELETE_OBJECT",
        payload: {
          id: "obj9"
        },
        narration: "Deleted orphan obj9 from Survivor S1.",
        explanation: "The collector processes the young generation one unreachable object per step."
      },
      {
        stepId: 9,
        codeLine: 4,
        description: "Moving surviving objects across generations.",
        type: "MOVE_OBJECT",
        payload: {
          id: "obj1",
          to: "s0",
          generation: "survivor",
          age: 1,
          markStatus: "reachable"
        },
        narration: "Moved obj1 from Eden into Survivor S0.",
        explanation: "A surviving Eden object ages by one and moves into the survivor area."
      },
      {
        stepId: 10,
        codeLine: 4,
        description: "Moving surviving objects across generations.",
        type: "MOVE_OBJECT",
        payload: {
          id: "obj2",
          to: "s0",
          generation: "survivor",
          age: 1,
          markStatus: "reachable"
        },
        narration: "Moved obj2 from Eden into Survivor S0.",
        explanation: "Another surviving Eden object slides into the next survivor space."
      },
      {
        stepId: 11,
        codeLine: 4,
        description: "Moving surviving objects across generations.",
        type: "MOVE_OBJECT",
        payload: {
          id: "obj4",
          to: "old",
          generation: "old",
          age: 2,
          markStatus: "reachable"
        },
        narration: "Promoted obj4 from Survivor S0 into Old Gen.",
        explanation: "Objects that already survived once in S0 reach age 2 and promote into Old Gen."
      },
      {
        stepId: 12,
        codeLine: 4,
        description: "Moving surviving objects across generations.",
        type: "MOVE_OBJECT",
        payload: {
          id: "obj5",
          to: "old",
          generation: "old",
          age: 2,
          markStatus: "reachable"
        },
        narration: "Promoted obj5 from Survivor S1 into Old Gen.",
        explanation: "Once a surviving young object reaches age 2, it promotes into Old Gen."
      },
      {
        stepId: 13,
        codeLine: 4,
        description: "Moving surviving objects across generations.",
        type: "MOVE_OBJECT",
        payload: {
          id: "obj6",
          to: "old",
          generation: "old",
          age: 2,
          markStatus: "reachable"
        },
        narration: "Promoted obj6 from Survivor S1 into Old Gen.",
        explanation: "Surviving S1 objects also promote once they reach the age threshold."
      },
      {
        stepId: 14,
        codeLine: 4,
        description: "Moving surviving objects across generations.",
        type: "MOVE_OBJECT",
        payload: {
          id: "obj7",
          to: "old",
          generation: "old",
          age: 2,
          markStatus: "reachable"
        },
        narration: "Promoted obj7 from Survivor S1 into Old Gen.",
        explanation: "Promotion is processed one surviving object at a time for clarity."
      },
      {
        stepId: 15,
        codeLine: 5,
        description: "Removing unreachable objects from Old Generation.",
        type: "DELETE_OBJECT",
        payload: {
          id: "obj14"
        },
        narration: "Deleted orphan obj14 from Old Gen.",
        explanation: "Old Gen collection removes unreachable long-lived objects one at a time."
      },
      {
        stepId: 16,
        codeLine: 6,
        description: "Clearing GC marks in Eden after compaction.",
        type: "MARK_OBJECTS",
        payload: {
          mode: "CLEAR_SECTION_MARKS",
          section: "eden"
        },
        narration: "Compaction is complete and Eden marks are cleared.",
        explanation: "The Eden area is now neutral again, while marks in the remaining memory areas stay visible."
      },
      {
        stepId: 17,
        codeLine: 6,
        description: "Clearing GC marks in Survivor S0.",
        type: "MARK_OBJECTS",
        payload: {
          mode: "CLEAR_SECTION_MARKS",
          section: "s0"
        },
        narration: "Cleared marks in Survivor S0.",
        explanation: "Clearing happens by memory area, so the whole S0 region returns to a neutral state together."
      },
      {
        stepId: 18,
        codeLine: 6,
        description: "Clearing GC marks in Survivor S1.",
        type: "MARK_OBJECTS",
        payload: {
          mode: "CLEAR_SECTION_MARKS",
          section: "s1"
        },
        narration: "Cleared marks in Survivor S1.",
        explanation: "Survivor S1 marks are removed as a group, leaving only Old Gen highlighted."
      },
      {
        stepId: 19,
        codeLine: 6,
        description: "Clearing GC marks in Old Generation.",
        type: "MARK_OBJECTS",
        payload: {
          mode: "CLEAR_SECTION_MARKS",
          section: "old"
        },
        narration: "Cleared marks in Old Gen and returned the heap to its neutral state.",
        explanation: "All GC highlighting is now removed section by section, ending the collection walkthrough in a clean state."
      }
    ]
  },
  threadStack: {
    intro: explanations.threadStack,
    code: [
      "public static void main(String[] args) {",
      "    Integer num = new Integer(10);",
      "    helper();",
      "}",
      "static void helper() {",
      "    String label = new String(\"temp\");",
      "}"
    ],
    steps: [
      {
        stepId: 1,
        codeLine: 1,
        description: "Entering main() pushes the first stack frame.",
        type: "UPDATE_STACK",
        payload: {
          action: "PUSH_FRAME",
          method: "main",
          locals: {}
        },
        narration: "Created the main() frame.",
        explanation: "Every active method contributes a stack frame with its own locals."
      },
      {
        stepId: 2,
        codeLine: 2,
        description: "Creating Integer(10) allocates obj1 in Eden.",
        type: "CREATE_OBJECT",
        payload: {
          id: "obj1",
          type: "Integer",
          value: 10,
          generation: "eden",
          age: 0,
          section: "eden"
        },
        narration: "Allocated obj1 for main().",
        explanation: "Objects remain alive only while a root path exists."
      },
      {
        stepId: 3,
        codeLine: 2,
        description: "Assigning num stores a root reference from main() to obj1.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 0,
          name: "num",
          value: "obj1"
        },
        narration: "Stored main.num -> obj1.",
        explanation: "main.num is now a GC root reference."
      },
      {
        stepId: 4,
        codeLine: 5,
        description: "Calling helper() pushes a second frame on top of main().",
        type: "UPDATE_STACK",
        payload: {
          action: "PUSH_FRAME",
          method: "helper",
          locals: {}
        },
        narration: "Pushed helper() on top of main().",
        explanation: "A new frame adds another local scope and another set of roots."
      },
      {
        stepId: 5,
        codeLine: 6,
        description: "Creating a new String in helper() allocates obj2 in Eden.",
        type: "CREATE_OBJECT",
        payload: {
          id: "obj2",
          type: "String",
          value: "temp",
          generation: "eden",
          age: 0,
          section: "eden"
        },
        narration: "Allocated obj2 for helper().",
        explanation: "This object only lives as long as helper() keeps a reference."
      },
      {
        stepId: 6,
        codeLine: 6,
        description: "Assigning label stores a helper() local reference to obj2.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 1,
          name: "label",
          value: "obj2"
        },
        narration: "Stored helper.label -> obj2.",
        explanation: "The top frame now has its own root reference."
      },
      {
        stepId: 7,
        codeLine: 7,
        description: "Returning from helper() pops its frame and removes label from the root set.",
        type: "UPDATE_STACK",
        payload: {
          action: "POP_FRAME"
        },
        narration: "Popped helper() off the stack.",
        explanation: "When a frame disappears, all of its local root references disappear too."
      },
      {
        stepId: 8,
        codeLine: 7,
        description: "Without the helper frame, obj2 is unreachable and can be collected.",
        type: "DELETE_OBJECT",
        payload: {
          id: "obj2"
        },
        narration: "obj2 became unreachable after helper() returned.",
        explanation: "Without the helper frame, no stack variable points to obj2 anymore."
      }
    ]
  },
  stringHandling: {
    intro: explanations.stringHandling,
    code: [
      "public static void main(String[] args) {",
      "    String a = \"jvm\";",
      "    String b = \"jvm\";",
      "    String c = new String(\"jvm\");",
      "}"
    ],
    steps: [
      {
        stepId: 1,
        codeLine: 1,
        description: "Entering main() creates the stack frame for the String examples.",
        type: "UPDATE_STACK",
        payload: {
          action: "PUSH_FRAME",
          method: "main",
          locals: {}
        },
        narration: "Created the main frame for String examples.",
        explanation: "The stack will hold references to pooled and heap String objects."
      },
      {
        stepId: 2,
        codeLine: 2,
        description: "The literal \"jvm\" is created once in the String Pool.",
        type: "CREATE_OBJECT",
        payload: {
          id: "obj1",
          type: "String",
          value: "\"jvm\"",
          generation: "pool",
          age: 0,
          section: "stringPool",
          literal: true
        },
        narration: "Stored the String literal \"jvm\" in the pool.",
        explanation: "String literals are interned and reused by value."
      },
      {
        stepId: 3,
        codeLine: 2,
        description: "Assigning a stores a reference to the pooled String object.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 0,
          name: "a",
          value: "obj1"
        },
        narration: "Assigned literal reference a -> obj1.",
        explanation: "The first literal use points to the pooled String."
      },
      {
        stepId: 4,
        codeLine: 3,
        description: "Assigning b reuses the same pooled literal object.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 0,
          name: "b",
          value: "obj1"
        },
        narration: "Reused the same pooled literal for b -> obj1.",
        explanation: "Equal string literals share one pooled object."
      },
      {
        stepId: 5,
        codeLine: 4,
        description: "new String(\"jvm\") allocates a separate heap object instead of reusing the pool.",
        type: "CREATE_OBJECT",
        payload: {
          id: "obj2",
          type: "String",
          value: "\"jvm\"",
          generation: "eden",
          age: 0,
          section: "eden",
          literal: false
        },
        narration: "Allocated new String(\"jvm\") as a separate heap object.",
        explanation: "new String() always creates a distinct object instead of reusing the pool entry."
      },
      {
        stepId: 6,
        codeLine: 4,
        description: "Assigning c stores a reference to the distinct heap String object.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 0,
          name: "c",
          value: "obj2"
        },
        narration: "Assigned c -> obj2.",
        explanation: "c points to a different object, even though the contents match the pooled literal."
      }
    ]
  }
};

window.JVMSim = {
  ...(window.JVMSim || {}),
  scenarios
};
})();
