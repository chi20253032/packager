# Native HTML export

The Native HTML target produces a standalone HTML/CSS/JavaScript player. The exported document does not load Scratch VM, Scratch Player, Scratch Renderer, Scratch Audio, Packager scaffolding, or remote runtime bundles.

## Runtime architecture

- The player reads SB3 target/block JSON and embedded costume/sound assets directly.
- `src/native-compiler/runtime.js` is an independent cooperative block interpreter.
- The host provides Canvas 2D rendering, Web Audio playback and synthesis, pointer/keyboard input, Pen drawing, WebSocket cloud-variable transport, and extension callbacks.
- Unsupported opcodes are detected before execution and displayed as compatibility warnings.
- Native extensions are implemented as first-party adapters or registered through `runtime.registerExtension(opcode, handlers)`. A command handler receives `{runtime, target, block, thread, input, field}`; a reporter handler receives the same context and returns a value. Custom JavaScript can register adapters before compatibility diagnostics and project execution.

## Implemented runtime areas

- Motion: movement, turns, goto, glide, x/y, direction, rotation styles, edge bounce, and stage fencing
- Looks: visibility, size, costume/backdrop selection, layers, say/think bubbles, and basic brightness/color/ghost graphic effects
- Events: green flag, keyboard, stage/sprite click, broadcast, backdrop-switch hats, and clone-start hats
- Control: wait, repeat, forever, if/else, repeat-until, wait-until, stop modes, custom procedure arguments, warp procedures, and clone lifecycle
- Data: local/global variables, lists, list mutation, list indexing, monitor show/hide, and editable list monitors
- Operators and sensing: arithmetic, numeric/text comparisons, strings, math functions, mouse, keyboard, timer, date/time, distance, and approximate sprite/mouse touching
- Sound: embedded SB3 sound assets, play/play-until-done, stop-all, volume, and Web Audio
- Music extension: tempo, instrument selection, notes, drum approximations, and rests through Web Audio synthesis
- Pen extension: pen up/down, color, size, clear, stamp, and persistent drawing trails
- Cloud variables: WebSocket handshake/update support, standard/custom/local/ignore modes, and host selection; a project ID and network access are required
- Packager controls/settings: stage dimensions, resize mode, turbo, framerate, clone limit, fencing, username, autoplay, appearance, monitor colors/editable lists, pause/fullscreen controls, cloud settings, custom CSS, and custom JavaScript
- Mobile player UI: responsive stage, touch input, safe-area layout, and mobile-sized controls

## Compatibility status

This is a native compatibility implementation, not yet a drop-in replacement for every Scratch/TurboWarp feature. In particular, exact pixel-perfect sprite-to-sprite and color collision sensing, all Scratch graphic effects, exact instrument/drum sound reproduction, every event hat, all monitor presentation modes, every Packager setting, and the complete third-party/hardware extension ecosystem still need implementation and conformance tests. Browser permissions, browser APIs, hardware availability, network access, and mobile-device memory/performance also affect project behavior.

Cloud-variable transport and Music sounds are native approximations of the original environment, not a claim of bit-for-bit identical server or synthesizer behavior. A block being listed as implemented means the runtime has an implementation path; it does not by itself guarantee identical timing, sensing, or rendering for every project.

## Development rule

Every new opcode or extension adapter must have a regression test. Never mark an extension as supported just because its original remote JavaScript can be downloaded; native compatibility requires a working native adapter and tests.
