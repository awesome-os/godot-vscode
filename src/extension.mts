export const DEFAULT_GHOST_INDEX_URL =
  'https://raw.githubusercontent.com/awesome-os/b8g-ghost/main/manifests/index.json';

export const DEFAULT_CAS_BASE_URL =
  'https://github.com/awesome-os/b8g-ghost/releases/download/cas-v1';

export type GhostPlatformTarget =
  | 'win64'
  | 'linux-x64'
  | 'linux-arm64'
  | 'macos-arm64'
  | 'macos-x64';

export type GodotAction =
  | 'hydrate'
  | 'run'
  | 'editor'
  | 'export'
  | 'dotnet-build';

export interface GhostCasEntry {
  readonly key: string;
  readonly filename: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly raw_bytes?: number;
  readonly version?: string;
  readonly category?: string;
  readonly download_url: string;
}

export interface GhostCasIndex {
  readonly schema: string;
  readonly cas_base_url: string;
  readonly baseline_tag: string;
  readonly updated_at: string;
  readonly total_entries: number;
  readonly entries: Record<string, Omit<GhostCasEntry, 'key'>>;
}

export interface ResolveGodotStudioPlanOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly target?: GhostPlatformTarget;
  readonly index?: GhostCasIndex;
  readonly indexUrl?: string;
  readonly preferMono?: boolean;
  readonly fetchImpl?: typeof fetch;
}

export interface GodotStudioPlan {
  readonly target: GhostPlatformTarget;
  readonly baselineTag: string;
  readonly casBaseUrl: string;
  readonly indexUrl: string;
  readonly godot: GhostCasEntry | null;
  readonly godotStatus: 'available' | 'pending-cas-ingest';
  readonly dotnetSdk: GhostCasEntry | null;
  readonly ghostAbi: GhostCasEntry | null;
  readonly hydratedAssets: readonly GhostCasEntry[];
  readonly missingComponents: readonly ('godot' | 'dotnet-sdk' | 'b8g-ghost-abi')[];
  readonly ready: boolean;
  readonly env: Readonly<Record<string, string>>;
}

export interface GodotRunCommandOptions {
  readonly action: GodotAction;
  readonly godotExecutable?: string;
  readonly dotnetExecutable?: string;
  readonly projectPath?: string;
  readonly scene?: string;
  readonly preset?: string;
  readonly outputPath?: string;
  readonly debugExport?: boolean;
  readonly headless?: boolean;
  readonly extraArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly platform?: NodeJS.Platform;
}

export interface GodotRunCommand {
  readonly action: GodotAction;
  readonly executable: string;
  readonly args: readonly string[];
  readonly commandLine: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface DisposableLike {
  dispose(): void;
}

export interface ExtensionContextLike {
  readonly subscriptions: DisposableLike[];
}

export interface VscodeLikeApi {
  readonly commands?: {
    registerCommand(
      command: string,
      callback: (...args: unknown[]) => unknown,
    ): DisposableLike;
  };
  readonly tasks?: {
    registerTaskProvider(
      type: string,
      provider: {
        provideTasks(): unknown[];
        resolveTask(task: unknown): unknown;
      },
    ): DisposableLike;
  };
  readonly window?: {
    showInformationMessage?(message: string): unknown;
    showWarningMessage?(message: string): unknown;
  };
}

export interface GodotGhostActivationHandle extends DisposableLike {
  readonly registeredCommands: readonly string[];
  readonly taskType: 'godot-ghost';
  readonly resolvePlan: typeof resolveGodotStudioPlan;
  readonly buildCommand: typeof buildGodotRunCommand;
}

export const CONTRIBUTED_COMMANDS = [
  'godotGhost.hydrate',
  'godotGhost.runProject',
  'godotGhost.openEditor',
  'godotGhost.exportBuild',
] as const;

let activeDisposables: DisposableLike[] = [];

export function normalizePlatformTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): GhostPlatformTarget {
  if (platform === 'win32') {
    return 'win64';
  }
  if (platform === 'darwin') {
    return arch === 'x64' ? 'macos-x64' : 'macos-arm64';
  }
  return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

export async function fetchGhostCasIndex(
  indexUrl: string = DEFAULT_GHOST_INDEX_URL,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<GhostCasIndex> {
  const response = await fetchImpl(indexUrl, {
    headers: {
      accept: 'application/json',
      'user-agent': 'awesome-os-godot-vscode/0.1.0',
    },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch b8g-ghost cas-v1 index from ${indexUrl}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const parsed = (await response.json()) as GhostCasIndex;
  if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') {
    throw new Error(`Invalid b8g-ghost cas-v1 index payload from ${indexUrl}`);
  }
  return parsed;
}

function toEntryList(index: GhostCasIndex): GhostCasEntry[] {
  return Object.entries(index.entries).map(([key, value]) => ({
    key,
    filename: value.filename ?? key,
    sha256: value.sha256,
    bytes: value.bytes,
    raw_bytes: value.raw_bytes,
    version: value.version,
    category: value.category,
    download_url: value.download_url ?? `${index.cas_base_url || DEFAULT_CAS_BASE_URL}/${value.sha256}`,
  }));
}

function matchesTarget(name: string, target: GhostPlatformTarget): boolean {
  const lower = name.toLowerCase();
  if (lower.includes(target)) {
    return true;
  }
  if (target === 'win64') {
    return lower.includes('win-x64') || lower.includes('windows-x64') || lower.includes('win64');
  }
  if (target === 'macos-arm64' || target === 'macos-x64') {
    return lower.includes('macos-universal') || lower.includes('osx') || lower.includes('darwin');
  }
  return false;
}

function selectGodotEntry(
  entries: readonly GhostCasEntry[],
  target: GhostPlatformTarget,
  preferMono: boolean,
): GhostCasEntry | null {
  const godotEntries = entries.filter((entry) => entry.key.toLowerCase().startsWith('godot-'));
  if (godotEntries.length === 0) {
    return null;
  }
  const platformMatches = godotEntries.filter((entry) => matchesTarget(entry.key, target));
  const pool = platformMatches.length > 0 ? platformMatches : godotEntries;
  if (preferMono) {
    const mono = pool.find((entry) => /mono|dotnet/i.test(entry.key));
    if (mono) {
      return mono;
    }
  }
  return pool[0] ?? null;
}

function selectPrefixedTargetEntry(
  entries: readonly GhostCasEntry[],
  prefix: string,
  target: GhostPlatformTarget,
): GhostCasEntry | null {
  const candidates = entries.filter((entry) => entry.key.toLowerCase().startsWith(prefix.toLowerCase()));
  if (candidates.length === 0) {
    return null;
  }
  const exact = candidates.find((entry) => matchesTarget(entry.key, target));
  if (exact) {
    return exact;
  }
  if (target === 'linux-arm64') {
    const linuxFallback = candidates.find((entry) => entry.key.toLowerCase().includes('linux'));
    if (linuxFallback) {
      return linuxFallback;
    }
  }
  return null;
}

export async function resolveGodotStudioPlan(
  options: ResolveGodotStudioPlanOptions = {},
): Promise<GodotStudioPlan> {
  const target = options.target ?? normalizePlatformTarget(options.platform, options.arch);
  const indexUrl = options.indexUrl ?? DEFAULT_GHOST_INDEX_URL;
  const preferMono = options.preferMono ?? true;
  const index = options.index ?? (await fetchGhostCasIndex(indexUrl, options.fetchImpl));
  const entries = toEntryList(index);

  const godot = selectGodotEntry(entries, target, preferMono);
  const dotnetSdk = selectPrefixedTargetEntry(entries, 'dotnet-sdk-', target);
  const ghostAbi = selectPrefixedTargetEntry(entries, 'b8g-ghost-abi-', target);

  const hydratedAssets: GhostCasEntry[] = [];
  const missingComponents: ('godot' | 'dotnet-sdk' | 'b8g-ghost-abi')[] = [];

  if (godot) {
    hydratedAssets.push(godot);
  } else {
    missingComponents.push('godot');
  }

  if (dotnetSdk) {
    hydratedAssets.push(dotnetSdk);
  } else {
    missingComponents.push('dotnet-sdk');
  }

  if (ghostAbi) {
    hydratedAssets.push(ghostAbi);
  } else {
    missingComponents.push('b8g-ghost-abi');
  }

  const casBaseUrl = index.cas_base_url || DEFAULT_CAS_BASE_URL;
  const baselineTag = index.baseline_tag || 'cas-v1';

  const env: Record<string, string> = {
    B8G_GHOST_CAS_BASE_URL: casBaseUrl,
    B8G_GHOST_BASELINE_TAG: baselineTag,
    B8G_GHOST_TARGET: target,
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_NOLOGO: '1',
  };
  if (dotnetSdk?.version) {
    env.B8G_DOTNET_SDK_VERSION = dotnetSdk.version;
  }
  if (godot?.version) {
    env.B8G_GODOT_VERSION = godot.version;
  }

  return {
    target,
    baselineTag,
    casBaseUrl,
    indexUrl,
    godot,
    godotStatus: godot ? 'available' : 'pending-cas-ingest',
    dotnetSdk,
    ghostAbi,
    hydratedAssets,
    missingComponents,
    ready: missingComponents.length === 0,
    env,
  };
}

function quoteArg(arg: string): string {
  if (arg.length === 0) {
    return '""';
  }
  if (/^[a-zA-Z0-9_./:\\-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function buildGodotRunCommand(options: GodotRunCommandOptions): GodotRunCommand {
  const platform = options.platform ?? process.platform;
  const isWindows = platform === 'win32';
  const cwd = options.projectPath ?? '.';
  const defaultGodotExe = isWindows ? 'godot4.exe' : 'godot4';
  const defaultDotnetExe = isWindows ? 'dotnet.exe' : 'dotnet';
  const extraArgs = options.extraArgs ?? [];

  let executable = options.godotExecutable ?? defaultGodotExe;
  const args: string[] = [];

  if (options.action === 'hydrate') {
    executable = isWindows ? 'b8g-ghost.cmd' : 'b8g-ghost';
    args.push('hydrate', '--tag', 'cas-v1', 'godot', 'dotnet-sdk', 'b8g-ghost-abi');
  } else if (options.action === 'dotnet-build') {
    executable = options.dotnetExecutable ?? defaultDotnetExe;
    args.push('build', '--nologo');
    if (options.projectPath) {
      args.push(options.projectPath);
    }
  } else {
    args.push('--path', cwd);
    if (options.headless) {
      args.push('--headless');
    }
    if (options.action === 'editor') {
      args.push('--editor');
    } else if (options.action === 'export') {
      if (!options.preset || !options.outputPath) {
        throw new Error('Godot export action requires both preset and outputPath');
      }
      args.push(options.debugExport ? '--export-debug' : '--export-release', options.preset, options.outputPath);
    } else if (options.action === 'run' && options.scene) {
      args.push(options.scene);
    }
  }

  for (const flag of extraArgs) {
    args.push(flag);
  }

  const env: Record<string, string> = {
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_NOLOGO: '1',
    ...(options.env ?? {}),
  };

  const commandLine = [executable, ...args].map(quoteArg).join(' ');

  return {
    action: options.action,
    executable,
    args,
    commandLine,
    cwd,
    env,
  };
}

export function activate(
  context?: ExtensionContextLike,
  vscodeApi?: VscodeLikeApi,
): GodotGhostActivationHandle {
  const disposables: DisposableLike[] = [];
  const registeredCommands: string[] = [];

  const register = (command: string, handler: (...args: unknown[]) => unknown): void => {
    registeredCommands.push(command);
    if (vscodeApi?.commands) {
      const disposable = vscodeApi.commands.registerCommand(command, handler);
      disposables.push(disposable);
      context?.subscriptions.push(disposable);
    }
  };

  register('godotGhost.hydrate', async (opts?: unknown) => {
    const plan = await resolveGodotStudioPlan(
      (opts && typeof opts === 'object' ? opts : undefined) as ResolveGodotStudioPlanOptions | undefined,
    );
    if (plan.ready) {
      vscodeApi?.window?.showInformationMessage?.(
        `Godot Ghost hydrated (${plan.target}) from ${plan.baselineTag}.`,
      );
    } else {
      vscodeApi?.window?.showWarningMessage?.(
        `Godot Ghost partial plan (${plan.target}): missing ${plan.missingComponents.join(', ')}.`,
      );
    }
    return plan;
  });

  register('godotGhost.runProject', (opts?: unknown) => {
    const input = (opts && typeof opts === 'object' ? opts : {}) as Partial<GodotRunCommandOptions>;
    return buildGodotRunCommand({ ...input, action: 'run' });
  });

  register('godotGhost.openEditor', (opts?: unknown) => {
    const input = (opts && typeof opts === 'object' ? opts : {}) as Partial<GodotRunCommandOptions>;
    return buildGodotRunCommand({ ...input, action: 'editor' });
  });

  register('godotGhost.exportBuild', (opts?: unknown) => {
    const input = (opts && typeof opts === 'object' ? opts : {}) as Partial<GodotRunCommandOptions>;
    return buildGodotRunCommand({ ...input, action: 'export' });
  });

  if (vscodeApi?.tasks) {
    const taskProvider = vscodeApi.tasks.registerTaskProvider('godot-ghost', {
      provideTasks() {
        return [
          buildGodotRunCommand({ action: 'hydrate' }),
          buildGodotRunCommand({ action: 'dotnet-build' }),
          buildGodotRunCommand({ action: 'run' }),
          buildGodotRunCommand({ action: 'editor' }),
        ];
      },
      resolveTask(task: unknown) {
        return task;
      },
    });
    disposables.push(taskProvider);
    context?.subscriptions.push(taskProvider);
  }

  activeDisposables = disposables;

  return {
    registeredCommands,
    taskType: 'godot-ghost',
    resolvePlan: resolveGodotStudioPlan,
    buildCommand: buildGodotRunCommand,
    dispose() {
      for (const item of disposables) {
        item.dispose();
      }
      if (activeDisposables === disposables) {
        activeDisposables = [];
      }
    },
  };
}

export function deactivate(): void {
  for (const item of activeDisposables) {
    item.dispose();
  }
  activeDisposables = [];
}
