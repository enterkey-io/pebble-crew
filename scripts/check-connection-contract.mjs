import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export function connectionViolations(path, source) {
  if (path.endsWith('.test.ts') || path.endsWith('connection/session.ts')) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const errors = [];
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@hermes-client/protocol'
    ) {
      const names = node.importClause?.namedBindings;
      if (
        names &&
        ts.isNamedImports(names) &&
        names.elements.some((item) => (item.propertyName ?? item.name).text === 'BotBridgeClient')
      )
        errors.push(
          `${path}: only OwnerSession can import the wire client. Use SessionClient in features.`,
        );
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return errors;
}
function scan(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? scan(path)
      : /\.tsx?$/.test(path)
        ? connectionViolations(path, readFileSync(path, 'utf8'))
        : [];
  });
}
if (process.argv[1]?.endsWith('check-connection-contract.mjs')) {
  const errors = scan('apps/web/src');
  if (errors.length) {
    errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else
    console.log(
      'Connection ownership verified: only OwnerSession can construct or own a wire client.',
    );
}
