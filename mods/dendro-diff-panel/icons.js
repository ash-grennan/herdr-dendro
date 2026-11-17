// Copy of mods/dendro-files-panel/icons.js (synced by install.sh; edit that one).
// File icons: a Lucide glyph (ISC, see LICENSE-lucide.txt) for each kind of file, tinted by its
// type with the theme's ANSI colours, so the colours follow the theme. No logos.
// Lookup order: exact file name, then a name prefix, then the longest matching extension, then a default.
const DIR = "mods/dendro-files-panel/icons";

const NAMES = {
  "package.json": "npm", "package-lock.json": "npm", ".npmrc": "npm", "yarn.lock": "yarn", ".yarnrc": "yarn",
  "pnpm-lock.yaml": "pnpm", "pnpm-workspace.yaml": "pnpm", "bun.lock": "bun", "bun.lockb": "bun", "bunfig.toml": "bun",
  "tsconfig.json": "tsconfig", "jsconfig.json": "jsconfig", "deno.json": "deno", "deno.jsonc": "deno", "biome.json": "biome",
  "dockerfile": "docker", "docker-compose.yml": "docker", "docker-compose.yaml": "docker", "compose.yml": "docker", "compose.yaml": "docker", ".dockerignore": "docker",
  ".gitignore": "git", ".gitattributes": "git", ".gitmodules": "git", ".gitkeep": "git",
  "license": "license", "license.md": "license", "license.txt": "license", "licence": "license", "copying": "license",
  ".env": "dotenv", ".env.local": "dotenv", ".env.example": "dotenv", ".env.development": "dotenv", ".env.production": "dotenv",
  "makefile": "cmake", "cmakelists.txt": "cmake", "justfile": "just", ".justfile": "just",
  "cargo.toml": "cargo", "cargo.lock": "cargo", "gemfile": "bundler", "gemfile.lock": "bundler",
  "requirements.txt": "pip", "pyproject.toml": "python", "poetry.lock": "poetry", "uv.lock": "uv", "ruff.toml": "ruff", ".ruff.toml": "ruff",
  "build.gradle": "gradle", "settings.gradle": "gradle", "pom.xml": "maven",
  ".editorconfig": "editorconfig", ".prettierrc": "prettier", ".prettierignore": "prettier", ".eslintrc": "eslint", ".eslintignore": "eslint",
  ".babelrc": "babel", "nodemon.json": "nodemon", "turbo.json": "turbo", ".stylelintrc": "stylelint",
  "claude.md": "claude", "agents.md": "agents", "flake.nix": "nix", "flake.lock": "nix",
};

// Prefixes like "vite.config.ts", "eslint.config.js".
const PREFIXES = [
  ["vite.config.", "vite"], ["vitest.config.", "vitest"], ["jest.config.", "jest"], ["tailwind.config.", "tailwind"],
  ["eslint.config.", "eslint"], [".eslintrc.", "eslint"], ["prettier.config.", "prettier"], [".prettierrc.", "prettier"],
  ["webpack.config.", "webpack"], ["rollup.config.", "rollup"], ["postcss.config.", "postcss"], ["babel.config.", "babel"],
  ["tsconfig.", "tsconfig"], ["docker-compose.", "docker"], ["dockerfile.", "docker"], [".env.", "dotenv"], ["license", "license"],
];

const EXT = {
  js: "js", mjs: "js", cjs: "js", ts: "typescript", mts: "typescript", cts: "typescript", "d.ts": "typescriptdef",
  jsx: "reactjs", tsx: "reactts", json: "json", json5: "json5", jsonc: "json", md: "markdown", mdx: "mdx", markdown: "markdown",
  html: "html", htm: "html", css: "css", scss: "scss", sass: "sass", less: "less", vue: "vue", svelte: "svelte", astro: "astro",
  hbs: "handlebars", pug: "pug", ejs: "ejs", graphql: "graphql", gql: "graphql", prisma: "prisma",
  py: "python", pyi: "python", rs: "rust", go: "go", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift", dart: "dartlang",
  c: "c", h: "cheader", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cppheader", hh: "cppheader", cs: "csharp", rb: "ruby", php: "php",
  lua: "lua", zig: "zig", nix: "nix", hs: "haskell", ex: "elixir", exs: "elixir", erl: "erlang", ml: "ocaml", scala: "scala",
  clj: "clojure", r: "r", jl: "julia", mojo: "mojo", wasm: "wasm", proto: "protobuf", tf: "terraform", tfvars: "terraform",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell", ps1: "powershell", psm1: "powershell",
  yml: "yaml", yaml: "yaml", toml: "toml", xml: "xml", ini: "ini", cfg: "config", conf: "config", env: "dotenv",
  sql: "sql", db: "db", sqlite: "db", sqlite3: "db", csv: "csv", tsv: "csv", log: "log", diff: "diff", patch: "diff",
  svg: "svg", png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", ico: "image", bmp: "image", avif: "image",
  ttf: "font", otf: "font", woff: "font", woff2: "font", mp3: "audio", wav: "audio", ogg: "audio", flac: "audio",
  mp4: "video", mov: "video", webm: "video", mkv: "video", pdf: "pdf", zip: "zip", gz: "zip", tar: "zip", tgz: "zip", "7z": "zip", rar: "zip",
  exe: "binary", bin: "binary", dll: "binary", so: "binary", o: "binary", pem: "cert", crt: "cert", key: "key",
  txt: "text", lock: "lock",
};

// Type -> [glyph, colour]: the colour is a theme key, or null for the theme's muted text.
const TYPES = {};
const add = (glyph, color, types) => { for (const type of types.split(" ")) TYPES[type] = [glyph, color]; };
// Source code, coloured by language.
add("file-code", "ansi11", "js");
add("file-code", "ansi12", "typescript typescriptdef css");
add("file-code", "ansi14", "reactjs reactts go dartlang");
add("file-code", "ansi3", "python ocaml zig mojo xml handlebars pug ejs");
add("file-code", "ansi9", "rust swift html svelte ruby java scala erlang");
add("file-code", "ansi4", "c cheader cpp cppheader lua r");
add("file-code", "ansi13", "kotlin php haskell elixir julia csharp scss sass astro");
add("file-code", "ansi10", "vue clojure");
add("file-code", "ansi5", "less nix terraform graphql prisma protobuf");
add("file-terminal", "ansi10", "shell powershell");
add("file-terminal", "ansi3", "cmake just");
// Data and settings.
add("file-braces", "ansi11", "json json5");
add("file-cog", "ansi5", "yaml toml");
add("file-cog", null, "ini config editorconfig");
add("file-cog", "ansi12", "tsconfig jsconfig");
add("file-cog", "ansi13", "eslint prettier babel nodemon turbo stylelint biome ruff vite vitest jest tailwind webpack rollup postcss");
add("file-cog", "ansi9", "git");
add("file-box", "ansi3", "npm yarn pnpm bun bundler pip poetry uv cargo gradle maven deno");
add("file-box", "ansi12", "docker");
add("file-box", "ansi5", "wasm");
add("file-box", null, "binary");
add("file-lock", null, "lock");
add("file-lock", "ansi11", "dotenv");
add("file-key", "ansi11", "key");
add("file-key", "ansi10", "cert");
add("file-database", "ansi6", "sql db");
add("file-spreadsheet", "ansi10", "csv");
// Prose and media.
add("file-text", "ansi12", "markdown mdx");
add("file-text", "ansi3", "claude agents");
add("file-text", "ansi11", "license");
add("file-text", "ansi1", "pdf");
add("file-text", null, "text log");
add("file-image", "ansi13", "image svg");
add("file-play", "ansi13", "video");
add("file-music", "ansi13", "audio");
add("file-type", "ansi5", "font");
add("file-archive", "ansi3", "zip");
add("file-diff", "ansi2", "diff");

// Own keys only: a file named "constructor" must not find Object.prototype's.
const pick = (map, key) => Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;

// { path, color }: the glyph to draw, and the theme key to tint it with (null: muted text).
export function fileIcon(name) {
  const lower = name.toLowerCase();
  let type = pick(NAMES, lower);
  if (!type) for (const [prefix, t] of PREFIXES) if (lower.startsWith(prefix)) { type = t; break; }
  if (!type) {
    const parts = lower.split(".");
    for (let i = 1; i < parts.length && !type; i++) type = pick(EXT, parts.slice(i).join("."));
  }
  const [glyph, color] = (type && pick(TYPES, type)) || ["file", null];
  return { path: `${DIR}/${glyph}.svg`, color };
}

// Folders: one glyph, open or closed, tinted by the caller.
export const plainFolder = (open) => `mods/dendro-files-panel/folder${open ? "-open" : ""}.svg`;
