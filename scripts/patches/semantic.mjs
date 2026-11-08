// Templates bind minified identifiers while preserving API names and control flow.
// Repeated slots must refer to the same identifier; never accept ambiguous matches.
export function pattern(template) {
  const seen = new Set();
  const parts = template.split(/(\{\{[A-Za-z]+\}\})/);
  return new RegExp(parts.map((part) => {
    if (!part.startsWith("{{")) return escapeRegex(part);
    const name = part.slice(2, -2);
    if (seen.has(name)) return `\\k<${name}>`;
    seen.add(name);
    return `(?<${name}>[A-Za-z_$][\\w$]*)`;
  }).join(""), "g");
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function uniqueMatch(source, regex, label) {
  const matches = [...source.matchAll(regex)];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one semantic anchor, found ${matches.length}`);
  }
  return matches[0];
}

export function replaceMatch(source, match, replacement) {
  return source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
}
