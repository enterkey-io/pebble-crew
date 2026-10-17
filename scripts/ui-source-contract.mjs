import ts from 'typescript';

export function sourceContract(source) {
  const file = ts.createSourceFile(
    'screen.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports = new Map(),
    jsx = new Set(),
    calls = [],
    modules = [],
    screenCalls = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      modules.push(node.moduleSpecifier.text);
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          imports.set(element.name.text, {
            source: node.moduleSpecifier.text,
            exported: (element.propertyName ?? element.name).text,
          });
    }
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const statement of file.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    function screen(node) {
      if (node !== statement && ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node)) screenCalls.push(node);
      if (ts.isReturnStatement(node) && node.expression) {
        function render(child) {
          if (
            (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) &&
            ts.isIdentifier(child.tagName)
          )
            jsx.add(child.tagName.text);
          ts.forEachChild(child, render);
        }
        render(node.expression);
      }
      ts.forEachChild(node, screen);
    }
    screen(statement);
  }
  return {
    renders(exported, module) {
      return [...jsx].some(
        (name) => imports.get(name)?.exported === exported && imports.get(name)?.source === module,
      );
    },
    ownsProfileSession() {
      return screenCalls.some(
        (call) =>
          ts.isIdentifier(call.expression) &&
          imports.get(call.expression.text)?.exported === 'useReducer' &&
          imports.get(call.expression.text)?.source === 'react' &&
          call.arguments.some(
            (arg) =>
              ts.isIdentifier(arg) &&
              imports.get(arg.text)?.exported === 'profileReducer' &&
              imports.get(arg.text)?.source === './profiles/edit-session',
          ),
      );
    },
    rawOperations() {
      const operations = [];
      for (const call of calls) {
        if (
          !ts.isPropertyAccessExpression(call.expression) ||
          call.expression.name.text !== 'invoke' ||
          !call.arguments[0]
        )
          continue;
        function strings(node) {
          if (ts.isStringLiteral(node)) operations.push(node.text);
          ts.forEachChild(node, strings);
        }
        strings(call.arguments[0]);
      }
      return operations;
    },
    unsupportedImports() {
      return modules.filter((source) => /packages\/.*\/src|(?:^|\/)workspace$/.test(source));
    },
  };
}
