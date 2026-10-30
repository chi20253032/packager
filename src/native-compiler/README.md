# Native HTML export

The Native HTML target produces a standalone HTML/CSS/JavaScript player. The exported document does not load Scratch VM, Scratch Player, Scratch Renderer, Scratch Audio, Packager scaffolding, or remote runtime bundles.

## Runtime architecture

- The player reads SB3 target/block JSON directly.
- `src/native-compiler/runtime.js` is an independent cooperative block interpreter.
- The host provides Canvas rendering, Web Audio playback, pointer/keyboard input, Pen drawing, and extension callbacks.
- Unsupported opcodes are detected before execution and displayed as compatibility warnings.
- Native extensions are implemented as first-party adapters or registered through `runtime.registerExtension(opcode, handlers)`. A command handler receives `{runtime, target, block, thread, input, field}`; a reporter handler receives the same context and returns a value. Custom JavaScript can register adapters before the project starts.

## Implemented runtime areas

- Motion: move, turns, goto, glide, x/y, direction, edge bounce, rotation style
- Looks: visibility, size, costume/backdrop selection, layers, say/think bubbles
- Events: green flag, keyboard, stage/sprite click, broadcast, backdrop-switch hats
- Control: wait, repeat, forever, if/else, repeat-until, wait-until, stop, clone create/delete
- Data: variables, lists, item/index/length/contains, list mutation
- Operators and sensing: arithmetic, comparisons, strings, math functions, mouse, keyboard, timer, date/time, distance and approximate touching
- Sound: embedded SB3 sound assets, play/play-until-done, stop-all, volume, Web Audio
- Pen extension: pen up/down, color, size, clear, stamp, persistent drawing trails
- Packager settings: stage dimensions, resize mode, turbo, framerate, clone limit, fencing, username, autoplay, appearance, custom CSS and custom JavaScript

## Compatibility status

This is an active compatibility implementation, not yet a drop-in replacement for every Scratch/TurboWarp feature. In particular, exact pixel-perfect collision sensing, complete graphic effects, all sound effects, full custom procedures/warp semantics, cloud variables, all monitors, every Packager control, and the complete third-party extension ecosystem still need implementation and conformance tests. Some current behaviors are intentionally approximations and must not be treated as exact parity.

A block being listed as implemented means the runtime has an implementation path; it does not by itself guarantee identical timing or visual behavior for every project.

## Development rule

Every new opcode or extension adapter must have a regression test. Never mark an extension as supported just because its original remote JavaScript can be downloaded; native compatibility requires a working native adapter.
