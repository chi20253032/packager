# Native HTML export

The Native HTML target is an independent HTML/CSS/JavaScript implementation. It must not load Scratch VM, Scratch Player, Scratch Renderer, Scratch Audio, or Packager scaffolding at runtime.

## Runtime architecture

- SB3 project data is parsed as native block graphs.
- `src/native-compiler/runtime.js` provides an independent cooperative interpreter, target state, variables, lists, event dispatch, broadcasts, clone lifecycle, and host callbacks.
- The host owns canvas/WebAudio rendering and extension adapters. The runtime itself has no dependency on Scratch VM.
- Unsupported opcodes are surfaced through a host diagnostic callback; they must never be silently reported as supported.

## Current implementation status

The runtime foundation implements core motion, looks, control flow, operators, variables, lists, keyboard/mouse input, broadcasts, and basic clone creation. It is an active compatibility implementation, not yet a drop-in replacement for every Scratch/TurboWarp feature. Costume effects, complete collision sensing, pen, full audio sequencing, monitors, cloud services, custom procedures/warp semantics, and arbitrary extension implementations still require dedicated work and conformance tests.

## Development rule

Every newly supported opcode must have a test. Extension support must be implemented through documented native adapters; loading arbitrary extension scripts is not equivalent to native compatibility.
