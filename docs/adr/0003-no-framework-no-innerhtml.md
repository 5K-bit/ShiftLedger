# ADR 0003: No framework, no HTML strings

The UI is small. A tiny `h()` helper builds DOM nodes, and lint rules forbid assigning HTML strings. **Consequence:** no runtime dependencies and no injection path from stored text; the cost is some verbosity.
