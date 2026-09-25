// Metro doesn't tree-shake, so `import { X } from "lucide-react-native"` bundles all ~1.5k icons
// (~1.2 MB on the web). This rewrites each named icon import to that icon's own file.
const fs = require("node:fs");
const path = require("node:path");

function lucideIcons() {
  const root = path.dirname(require.resolve("lucide-react-native/package.json"));
  const index = fs.readFileSync(path.join(root, "dist/esm/lucide-react-native.js"), "utf8");
  const icons = new Map();
  for (const [, names, file] of index.matchAll(
    /export \{([^}]+)\} from '\.\/icons\/([\w-]+)\.js'/g,
  ))
    for (const [, name] of names.matchAll(/default as (\w+)/g)) icons.set(name, file);
  return icons;
}

function lucideDirectImports({ types: t }) {
  const icons = lucideIcons();
  return {
    visitor: {
      ImportDeclaration(p) {
        if (p.node.source.value !== "lucide-react-native" || p.node.importKind === "type") return;
        const direct = [];
        const kept = [];
        for (const spec of p.node.specifiers) {
          const file =
            t.isImportSpecifier(spec) &&
            spec.importKind !== "type" &&
            icons.get(spec.imported.name);
          if (file)
            direct.push(
              t.importDeclaration(
                [t.importDefaultSpecifier(t.identifier(spec.local.name))],
                t.stringLiteral(`lucide-react-native/dist/esm/icons/${file}.js`),
              ),
            );
          else kept.push(spec);
        }
        if (!direct.length) return;
        if (kept.length) {
          p.node.specifiers = kept;
          p.insertAfter(direct);
        } else p.replaceWithMultiple(direct);
      },
    },
  };
}

module.exports = (api) => {
  api.cache(true);
  return {
    presets: [
      require.resolve("babel-preset-expo", { paths: [require.resolve("expo/package.json")] }),
    ],
    plugins: [lucideDirectImports],
  };
};
