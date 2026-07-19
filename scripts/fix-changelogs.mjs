import { globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ALIGNMENT_NOTE = "Version alignment release with no public API changes in this package.";

function cleanChangelog(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const cleaned = [];

  for (const line of lines) {
    if (line === "- fix") {
      continue;
    }

    if (line === "- Updated dependencies") {
      continue;
    }

    cleaned.push(line);
  }

  const sections = [];
  let current = null;

  for (const line of cleaned) {
    const versionMatch = line.match(/^## (.+)$/);
    if (versionMatch) {
      if (current) {
        sections.push(current);
      }
      current = { version: versionMatch[1], lines: [line] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    } else {
      if (!sections.length) {
        sections.push({ version: null, lines: [line] });
      } else {
        sections[0].lines.push(line);
      }
    }
  }

  if (current) {
    sections.push(current);
  }

  const output = [];

  for (const section of sections) {
    if (!section.version) {
      output.push(...section.lines);
      continue;
    }

    const bodyLines = section.lines.slice(1);
    const blocks = [];
    let block = null;

    for (const line of bodyLines) {
      const headingMatch = line.match(/^### (.+)$/);
      if (headingMatch) {
        if (block) {
          blocks.push(block);
        }
        block = { heading: headingMatch[1], lines: [] };
        continue;
      }

      if (block) {
        block.lines.push(line);
      }
    }

    if (block) {
      blocks.push(block);
    }

    const nonEmptyBlocks = blocks
      .map((entry) => ({
        heading: entry.heading,
        lines: trimBlockLines(entry.lines),
      }))
      .filter((entry) => entry.lines.length > 0);

    if (nonEmptyBlocks.length === 0) {
      continue;
    }

    if (isLegacyPlaceholderSection(section.version, nonEmptyBlocks)) {
      continue;
    }

    output.push(`## ${section.version}`, "");

    for (const entry of nonEmptyBlocks) {
      output.push(`### ${entry.heading}`, "", ...entry.lines, "");
    }
  }

  return `${trimTrailingBlankLines(output).join("\n")}\n`;
}

function isLegacyPlaceholderSection(version, blocks) {
  if (!/^0\.0\.[0-9]+$/.test(version)) {
    return false;
  }

  if (blocks.length !== 1 || blocks[0].heading !== "Patch Changes") {
    return false;
  }

  return blocks[0].lines.every((line) => {
    if (line === "") {
      return true;
    }

    return /^  - @[^ ]+@[0-9.]+\s*$/.test(line);
  });
}

function trimBlockLines(lines) {
  const trimmed = [...lines];

  while (trimmed.length > 0 && trimmed[0] === "") {
    trimmed.shift();
  }

  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
    trimmed.pop();
  }

  return trimmed.filter((line, index, array) => {
    if (line !== "") {
      return true;
    }

    return array[index - 1] !== "";
  });
}

function trimTrailingBlankLines(lines) {
  const trimmed = [...lines];

  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
    trimmed.pop();
  }

  return trimmed;
}

function ensureLatestSection(content, packageName, packageVersion) {
  const latestSectionMatch = content.match(
    new RegExp(`^## ${escapeRegExp(packageVersion)}\\n`, "m"),
  );

  if (latestSectionMatch) {
    return content;
  }

  const insertion = `\n## ${packageVersion}\n\n### Patch Changes\n\n- ${ALIGNMENT_NOTE}\n`;

  if (content.trimEnd() === `# ${packageName}`) {
    return `# ${packageName}${insertion}`;
  }

  return `${content.trimEnd()}${insertion}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPackageInfo(changelogPath) {
  const packageJsonPath = join(dirname(changelogPath), "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return {
    name: packageJson.name,
    version: packageJson.version,
  };
}

const changelogPaths = [
  ...globSync("packages/*/CHANGELOG.md", { cwd: root }),
  ...globSync("examples/*/CHANGELOG.md", { cwd: root }),
].map((relativePath) => join(root, relativePath));

for (const changelogPath of changelogPaths) {
  const original = readFileSync(changelogPath, "utf8");
  const { name: packageName, version: packageVersion } = getPackageInfo(changelogPath);
  let next = cleanChangelog(original);
  next = ensureLatestSection(next, packageName, packageVersion);

  if (next !== original) {
    writeFileSync(changelogPath, next);
    console.log(`updated ${changelogPath.replace(`${root}/`, "")}`);
  }
}
