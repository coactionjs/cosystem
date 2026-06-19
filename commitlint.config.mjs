import { defineConfig } from "cz-git";

const scopes = ["core", "config", "repo", "release", "docs", "ci", "deps"];

export default defineConfig({
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
    "scope-enum": [2, "always", scopes],
    "subject-case": [0],
  },
  prompt: {
    allowCustomScopes: true,
    allowEmptyScopes: false,
    scopes,
    types: [
      { value: "feat", name: "feat:     A new feature" },
      { value: "fix", name: "fix:      A bug fix" },
      { value: "docs", name: "docs:     Documentation only changes" },
      { value: "style", name: "style:    Formatting-only changes" },
      { value: "refactor", name: "refactor: Code change without feature or fix" },
      { value: "perf", name: "perf:     Performance improvement" },
      { value: "test", name: "test:     Tests added or changed" },
      { value: "build", name: "build:    Build system or dependency changes" },
      { value: "ci", name: "ci:       CI configuration changes" },
      { value: "chore", name: "chore:    Maintenance changes" },
      { value: "revert", name: "revert:   Revert a previous commit" },
    ],
    useEmoji: false,
  },
});
