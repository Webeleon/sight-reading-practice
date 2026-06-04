// Pure-safe structured logging for the generator.
//
// The pure tsconfig has NO DOM and NO @types/node lib, so the global `console` is not in
// scope (referencing it is a compile error — that is how pure modules stay pure). We
// still want the brief's structured logging with category prefixes ([GEN], ...). So we
// ambiently declare the minimal console surface we use and route through it. At runtime
// (vitest/tsx/electron) a real console always exists, so this is purely a type-level
// shim; it adds no DOM/Node dependency.
//
// Pure module: no electron/react/DOM import, no `any`.

interface MinimalConsole {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

declare const console: MinimalConsole;

/** Structured warn with the [GEN] category prefix (brief section 16). */
export function genWarn(message: string): void {
  console.warn(`[GEN] ${message}`);
}

/** Structured info with the [GEN] category prefix. */
export function genLog(message: string): void {
  console.log(`[GEN] ${message}`);
}
