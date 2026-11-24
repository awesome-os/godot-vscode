# Godot Ghost (`awesome-os/godot-vscode`)

MIT-licensed Godot 4 extension for **Awesome-OS Code - OSS** and **Eclipse Theia** featuring instant `b8g-ghost` `cas-v1` hydration for Godot 4 + .NET 11 + `b8g-ghost-abi`, GDScript/C# task definitions, and a live scene runner.

## Features

- **Zero-install `cas-v1` Hydration (`godotGhost.hydrate`):** Resolves `godot-*`, `dotnet-sdk-*` (.NET 11), and `b8g-ghost-abi-*.node` directly from [`awesome-os/b8g-ghost`](https://github.com/awesome-os/b8g-ghost) (`manifests/index.json` @ `cas-v1`) with SHA-256 content-addressed URLs.
- **Live Scene & Project Runner (`godotGhost.runProject`, `godotGhost.openEditor`):** Launches Godot 4 projects or individual `.tscn` scenes with optional `--headless` execution and `.NET` environment wiring.
- **Export Builds (`godotGhost.exportBuild`):** Invokes `--export-release` / `--export-debug` presets cleanly across Windows, Linux, and macOS.
- **`godot-ghost` Task Type:** Contributes VS Code / Open VSX / Eclipse Theia tasks for `hydrate`, `run`, `editor`, `export`, and `dotnet-build`.
- **Direct Erasable TypeScript:** Zero build/transpile step (`erasableSyntaxOnly: true`, `noEmit: true`), executable directly on Node 22.6+ / Node 24+.

## Commands

| Command | Title |
| :--- | :--- |
| `godotGhost.hydrate` | Godot Ghost: Hydrate Godot 4 + .NET 11 from cas-v1 |
| `godotGhost.runProject` | Godot Ghost: Run Project / Scene |
| `godotGhost.openEditor` | Godot Ghost: Open Godot Editor |
| `godotGhost.exportBuild` | Godot Ghost: Export Build |

## Verification

```sh
node --test test/godot-vscode.test.mts
```

## License

[MIT](LICENSE)
