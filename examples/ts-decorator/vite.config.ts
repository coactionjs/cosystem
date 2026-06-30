import { defineConfig } from "vite";
import type { Plugin } from "vite";
import * as ts from "typescript";

export default defineConfig({
  plugins: [standardDecoratorTransform()],
});

function standardDecoratorTransform(): Plugin {
  return {
    enforce: "pre",
    name: "cosystem-example-standard-decorator-transform",
    transform(code, id) {
      if (!id.includes("/src/") || !id.endsWith(".ts")) {
        return undefined;
      }

      const result = ts.transpileModule(code, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          sourceMap: true,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: id,
      });

      return {
        code: result.outputText,
        map: result.sourceMapText === undefined ? null : JSON.parse(result.sourceMapText),
      };
    },
  };
}
