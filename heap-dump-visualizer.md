Create an advanced interactive JVM Heap Dump visualization mode for a JVM internals learning platform. The visualization should activate when the user clicks a “Heap Dump” button in the simulator UI.

The overall design language must remain visually consistent with the existing simulator:
- soft beige/light developer-tool aesthetic
- rounded panels
- muted professional colors
- clean JVM engineering dashboard appearance
- educational + production-tool hybrid style
- similar to Eclipse MAT, VisualVM, YourKit, and JProfiler combined with modern observability UI

The heap dump visualization should feel like:
“A frozen memory snapshot of the JVM at this exact moment.”

--------------------------------------------------
MAIN UX TRANSFORMATION
--------------------------------------------------

When user clicks “Heap Dump”:
- pause runtime simulation
- freeze object movement
- fade background slightly
- animate transition into snapshot-analysis mode
- display timestamp:
  “Heap Snapshot Captured”
- show:
  heap usage
  object count
  thread count
  class count
  GC roots count

Example:
Heap Dump Captured
Time: t=42
Heap Used: 328 MB
Objects: 2,431
Threads: 8
Classes: 212
GC Roots: 34

Transition should feel like:
- memory freeze
- debugger breakpoint
- JVM state snapshot

--------------------------------------------------
LAYOUT
--------------------------------------------------

Use a professional heap analysis layout similar to MAT.

TOP TOOLBAR
- Snapshot metadata
- Search box
- Filters
- “Run GC Simulation”
- “Show GC Roots”
- “Dominator Tree”
- “Reference Graph”
- “Histogram”
- “Leak Suspects”
- “Back to Runtime”

MAIN LAYOUT:

--------------------------------------------------
| TOP NAVIGATION / HEAP SNAPSHOT INFO            |
--------------------------------------------------

| LEFT PANEL | CENTER PANEL | RIGHT PANEL        |

LEFT:
Heap Regions + Histogram

CENTER:
Interactive Object Graph / Heap Graph

RIGHT:
Object Inspector + GC Root Paths + Retained Heap

BOTTOM:
Memory Timeline + Object Statistics + Heap Metrics

--------------------------------------------------
LEFT PANEL — HEAP REGIONS
--------------------------------------------------

Retain the existing generation boxes:
- Eden
- Survivor S0
- Survivor S1
- Old Gen
- String Pool

But now render them like actual heap dump regions.

Each object should appear as:
- compact memory block
- labeled with:
  object id
  class name
  retained size
  shallow size

Example:
obj42
UserSession
48 KB retained

Object colors:
- reachable = green
- GC root = blue
- weak reference = yellow
- soft reference = orange
- phantom reference = purple
- unreachable/orphan = red
- selected object = glowing cyan outline

Hover interaction:
- highlight incoming references
- highlight outgoing references
- show tooltip:
  object address
  class
  retained heap
  shallow heap
  generation
  object age
  reference type

Example tooltip:
------------------------------------------------
UserCache @0x7ff8a102
Shallow Heap: 2 KB
Retained Heap: 1.4 GB
Generation: Old Gen
Age: 14 GC cycles
References: 12,402
------------------------------------------------

Object positioning:
- clustered naturally
- larger retained objects appear visually larger
- fragmented memory areas visible
- old gen more densely packed

--------------------------------------------------
CENTER PANEL — OBJECT GRAPH VISUALIZATION
--------------------------------------------------

This is the core visualization.

Render heap as an interactive reference graph similar to:
- MAT dominator tree
- Neo4j graph
- VisualVM object explorer
- memory leak analyzers

Objects are nodes.
References are directional arrows.

Visualization style:
- modern graph layout
- smooth animated edges
- soft glows
- memory heat coloring

Reference lines:
- strong refs = solid line
- weak refs = dashed
- soft refs = dotted
- phantom refs = thin glow
- static refs = thick blue
- JNI refs = red

Node sizes:
- proportional to retained memory

Large leaks visually dominate graph.

Example graph:

[Thread Root]
      |
      v
[SpringContext]
      |
      v
[CacheManager]
      |
      v
[HashMap]
   /   |   \
obj1 obj2 obj3

Graph interactions:
- zoom
- pan
- drag nodes
- collapse/expand subgraphs
- isolate retained subtrees
- filter by class
- filter by package
- filter by retained heap size

Selecting object:
- highlights full GC root path
- animates traversal
- dims unrelated objects

Animated traversal effect:
ThreadRoot
   ↓
SpringBean
   ↓
CacheManager
   ↓
HugeMap
   ↓
Selected Object

--------------------------------------------------
RIGHT PANEL — OBJECT INSPECTOR
--------------------------------------------------

Professional heap dump inspector panel.

When object selected:
show full metadata.

Example:
------------------------------------------------
Object Details
------------------------------------------------
Class:
com.app.UserSession

Address:
0x7ff8a102

Generation:
Old Gen

Shallow Heap:
48 bytes

Retained Heap:
2.3 MB

Object Age:
7

References:
Outgoing: 12
Incoming: 3

GC Root Path:
Thread → RequestContext → SessionMap

Reference Type:
Strong

Reachability:
Reachable
------------------------------------------------

--------------------------------------------------
OBJECT HEADER VISUALIZATION
--------------------------------------------------

Show low-level JVM internals.

Render actual object layout visually.

+-------------------+
| Mark Word         |
+-------------------+
| Klass Pointer     |
+-------------------+
| Instance Fields   |
+-------------------+
| Padding           |
+-------------------+

Display:
- compressed oops
- lock state
- hashcode
- object age

--------------------------------------------------
DOMINATOR TREE MODE
--------------------------------------------------

Provide alternate view:
“Dominator Tree”

Visualize retained ownership hierarchy.

Example:

SpringContext (2.1 GB retained)
 ├── CacheManager (1.5 GB)
 │    ├── UserCache
 │    ├── ProductCache
 │    └── SessionCache
 └── MetricsRegistry

Render as:
- expandable tree
- retained memory bars
- proportional rectangles
- memory heatmap

Large memory owners glow stronger.

--------------------------------------------------
HISTOGRAM MODE
--------------------------------------------------

Provide classic heap histogram.

Columns:
- Class Name
- Object Count
- Shallow Heap
- Retained Heap
- Percentage

Example:
java.lang.String
1,204,211 objects
120 MB shallow
430 MB retained

Visual style:
- MAT inspired
- sortable columns
- colored memory bars

--------------------------------------------------
LEAK SUSPECTS MODE
--------------------------------------------------

Show automated leak analysis.

Example:
------------------------------------------------
Potential Leak Suspect
------------------------------------------------
Static Cache retaining 1.8 GB

Root Path:
ApplicationClassLoader
  → CacheManager
  → ConcurrentHashMap
  → User Objects

Recommendation:
Objects not released after request completion.
------------------------------------------------

Leak areas:
- glowing red
- animated warning pulse
- retention chain highlighted

--------------------------------------------------
GC ROOT VISUALIZATION
--------------------------------------------------

Show dedicated GC roots section.

GC roots include:
- thread locals
- static fields
- JNI references
- system classloader
- monitors

Render roots as anchored blue nodes at top.

All live objects visually connect to roots.

Unreachable objects:
- disconnected
- faded red
- marked collectible

--------------------------------------------------
THREAD STACK LINKAGE
--------------------------------------------------

Visually connect thread stack locals to heap objects.

Example:

main()
  userService
      |
      v
   UserCache
      |
      v
   HashMap

Animated pointer lines between:
- stack variables
- heap references

--------------------------------------------------
MEMORY FRAGMENTATION VISUALIZATION
--------------------------------------------------

Show fragmented heap regions.

Visualize:
- free gaps
- compacted regions
- fragmented old gen
- humongous objects

Use:
- dark gaps
- uneven spacing
- region boundaries

--------------------------------------------------
GC SIMULATION BUTTON
--------------------------------------------------

Button:
“Run GC”

Animation:
- unreachable objects fade out
- surviving objects glow green
- promoted objects move to old gen
- heap compacts
- memory reclaimed shown numerically

Example:
Freed: 182 MB
Objects Collected: 1,242,112

--------------------------------------------------
TIMELINE MODE
--------------------------------------------------

Allow snapshot comparison.

Example:
- Before GC
- After GC
- After load spike

Animate:
- object growth
- leak progression
- retained heap increase

--------------------------------------------------
BOTTOM METRICS PANEL
--------------------------------------------------

Show:
- heap usage graph
- object allocation rate
- promoted objects/sec
- GC pause duration
- retained heap trend
- largest object owners

Dark observability chart aesthetic.

--------------------------------------------------
VISUAL STYLE
--------------------------------------------------

Design inspiration:
- Eclipse MAT
- VisualVM
- JProfiler
- Datadog
- Grafana
- modern observability dashboards

Color palette:
- muted JVM engineering colors
- soft greens
- cyan highlights
- orange warnings
- red leaks
- blue GC roots

Avoid:
- cartoon style
- gaming aesthetics
- neon cyberpunk
- clutter

Need:
- clean
- educational
- enterprise-grade
- JVM-engineering professional

--------------------------------------------------
ANIMATION STYLE
--------------------------------------------------

Animations should feel:
- memory-aware
- analytical
- debugger-like
- smooth and informative

Examples:
- references tracing softly
- selected paths glowing
- unreachable objects dissolving
- GC compaction sliding objects
- heap freeze transition

--------------------------------------------------
EDUCATIONAL OVERLAYS
--------------------------------------------------

Optional overlays:
- “Why object survived GC”
- “Retained heap explanation”
- “Shortest path to GC root”
- “Object promoted after 7 cycles”
- “Static field preventing collection”

Educational callouts should resemble:
advanced JVM learning platform.

--------------------------------------------------
FINAL EXPERIENCE
--------------------------------------------------

The experience should feel like:
“A visual fusion of JVM runtime simulator + professional heap dump analyzer + educational observability platform.”

It should look realistic enough that JVM engineers recognize concepts from:
- MAT
- VisualVM
- YourKit
- JProfiler

while remaining:
- interactive
- visually intuitive
- modern
- educational
- visually stunning.