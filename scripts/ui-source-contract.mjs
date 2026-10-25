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
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  const memoViews = new Map();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (
        !ts.isIdentifier(declaration.name) ||
        !call ||
        !ts.isCallExpression(call) ||
        !ts.isIdentifier(call.expression) ||
        imports.get(call.expression.text)?.source !== 'react' ||
        imports.get(call.expression.text)?.exported !== 'memo'
      )
        continue;
      const view = call.arguments[0];
      if (view && (ts.isFunctionExpression(view) || ts.isArrowFunction(view)))
        memoViews.set(declaration.name.text, view);
    }
  }
  for (const statement of file.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    const values = new Map(),
      resolved = new Set(),
      renderedViews = new Set();
    function declarations(node) {
      if (node !== statement && ts.isFunctionLike(node)) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
        values.set(node.name.text, node.initializer);
      ts.forEachChild(node, declarations);
    }
    declarations(statement);
    function render(child) {
      if (
        (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) &&
        ts.isIdentifier(child.tagName)
      ) {
        jsx.add(child.tagName.text);
        const view = memoViews.get(child.tagName.text);
        if (view && !renderedViews.has(child.tagName.text)) {
          renderedViews.add(child.tagName.text);
          function returns(node) {
            if (node !== view && ts.isFunctionLike(node)) return;
            if (ts.isReturnStatement(node) && node.expression) render(node.expression);
            ts.forEachChild(node, returns);
          }
          if (ts.isBlock(view.body)) returns(view);
          else render(view.body);
        }
      }
      if (ts.isIdentifier(child) && values.has(child.text) && !resolved.has(child.text)) {
        resolved.add(child.text);
        render(values.get(child.text));
      }
      ts.forEachChild(child, render);
    }
    function screen(node) {
      if (node !== statement && ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node)) screenCalls.push(node);
      if (ts.isReturnStatement(node) && node.expression) {
        render(node.expression);
      }
      ts.forEachChild(node, screen);
    }
    screen(statement);
  }
  return {
    importSources() {
      return modules;
    },
    calledNames() {
      return calls.map((call) => call.expression.getText(file));
    },
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
