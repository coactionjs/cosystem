import {
  addModuleAction,
  addModuleComputed,
  addModuleEffect,
  addModuleState,
  applyModuleOptions,
  defineModule,
  ensureContextModuleMetadata,
  ensureModuleMetadata,
  type ModuleOptions,
} from "./metadata.js";
import type { Constructor } from "./types.js";

export function Module(options: ModuleOptions = {}) {
  return function ModuleDecorator<T extends Constructor>(
    target: T,
    context?: ClassDecoratorContext<T>,
  ): T {
    defineModule(target, options, context);
    return target;
  };
}

export function State<This extends object, Value>(
  _value: ClassAccessorDecoratorTarget<This, Value>,
  context: ClassAccessorDecoratorContext<This, Value>,
): void {
  if (context.kind !== "accessor") {
    throw new TypeError("@State only supports standard accessor decorators.");
  }

  ensureContextModuleMetadata(context)?.state.add(context.name);

  context.addInitializer(function initializeState(this: This) {
    addModuleState(this.constructor, context.name);
  });
}

export function Action<This extends object, Args extends unknown[], Return>(
  _value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): void {
  if (context.kind !== "method") {
    throw new TypeError("@Action only supports method decorators.");
  }

  ensureContextModuleMetadata(context)?.actions.add(context.name);

  context.addInitializer(function initializeAction(this: This) {
    addModuleAction(this.constructor, context.name);
  });
}

export function Computed<This extends object, Value>(
  _value: (this: This) => Value,
  context: ClassGetterDecoratorContext<This, Value>,
): void {
  if (context.kind !== "getter") {
    throw new TypeError("@Computed only supports getter decorators.");
  }

  ensureContextModuleMetadata(context)?.computed.add(context.name);

  context.addInitializer(function initializeComputed(this: This) {
    addModuleComputed(this.constructor, context.name);
  });
}

export function Effect<This extends object, Args extends unknown[], Return>(
  _value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): void {
  if (context.kind !== "method") {
    throw new TypeError("@Effect only supports method decorators.");
  }

  ensureContextModuleMetadata(context)?.effects.add(context.name);

  context.addInitializer(function initializeEffect(this: This) {
    addModuleEffect(this.constructor, context.name);
  });
}

export function moduleOptions(target: Constructor, options: ModuleOptions): void {
  applyModuleOptions(ensureModuleMetadata(target), options);
}
