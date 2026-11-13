// Copy of mods/dendro-files-panel/icons.js (synced by install.sh; edit that one).
// File and folder icons from vscode-icons (MIT, see icons/LICENSE-vscode-icons.txt).
// Lookup order: exact file name, then the longest matching extension, then a default.
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
  txt: "text", lock: "text",
};

// Folder name → vscode-icons folder_type_<x>.
const FOLDERS = {
  src: "src", source: "src", dist: "dist", out: "dist", build: "dist", release: "dist",
  test: "test", tests: "test", __tests__: "test", spec: "test", e2e: "e2e", cypress: "cypress", coverage: "coverage",
  doc: "docs", docs: "docs", node_modules: "node", public: "public", static: "public", www: "public",
  asset: "asset", assets: "asset", res: "asset", resources: "asset", image: "images", images: "images", img: "images", icons: "images", art: "images",
  config: "config", configs: "config", conf: "config", settings: "config", script: "script", scripts: "script",
  lib: "library", libs: "library", vendor: "library", component: "component", components: "component",
  ".github": "github", ".vscode": "vscode", ".idea": "idea", ".husky": "husky", ".git": "git", ".claude": "claude", ".cargo": "cargo",
  style: "style", styles: "style", css: "style", api: "api", hooks: "hook", hook: "hook", helpers: "helper", helper: "helper", utils: "helper", util: "helper",
  tools: "tools", tool: "tools", views: "view", view: "view", pages: "view", screens: "view", models: "model", model: "model", schema: "model", schemas: "model",
  controllers: "controller", controller: "controller", routes: "route", route: "route", router: "route", services: "services", service: "services",
  store: "redux", stores: "redux", redux: "redux", state: "redux", types: "typings", typings: "typings", "@types": "typings",
  locale: "locale", locales: "locale", i18n: "locale", lang: "locale", fonts: "fonts", font: "fonts", db: "db", database: "db", migrations: "db",
  docker: "docker", mock: "mock", mocks: "mock", __mocks__: "mock", tmp: "temp", temp: "temp", log: "log", logs: "log",
  include: "include", includes: "include", bin: "binary", app: "app", apps: "app", plugin: "plugin", plugins: "plugin", mods: "plugin",
  packages: "package", package: "package", pkg: "package", middleware: "middleware", middlewares: "middleware",
  venv: "python", ".venv": "python", __pycache__: "python", theme: "theme", themes: "theme", template: "template", templates: "template", layouts: "template",
  audio: "audio", sounds: "audio", video: "video", cli: "cli", cmd: "cli", server: "server", client: "client", shared: "shared", common: "shared",
  android: "android", ios: "ios", k8s: "kubernetes", kubernetes: "kubernetes", aws: "aws", prisma: "prisma", stories: "story", ".storybook": "story",
  fixtures: "mock",
};

export function fileIcon(name) {
  const lower = name.toLowerCase();
  let type = NAMES[lower];
  if (!type) for (const [prefix, t] of PREFIXES) if (lower.startsWith(prefix)) { type = t; break; }
  if (!type) {
    const parts = lower.split(".");
    for (let i = 1; i < parts.length && !type; i++) type = EXT[parts.slice(i).join(".")];
  }
  return type ? `${DIR}/file_type_${type}.svg` : `${DIR}/default_file.svg`;
}

// A known folder's full-colour icon, or null (draw a tinted folder instead).
export function folderIcon(name, open) {
  const type = FOLDERS[name.toLowerCase()];
  return type ? `${DIR}/folder_type_${type}${open ? "_opened" : ""}.svg` : null;
}

export const plainFolder = (open) => `mods/dendro-files-panel/folder${open ? "-open" : ""}.svg`;
