// Builds the React client (client/) with esbuild.
//
// `tsx build-client.ts` writes a production build to dist/public, which the
// Express server (`npm start`) and Vercel both serve as static files.
// In development, server/dev-client.ts calls watchClient() instead, which
// rebuilds into dist/dev-public on every change.
//
// Tailwind v4 runs through its PostCSS plugin inside the CSS loader below.
import * as esbuild from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import fs from "fs";
import path from "path";

const rootDir = import.meta.dirname;
const clientDir = path.resolve(rootDir, "client");

export const publicDir = path.resolve(rootDir, "dist", "public");
export const devPublicDir = path.resolve(rootDir, "dist", "dev-public");

// index.html names the entry module with this tag; the build swaps it for
// the hashed bundle.
const ENTRY_TAG = `<script type="module" src="/src/main.tsx"></script>`;

// "Baseline widely available" browsers.
const TARGET = ["chrome107", "edge107", "firefox104", "safari16"];

function tailwindPlugin(dev: boolean): esbuild.Plugin {
  return {
    name: "tailwind",
    setup(build) {
      // Only the app's own stylesheets go through Tailwind; CSS imported from
      // packages loads as plain CSS.
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const relative = path.relative(clientDir, args.path);
        if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;

        const source = await fs.promises.readFile(args.path, "utf8");
        const result = await postcss([
          tailwindcss({ base: clientDir, optimize: !dev }),
          autoprefixer(),
        ]).process(source, { from: args.path });

        // Tailwind reports the files and folders it scanned for class names,
        // so watch mode rebuilds the CSS when any of them change.
        const watchFiles: string[] = [];
        const watchDirs: string[] = [];
        for (const message of result.messages) {
          if (message.type === "dependency") watchFiles.push(message.file);
          if (message.type === "dir-dependency") watchDirs.push(message.dir);
        }

        return { contents: result.css, loader: "css", watchFiles, watchDirs };
      });
    },
  };
}

function buildOptions(dev: boolean, outDir: string): esbuild.BuildOptions {
  return {
    absWorkingDir: rootDir,
    entryPoints: [path.join(clientDir, "src", "main.tsx")],
    outdir: path.join(outDir, "assets"),
    publicPath: "/assets/",
    entryNames: "[name]-[hash]",
    chunkNames: "[name]-[hash]",
    assetNames: "[name]-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: TARGET,
    jsx: "automatic",
    // Resolves the @/ and @shared/ path aliases.
    tsconfig: path.join(rootDir, "tsconfig.json"),
    loader: {
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".gif": "file",
      ".svg": "file",
      ".webp": "file",
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
    },
    minify: !dev,
    sourcemap: dev,
    metafile: true,
    logLevel: "warning",
    plugins: [tailwindPlugin(dev)],
  };
}

function copyPublicFiles(outDir: string) {
  fs.cpSync(path.join(clientDir, "public"), outDir, { recursive: true });
}

// Writes outDir/index.html from client/index.html, pointing it at the hashed
// JS and CSS that esbuild just produced.
function writeIndexHtml(metafile: esbuild.Metafile, outDir: string, headHtml = "") {
  const toUrl = (file: string) =>
    "/" + path.relative(outDir, path.resolve(rootDir, file)).split(path.sep).join("/");

  const outputs = Object.entries(metafile.outputs);
  const entry = outputs.find(([, output]) => output.entryPoint === "client/src/main.tsx");
  if (!entry) throw new Error("esbuild produced no output for client/src/main.tsx");

  const styles = outputs
    .filter(([file]) => file.endsWith(".css"))
    .map(([file]) => `<link rel="stylesheet" href="${toUrl(file)}">`);

  const template = fs.readFileSync(path.join(clientDir, "index.html"), "utf8");
  if (!template.includes(ENTRY_TAG)) {
    throw new Error(`client/index.html must contain ${ENTRY_TAG}`);
  }

  const html = template
    .replace(ENTRY_TAG, `<script type="module" src="${toUrl(entry[0])}"></script>`)
    .replace("</head>", `${[...styles, headHtml].filter(Boolean).join("\n")}\n</head>`);

  fs.writeFileSync(path.join(outDir, "index.html"), html);
}

export async function buildClient() {
  fs.rmSync(publicDir, { recursive: true, force: true });
  const result = await esbuild.build(buildOptions(false, publicDir));
  copyPublicFiles(publicDir);
  writeIndexHtml(result.metafile!, publicDir);
  console.log(`client built to ${path.relative(rootDir, publicDir)}`);
}

// Rebuilds into dist/dev-public whenever a client file changes. headHtml is
// added to the page's <head>; onRebuild runs after every successful build.
export async function watchClient(headHtml: string, onRebuild: () => void) {
  fs.rmSync(devPublicDir, { recursive: true, force: true });
  copyPublicFiles(devPublicDir);

  // Settles after the first build, so index.html exists before the server
  // takes requests. A failed first build still settles: esbuild prints the
  // errors and the next save rebuilds.
  let firstBuildDone!: () => void;
  const firstBuild = new Promise<void>((resolve) => (firstBuildDone = resolve));

  const options = buildOptions(true, devPublicDir);
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      ...(options.plugins ?? []),
      {
        name: "dev-index-html",
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length === 0 && result.metafile) {
              writeIndexHtml(result.metafile, devPublicDir, headHtml);
              onRebuild();
            }
            firstBuildDone();
          });
        },
      },
    ],
  });

  await ctx.watch();
  await firstBuild;
}

// Run directly by the build scripts in package.json. The basename check keeps
// this from firing if the module is ever bundled into another entry point.
if (path.basename(process.argv[1] ?? "") === "build-client.ts") {
  await buildClient();
}
