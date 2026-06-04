// Ambient declarations for the renderer (Vite handles these at build/dev time).
// Without them, side-effect CSS imports fail typecheck under tsconfig.ui.json.

declare module '*.css';
