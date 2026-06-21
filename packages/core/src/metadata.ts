import type { Constructor, DependencySpec, Scope } from "./types.js";

export interface ModuleOptions {
  readonly name?: string;
  readonly deps?: readonly DependencySpec[];
  readonly scope?: Scope;
}

export interface DefineModuleOptions extends ModuleOptions {
  readonly state?: readonly PropertyKey[];
  readonly actions?: readonly PropertyKey[];
  readonly computed?: readonly PropertyKey[];
  readonly effects?: readonly PropertyKey[];
}

export interface ModuleMetadata {
  readonly kind: "module";
  name?: string;
  deps?: readonly DependencySpec[];
  scope?: Scope;
  readonly state: Set<PropertyKey>;
  readonly actions: Set<PropertyKey>;
  readonly computed: Set<PropertyKey>;
  readonly effects: Set<PropertyKey>;
}

const moduleMetadata = new WeakMap<Function, ModuleMetadata>();
const moduleMetadataKey = Symbol.for("@cosystem/core/moduleMetadata");
const symbolMetadataKey: symbol | undefined = (
  Symbol as SymbolConstructor & { readonly metadata?: symbol }
).metadata;

export interface MetadataContext {
  readonly metadata?: Record<PropertyKey, unknown> | undefined;
}

export function defineModule<T extends Constructor>(
  target: T,
  options: DefineModuleOptions = {},
  context?: MetadataContext,
): T {
  const metadata = ensureModuleMetadata(target);
  mergeModuleMetadata(metadata, readContextMetadata(context));
  applyModuleOptions(metadata, options);
  addProperties(metadata.state, options.state);
  addProperties(metadata.actions, options.actions);
  addProperties(metadata.computed, options.computed);
  addProperties(metadata.effects, options.effects);
  writeContextMetadata(context, metadata);
  return target;
}

export function getModuleMetadata(target: Function): ModuleMetadata | undefined {
  const existing = moduleMetadata.get(target);

  if (existing !== undefined) {
    return existing;
  }

  const metadata = readSymbolMetadata(target);

  if (metadata === undefined) {
    return undefined;
  }

  moduleMetadata.set(target, metadata);
  return metadata;
}

export function addModuleState(target: Function, property: PropertyKey): void {
  ensureModuleMetadata(target).state.add(property);
}

export function addModuleAction(target: Function, property: PropertyKey): void {
  ensureModuleMetadata(target).actions.add(property);
}

export function addModuleComputed(target: Function, property: PropertyKey): void {
  ensureModuleMetadata(target).computed.add(property);
}

export function addModuleEffect(target: Function, property: PropertyKey): void {
  ensureModuleMetadata(target).effects.add(property);
}

export function applyModuleOptions(metadata: ModuleMetadata, options: ModuleOptions): void {
  if (options.name !== undefined) {
    metadata.name = options.name;
  }

  if (options.deps !== undefined) {
    metadata.deps = options.deps;
  }

  if (options.scope !== undefined) {
    metadata.scope = options.scope;
  }
}

export function ensureModuleMetadata(target: Function): ModuleMetadata {
  let metadata = moduleMetadata.get(target);

  if (metadata !== undefined) {
    return metadata;
  }

  metadata = {
    kind: "module",
    state: new Set(),
    actions: new Set(),
    computed: new Set(),
    effects: new Set(),
  };
  moduleMetadata.set(target, metadata);
  return metadata;
}

export function ensureContextModuleMetadata(
  context: MetadataContext | undefined,
): ModuleMetadata | undefined {
  if (context?.metadata === undefined) {
    return undefined;
  }

  const existing = readContextMetadata(context);

  if (existing !== undefined) {
    return existing;
  }

  const metadata = createModuleMetadata();
  writeContextMetadata(context, metadata);
  return metadata;
}

function addProperties(target: Set<PropertyKey>, properties: readonly PropertyKey[] | undefined) {
  for (const property of properties ?? []) {
    target.add(property);
  }
}

function createModuleMetadata(): ModuleMetadata {
  return {
    kind: "module",
    state: new Set(),
    actions: new Set(),
    computed: new Set(),
    effects: new Set(),
  };
}

function readContextMetadata(context: MetadataContext | undefined): ModuleMetadata | undefined {
  const value = context?.metadata?.[moduleMetadataKey];
  return isModuleMetadata(value) ? value : undefined;
}

function writeContextMetadata(
  context: MetadataContext | undefined,
  metadata: ModuleMetadata,
): void {
  if (context?.metadata === undefined) {
    return;
  }

  context.metadata[moduleMetadataKey] = metadata;
}

function readSymbolMetadata(target: Function): ModuleMetadata | undefined {
  if (symbolMetadataKey === undefined) {
    return undefined;
  }

  const metadata = (target as unknown as Record<PropertyKey, unknown>)[symbolMetadataKey];

  if (metadata === undefined || metadata === null || typeof metadata !== "object") {
    return undefined;
  }

  const value = (metadata as Record<PropertyKey, unknown>)[moduleMetadataKey];
  return isModuleMetadata(value) ? value : undefined;
}

function mergeModuleMetadata(target: ModuleMetadata, source: ModuleMetadata | undefined): void {
  if (source === undefined || source === target) {
    return;
  }

  applyModuleOptions(target, source);
  addProperties(target.state, [...source.state]);
  addProperties(target.actions, [...source.actions]);
  addProperties(target.computed, [...source.computed]);
  addProperties(target.effects, [...source.effects]);
}

function isModuleMetadata(value: unknown): value is ModuleMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ModuleMetadata).kind === "module" &&
    value instanceof Object &&
    (value as ModuleMetadata).state instanceof Set &&
    (value as ModuleMetadata).actions instanceof Set &&
    (value as ModuleMetadata).computed instanceof Set &&
    (value as ModuleMetadata).effects instanceof Set
  );
}
