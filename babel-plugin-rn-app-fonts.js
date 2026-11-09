/**
 * 把项目源码里的 `import { Text, TextInput } from 'react-native'`
 * 改写到 `@/components/ui/rn-font-text`。
 * 绝不处理 node_modules（否则会把 expo 等包改坏且无法解析 @/）。
 */
const WRAPPER = '@/components/ui/rn-font-text';

/** @param {{ types: import('@babel/core').types }} babel */
module.exports = function rnAppFontsPlugin({ types: t }) {
  function shouldTransform(filename) {
    if (!filename) return false;
    const norm = filename.replace(/\\/g, '/');
    // 双保险：babel.config 已 exclude node_modules，这里再挡一次
    if (norm.includes('/node_modules/')) return false;
    if (norm.includes('/components/ui/rn-font-text')) return false;
    if (norm.includes('/lib/resolve-app-font-style')) return false;
    if (norm.includes('/scripts/')) return false;
    return true;
  }

  return {
    name: 'rn-app-fonts',
    visitor: {
      Program: {
        enter(_path, state) {
          state.file.set('appFontText', null);
          state.file.set('appFontTextInput', null);
        },
        exit(path, state) {
          if (!shouldTransform(state.filename)) return;
          const textLocal = state.file.get('appFontText');
          const inputLocal = state.file.get('appFontTextInput');
          if (!textLocal && !inputLocal) return;

          const specifiers = [];
          if (textLocal) {
            specifiers.push(
              t.importSpecifier(t.identifier(textLocal), t.identifier('Text')),
            );
          }
          if (inputLocal) {
            specifiers.push(
              t.importSpecifier(t.identifier(inputLocal), t.identifier('TextInput')),
            );
          }
          path.unshiftContainer(
            'body',
            t.importDeclaration(specifiers, t.stringLiteral(WRAPPER)),
          );
        },
      },
      ImportDeclaration(path, state) {
        if (path.node.source.value !== 'react-native') return;
        if (!shouldTransform(state.filename)) return;

        const keep = [];
        let changed = false;

        for (const spec of path.node.specifiers) {
          if (!t.isImportSpecifier(spec)) {
            keep.push(spec);
            continue;
          }
          const imported = t.isIdentifier(spec.imported)
            ? spec.imported.name
            : spec.imported.value;
          const local = spec.local.name;

          if (imported === 'Text') {
            state.file.set('appFontText', local);
            changed = true;
            continue;
          }
          if (imported === 'TextInput') {
            state.file.set('appFontTextInput', local);
            changed = true;
            continue;
          }
          keep.push(spec);
        }

        if (!changed) return;
        if (keep.length === 0) {
          path.remove();
        } else {
          path.node.specifiers = keep;
        }
      },
    },
  };
};

