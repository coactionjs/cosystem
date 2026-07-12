import { createRuntimeAsyncContext } from "./async-context.js";
import { InjectContextError } from "./errors.js";
import { tokenName } from "./token.js";
import type { InjectionToken, ResolutionContext, TokenValue } from "./types.js";

const activeResolutionContexts: ResolutionContext[] = [];
const asyncResolutionContext = createRuntimeAsyncContext<ResolutionContext>();

export function inject<TToken extends InjectionToken>(token: TToken): TokenValue<TToken> {
  const activeResolutionContext =
    activeResolutionContexts.at(-1) ?? asyncResolutionContext?.getStore();

  if (activeResolutionContext === undefined) {
    throw new InjectContextError(tokenName(token));
  }

  return activeResolutionContext.resolve(token) as TokenValue<TToken>;
}

export function runWithInjectContext<T>(
  context: ResolutionContext,
  callback: () => T,
  preserveAsync = false,
): T {
  if (preserveAsync && asyncResolutionContext !== undefined) {
    return asyncResolutionContext.run(context, () => runWithSynchronousContext(context, callback));
  }

  if (preserveAsync) {
    return runWithSynchronousContext(context, callback);
  }

  activeResolutionContexts.push(context);

  const removeContext = () => {
    const index = activeResolutionContexts.lastIndexOf(context);

    if (index !== -1) {
      activeResolutionContexts.splice(index, 1);
    }
  };

  try {
    const result = callback();

    removeContext();
    return result;
  } catch (error) {
    removeContext();
    throw error;
  }
}

function runWithSynchronousContext<T>(context: ResolutionContext, callback: () => T): T {
  activeResolutionContexts.push(context);

  try {
    return callback();
  } finally {
    const index = activeResolutionContexts.lastIndexOf(context);

    if (index !== -1) {
      activeResolutionContexts.splice(index, 1);
    }
  }
}
