# Native HTML export (experimental)

The **Native HTML** target is a separate export path. Unlike the regular HTML target, it does not include Scratch VM, Scratch Renderer, Scratch Audio, or Packager scaffolding. It compiles event-script block graphs into project-specific JavaScript and renders the stage on a small canvas host. Scratch costume image bytes are embedded in the resulting document.

## Current compatibility

This is an early compiler milestone, not yet a complete Scratch implementation. It currently supports:
- Green-flag, key-press, sprite-click, and stage-click hats
- Basic motion (move, turn, go to/glide to, set/change x/y, direction, edge bounce, position reporters)
- Show/hide and say/say-for-seconds
- Wait, repeat, forever, if, if/else, stop, broadcasts, and broadcast-and-wait
- Core arithmetic, comparisons, boolean operators, join, random, math operators, text helpers, mouse and keyboard reporters
- Embedded sprite and stage costume rendering (first costume)
- Per-sprite variables, variable set/change, costume switching, and broadcast/broadcast-and-wait

Unsupported opcodes are collected during compilation and displayed in the exported HTML. They are not silently interpreted as successful operations.

Not implemented yet: costume effects, clones, lists, sound/music, pen, sensing/collision, extensions, monitors, cloud variables, and full Scratch scheduling/edge-case semantics. The regular HTML export remains the compatibility choice for projects that depend on these features.

## Architecture

1. Read project.json from the original SB3 archive.
2. Compile supported block stacks into JavaScript.
3. Embed the project-specific script bundle and costume assets in a standalone HTML document.
4. Run the generated scripts with a small native canvas host.

The exported file has no runtime network requests and does not contain the Scratch Player or Scratch VM.
