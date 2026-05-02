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
  state.stack2 = [];

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
  },
  volatileBehavior: {
    title: "Stage 1 (no volatile) shows both thread stacks with divergent cached values; stage 2 enables volatile semantics and main-memory synchronization.",
    why: "Without volatile, writes may stay thread-local while another thread reads a stale cached value; with volatile, modeled writes hit main memory and reads refresh from shared state."
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
      "// Compact memory",
      "// Drop old references",
      "// Collect newly unreachable old objects"
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
      },
      {
        stepId: 20,
        codeLine: 7,
        description: "Nulling the first old-generation stack reference.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 0,
          name: "obj3",
          value: null
        },
        narration: "Set obj3 = null, dropping the reference to old object obj4.",
        explanation: "Once the stack no longer references obj4, that old-generation object becomes eligible for collection."
      },
      {
        stepId: 21,
        codeLine: 7,
        description: "Nulling the second old-generation stack reference.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 0,
          name: "obj4",
          value: null
        },
        narration: "Set obj4 = null, dropping the reference to old object obj5.",
        explanation: "This removes another Old Gen root path from the stack."
      },
      {
        stepId: 22,
        codeLine: 7,
        description: "Nulling the third old-generation stack reference.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 0,
          name: "obj5",
          value: null
        },
        narration: "Set obj5 = null, dropping the reference to old object obj6.",
        explanation: "Old-generation reachability still depends on live stack roots."
      },
      {
        stepId: 23,
        codeLine: 7,
        description: "Nulling the fourth old-generation stack reference.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 0,
          name: "obj6",
          value: null
        },
        narration: "Set obj6 = null, dropping the reference to old object obj7.",
        explanation: "Removing the stack reference makes obj7 newly unreachable too."
      },
      {
        stepId: 24,
        codeLine: 7,
        description: "Nulling the fifth old-generation stack reference.",
        type: "UPDATE_STACK",
        payload: {
          action: "SET_LOCAL",
          frameIndex: 0,
          name: "obj7",
          value: null
        },
        narration: "Set obj7 = null, dropping the reference to old object obj10.",
        explanation: "Five old-generation objects are now no longer reachable from the stack."
      },
      {
        stepId: 25,
        codeLine: 8,
        description: "Marking the newly unreachable old-generation objects for collection.",
        type: "MARK_OBJECTS",
        payload: {
          reachable: ["obj11", "obj12", "obj13"],
          unreachable: ["obj4", "obj5", "obj6", "obj7", "obj10"],
          clearOthers: false
        },
        narration: "Marked the newly unreachable old-generation objects in red.",
        explanation: "After the stack references were nulled out, obj4, obj5, obj6, obj7, and obj10 became garbage."
      },
      {
        stepId: 26,
        codeLine: 8,
        description: "Collecting the first newly unreachable old-generation object.",
        type: "DELETE_OBJECT",
        payload: {
          id: "obj4"
        },
        narration: "Garbage collected obj4 from Old Gen.",
        explanation: "The telemetry drops as old-generation occupancy is reclaimed."
      },
      {
        stepId: 27,
        codeLine: 8,
        description: "Collecting the second newly unreachable old-generation object.",
        type: "DELETE_OBJECT",
        payload: {
          id: "obj5"
        },
        narration: "Garbage collected obj5 from Old Gen.",
        explanation: "Another reclaimed old-generation object lowers used heap further."
      },
      {
        stepId: 28,
        codeLine: 8,
        description: "Collecting the third newly unreachable old-generation object.",
        type: "DELETE_OBJECT",
        payload: {
          id: "obj6"
        },
        narration: "Garbage collected obj6 from Old Gen.",
        explanation: "The final memory chart should continue stepping down during these removals."
      },
      {
        stepId: 29,
        codeLine: 8,
        description: "Collecting the fourth newly unreachable old-generation object.",
        type: "DELETE_OBJECT",
        payload: {
          id: "obj7"
        },
        narration: "Garbage collected obj7 from Old Gen.",
        explanation: "This long-lived object is now reclaimed because its root reference was cleared."
      },
      {
        stepId: 30,
        codeLine: 8,
        description: "Collecting the fifth newly unreachable old-generation object.",
        type: "DELETE_OBJECT",
        payload: {
          id: "obj10"
        },
        narration: "Garbage collected obj10 from Old Gen.",
        explanation: "The old-generation cleanup finishes with a visible drop in the memory telemetry."
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
  },
  volatileBehavior: {
    intro: explanations.volatileBehavior,
    code: [
      "int counter = 0;",
      "",
      "Thread 1:",
      "counter = 10;",
      "",
      "Thread 2:",
      "print(counter);"
    ],
    steps: [
      {
        stepId: 1,
        codeLine: 1,
        description:
          "Stage 1 (no volatile): both thread stacks are visible immediately. Thread 1 cache shows 10 while Thread 2 cache still shows 0; SharedObject in main memory remains 0.",
        type: "MEMORY_VISIBILITY",
        instantRender: true,
        payload: {
          ensureHeapObject: { id: "volatileShared", section: "eden" },
          sharedObject: { counter: 0, volatile: false },
          threadLocal: { T1: { counter: 10 }, T2: { counter: 0 } },
          stacks: {
            t1: [{ method: "thread1", locals: { counter: "volatileShared" } }],
            t2: [{ method: "thread2", locals: { counter: "volatileShared" } }]
          },
          volatileSharedId: "volatileShared"
        },
        ui: {
          volatileShowSecondStack: true,
          highlightThread: null,
          memoryArrow: null,
          visibilityBanner: "Stage 1 — Non-volatile: thread caches diverge (T1=10, T2=0) while main memory still shows 0.",
          highlightCodeVolatile: false
        },
        narration: "Stage 1 starts with both stacks: Thread 1 has cached 10, Thread 2 still has cached 0, and SharedObject remains 0 in heap.",
        explanation:
          "Because the field is not volatile, this model allows thread-local caches to disagree before any synchronized visibility to main memory."
      },
      {
        stepId: 2,
        codeLine: 4,
        description:
          "Stage 1: focus Thread 1 write. Without volatile, the write stays in Thread 1 cache (10) and does not update SharedObject in main memory (still 0).",
        type: "MEMORY_VISIBILITY",
        payload: {
          threadLocal: { T1: { counter: 10 } },
          volatileSharedId: "volatileShared"
        },
        ui: {
          volatileShowSecondStack: true,
          highlightThread: "T1",
          memoryArrow: null,
          visibilityBanner: null,
          highlightCodeVolatile: false
        },
        narration: "Thread 1’s cache holds 10; the heap SharedObject still shows counter = 0.",
        explanation:
          "Non-volatile writes are modeled as updating only this thread's cache without immediately flushing that value to shared main memory."
      },
      {
        stepId: 3,
        codeLine: 7,
        description:
          "Stage 1: Thread 2 runs print(counter) and reads its stale cached value 0, even though Thread 1 cache already holds 10.",
        type: "MEMORY_VISIBILITY",
        payload: {
          volatileSharedId: "volatileShared"
        },
        ui: {
          volatileShowSecondStack: true,
          highlightThread: "T2",
          memoryArrow: null,
          visibilityBanner: null,
          highlightCodeVolatile: false
        },
        narration: "Thread 2 reads stale 0 from its own cache while Thread 1 cache is already 10.",
        explanation:
          "This is the visibility gap: with no volatile synchronization, one thread can keep observing an older cached value."
      },
      {
        stepId: 4,
        codeLine: 1,
        description:
          "Stage 2 (with volatile): layout expands to Thread 2. Reset counters and caches; both stacks now expose counter → volatileShared. Field is non-volatile again before we toggle volatile semantics.",
        type: "MEMORY_VISIBILITY",
        instantRender: true,
        payload: {
          sharedObject: { counter: 0, volatile: false },
          threadLocal: { T1: { counter: 0 }, T2: { counter: 0 } },
          stacks: {
            t1: [{ method: "thread1", locals: { counter: "volatileShared" } }],
            t2: [{ method: "thread2", locals: { counter: "volatileShared" } }]
          },
          volatileSharedId: "volatileShared"
        },
        ui: {
          volatileShowSecondStack: true,
          highlightThread: null,
          memoryArrow: null,
          visibilityBanner:
            "Stage 2 — With volatile: Thread 2 stack shown. Subsequent steps replay writes/reads with main-memory visibility.",
          highlightCodeVolatile: false
        },
        narration: "Second stack visible; baseline reset—both threads share the heap reference locally.",
        explanation: "The same SharedObject instance stays in Eden while we rerun the storyline with synchronization arrows."
      },
      {
        stepId: 5,
        codeLine: 1,
        description:
          "Stage 2: The field is declared volatile — reads and writes are modeled against main memory visibility.",
        type: "MEMORY_VISIBILITY",
        payload: {
          sharedObject: { volatile: true },
          volatileSharedId: "volatileShared"
        },
        ui: {
          highlightThread: null,
          memoryArrow: null,
          visibilityBanner:
            "Visibility enabled: volatile reads/writes synchronize through SharedObject (main memory).",
          highlightCodeVolatile: true
        },
        narration: "volatile is active; code panel reflects the volatile declaration.",
        explanation: "This flag cues the simulator to flush modeled writes to the heap and to model reads against main memory."
      },
      {
        stepId: 6,
        codeLine: 4,
        description:
          "Stage 2: Thread 1 assigns counter = 10 with volatile; the write updates main memory (heap) and Thread 1’s cache — follow the arrow from Thread 1 to SharedObject.",
        type: "MEMORY_VISIBILITY",
        payload: {
          sharedObject: { counter: 10 },
          threadLocal: { T1: { counter: 10 } },
          volatileSharedId: "volatileShared"
        },
        ui: {
          highlightThread: "T1",
          memoryArrow: { from: "T1", to: "heap" },
          visibilityBanner: null,
          highlightCodeVolatile: true
        },
        narration: "Thread 1 pushes 10 through to the SharedObject in Eden and retains 10 locally.",
        explanation: "A volatile write crosses to main memory immediately in this pedagogical animation."
      },
      {
        stepId: 7,
        codeLine: 7,
        description:
          "Stage 2: Thread 2 runs print(counter) under volatile semantics — read hits main memory, then caches 10 locally (arrow heap → Thread 2).",
        type: "MEMORY_VISIBILITY",
        payload: {
          threadLocal: { T2: { counter: 10 } },
          volatileSharedId: "volatileShared"
        },
        ui: {
          highlightThread: "T2",
          memoryArrow: { from: "heap", to: "T2" },
          visibilityBanner: null,
          highlightCodeVolatile: true
        },
        narration: "Thread 2 reads 10 from main memory into its displayed local cache.",
        explanation: "A volatile read refreshes value from SharedObject rather than trusting a stale local copy."
      }
    ]
  }
};

window.JVMSim = {
  ...(window.JVMSim || {}),
  scenarios
};
})();
