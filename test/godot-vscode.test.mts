import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  CONTRIBUTED_COMMANDS,
  DEFAULT_CAS_BASE_URL,
  DEFAULT_GHOST_INDEX_URL,
  activate,
  buildGodotRunCommand,
  deactivate,
  normalizePlatformTarget,
  resolveGodotStudioPlan,
  type DisposableLike,
  type GhostCasIndex,
} from '../src/extension.mts';

const SHA256_RE = /^[0-9a-f]{64}$/;

describe('godot-vscode live cas-v1 resolution', () => {
  it('resolves dotnet-sdk and b8g-ghost-abi from live awesome-os/b8g-ghost cas-v1 and checks godot-* gracefully', async () => {
    for (const target of ['linux-x64', 'win64'] as const) {
      const plan = await resolveGodotStudioPlan({ target });

      assert.equal(plan.target, target);
      assert.ok(plan.baselineTag.length > 0);
      assert.equal(plan.indexUrl, DEFAULT_GHOST_INDEX_URL);
      assert.ok(plan.casBaseUrl.includes('awesome-os/b8g-ghost/releases/download/cas-v1'));

      assert.ok(plan.dotnetSdk, `expected dotnet-sdk entry for ${target}`);
      assert.match(plan.dotnetSdk.key, /^dotnet-sdk-/);
      assert.match(plan.dotnetSdk.sha256, SHA256_RE);
      assert.ok(plan.dotnetSdk.download_url.endsWith(`/${plan.dotnetSdk.sha256}`));

      assert.ok(plan.ghostAbi, `expected b8g-ghost-abi entry for ${target}`);
      assert.match(plan.ghostAbi.key, /^b8g-ghost-abi-/);
      assert.match(plan.ghostAbi.sha256, SHA256_RE);
      assert.ok(plan.ghostAbi.download_url.endsWith(`/${plan.ghostAbi.sha256}`));

      if (plan.godot) {
        assert.equal(plan.godotStatus, 'available');
        assert.match(plan.godot.key, /^godot-/i);
        assert.match(plan.godot.sha256, SHA256_RE);
        assert.equal(plan.ready, true);
        assert.deepEqual(plan.missingComponents, []);
      } else {
        assert.equal(plan.godotStatus, 'pending-cas-ingest');
        assert.equal(plan.ready, false);
        assert.deepEqual(plan.missingComponents, ['godot']);
      }
    }
  });

  it('prefers mono/dotnet godot build when godot-* entries are present in index', async () => {
    const syntheticIndex: GhostCasIndex = {
      schema: 'b8g-ghost-cas-index/v1',
      cas_base_url: DEFAULT_CAS_BASE_URL,
      baseline_tag: 'cas-v1',
      updated_at: '2026-11-24T00:00:00Z',
      total_entries: 4,
      entries: {
        'godot-4.4-linux-x64.tar.zst': {
          filename: 'godot-4.4-linux-x64.tar.zst',
          sha256: 'a'.repeat(64),
          bytes: 40_000_000,
          version: '4.4.0',
          category: 'godot-engine',
          download_url: `${DEFAULT_CAS_BASE_URL}/${'a'.repeat(64)}`,
        },
        'godot-4.4-mono-linux-x64.tar.zst': {
          filename: 'godot-4.4-mono-linux-x64.tar.zst',
          sha256: 'b'.repeat(64),
          bytes: 65_000_000,
          version: '4.4.0-mono',
          category: 'godot-engine',
          download_url: `${DEFAULT_CAS_BASE_URL}/${'b'.repeat(64)}`,
        },
        'dotnet-sdk-linux-x64.tar.zst': {
          filename: 'dotnet-sdk-linux-x64.tar.zst',
          sha256: 'c'.repeat(64),
          bytes: 171_000_000,
          version: '11.0.100',
          category: 'dotnet-upstream',
          download_url: `${DEFAULT_CAS_BASE_URL}/${'c'.repeat(64)}`,
        },
        'b8g-ghost-abi-linux-x64.node': {
          filename: 'b8g-ghost-abi-linux-x64.node',
          sha256: 'd'.repeat(64),
          bytes: 12_616,
          category: 'napi-addon',
          download_url: `${DEFAULT_CAS_BASE_URL}/${'d'.repeat(64)}`,
        },
      },
    };

    const plan = await resolveGodotStudioPlan({
      target: 'linux-x64',
      index: syntheticIndex,
      preferMono: true,
    });

    assert.equal(plan.ready, true);
    assert.equal(plan.godotStatus, 'available');
    assert.equal(plan.godot?.key, 'godot-4.4-mono-linux-x64.tar.zst');
    assert.equal(plan.hydratedAssets.length, 3);
    assert.equal(plan.env.B8G_GODOT_VERSION, '4.4.0-mono');
    assert.equal(plan.env.B8G_DOTNET_SDK_VERSION, '11.0.100');
  });
});

describe('godot-vscode command builder & platform mapping', () => {
  it('normalizes host platforms to cas-v1 target names', () => {
    assert.equal(normalizePlatformTarget('win32', 'x64'), 'win64');
    assert.equal(normalizePlatformTarget('linux', 'x64'), 'linux-x64');
    assert.equal(normalizePlatformTarget('linux', 'arm64'), 'linux-arm64');
    assert.equal(normalizePlatformTarget('darwin', 'arm64'), 'macos-arm64');
  });

  it('builds run, editor, export, dotnet-build, and hydrate commands', () => {
    const runCmd = buildGodotRunCommand({
      action: 'run',
      projectPath: './my game',
      scene: 'res://scenes/main.tscn',
      headless: true,
      platform: 'linux',
    });
    assert.equal(runCmd.executable, 'godot4');
    assert.deepEqual(runCmd.args, ['--path', './my game', '--headless', 'res://scenes/main.tscn']);
    assert.equal(runCmd.commandLine, 'godot4 --path "./my game" --headless res://scenes/main.tscn');

    const editorCmd = buildGodotRunCommand({
      action: 'editor',
      projectPath: 'E:\\projects\\demo',
      platform: 'win32',
    });
    assert.equal(editorCmd.executable, 'godot4.exe');
    assert.deepEqual(editorCmd.args, ['--path', 'E:\\projects\\demo', '--editor']);

    const exportCmd = buildGodotRunCommand({
      action: 'export',
      projectPath: '.',
      preset: 'Linux/X11',
      outputPath: 'dist/game.x86_64',
      headless: true,
      platform: 'linux',
    });
    assert.deepEqual(exportCmd.args, [
      '--path',
      '.',
      '--headless',
      '--export-release',
      'Linux/X11',
      'dist/game.x86_64',
    ]);

    assert.throws(
      () => buildGodotRunCommand({ action: 'export', projectPath: '.' }),
      /requires both preset and outputPath/,
    );

    const dotnetCmd = buildGodotRunCommand({
      action: 'dotnet-build',
      projectPath: './Game.csproj',
      platform: 'linux',
    });
    assert.equal(dotnetCmd.executable, 'dotnet');
    assert.deepEqual(dotnetCmd.args, ['build', '--nologo', './Game.csproj']);

    const hydrateCmd = buildGodotRunCommand({ action: 'hydrate', platform: 'win32' });
    assert.equal(hydrateCmd.executable, 'b8g-ghost.cmd');
    assert.deepEqual(hydrateCmd.args, ['hydrate', '--tag', 'cas-v1', 'godot', 'dotnet-sdk', 'b8g-ghost-abi']);
  });
});

describe('godot-vscode manifest & activation lifecycle', () => {
  it('declares valid Open VSX / VS Code contributions in package.json', () => {
    const manifestUrl = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(manifestUrl, 'utf8')) as {
      name: string;
      publisher: string;
      type: string;
      main: string;
      contributes: {
        commands: Array<{ command: string; title: string }>;
        taskDefinitions: Array<{ type: string; required?: string[] }>;
      };
    };

    assert.equal(pkg.name, 'godot-ghost');
    assert.equal(pkg.publisher, 'awesome-os');
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.main, './src/extension.mts');

    const commandIds = pkg.contributes.commands.map((c) => c.command);
    assert.deepEqual(commandIds, [...CONTRIBUTED_COMMANDS]);

    const taskTypes = pkg.contributes.taskDefinitions.map((t) => t.type);
    assert.ok(taskTypes.includes('godot-ghost'));
  });

  it('activates, registers commands and task provider, and deactivates cleanly', () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    let registeredTaskType = '';
    let disposedCount = 0;

    const subscriptions: DisposableLike[] = [];
    const handle = activate(
      { subscriptions },
      {
        commands: {
          registerCommand(command, cb) {
            registered.set(command, cb);
            return {
              dispose() {
                disposedCount += 1;
              },
            };
          },
        },
        tasks: {
          registerTaskProvider(type) {
            registeredTaskType = type;
            return {
              dispose() {
                disposedCount += 1;
              },
            };
          },
        },
      },
    );

    assert.deepEqual(handle.registeredCommands, [...CONTRIBUTED_COMMANDS]);
    assert.equal(registeredTaskType, 'godot-ghost');
    assert.equal(subscriptions.length, 5);

    const runResult = registered.get('godotGhost.runProject')?.({ projectPath: './demo', platform: 'linux' }) as {
      executable: string;
    };
    assert.equal(runResult.executable, 'godot4');

    deactivate();
    assert.equal(disposedCount, 5);
  });
});
