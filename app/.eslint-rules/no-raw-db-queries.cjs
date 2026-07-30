/**
 * ESLint rule custom: bloquea db.select/update/insert/delete directos en /app/api/.
 * Fuerza uso de withOrgContext() wrapper para garantizar RLS.
 *
 * CommonJS para compatibilidad con ESLint 9 + FlatCompat.
 *
 * v1.2 — además bloquea db.X() *dentro* de callbacks de withOrgContext()
 *        o withSystemContext(). Esas queries se ejecutan en otra conexión
 *        y RLS no las protege (T1 del threat model).
 */

const dbMethodNames = ['select', 'update', 'insert', 'delete'];

const noRawDbQueriesRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid raw DB queries in /app/api/. Use withOrgContext() to enforce RLS.',
    },
    messages: {
      noRawDbQuery:
        'Direct DB queries are forbidden in API routes. Wrap with withOrgContext() to enforce tenant isolation via RLS.',
      noRawDbQueryInWorker:
        'Direct DB queries require withOrgContext() wrapper to enforce RLS. Exception: migration scripts.',
      dbInsideOrgContext:
        'Use the `tx` argument passed to the withOrgContext()/withSystemContext() callback instead of the module-level `db`. The GUCs are scoped to `tx`; queries via `db` bypass RLS.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    const isInAppApi = /\/app\/api\//.test(filename);
    const isInWorker = /\/worker\//.test(filename);
    const isInMigration = /\/scripts\/migrations?\//.test(filename);

    let callbackDepth = 0;
    let insideOrgContext = false;

    function isDbCallee(callee) {
      return (
        callee &&
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'db' &&
        callee.property.type === 'Identifier' &&
        dbMethodNames.includes(callee.property.name)
      );
    }

    function isInsideOrgContextWrapper(node) {
      let parent = node.parent;
      while (parent) {
        if (
          parent.type === 'CallExpression' &&
          parent.callee &&
          parent.callee.type === 'Identifier' &&
          (parent.callee.name === 'withOrgContext' ||
            parent.callee.name === 'withOrgContextReadOnly' ||
            parent.callee.name === 'withSystemContext')
        ) {
          return true;
        }
        parent = parent.parent;
      }
      return false;
    }

    return {
      CallExpression(node) {
        if (!isInAppApi && !(isInWorker && !isInMigration)) return;

        const callee = node.callee;
        if (!isDbCallee(callee)) return;

        if (insideOrgContext) {
          context.report({ node, messageId: 'dbInsideOrgContext' });
          return;
        }

        if (isInsideOrgContextWrapper(node)) return;
        context.report({
          node,
          messageId: isInWorker ? 'noRawDbQueryInWorker' : 'noRawDbQuery',
        });
      },
      ':function'(node) {
        const isOrgCallback =
          node.parent &&
          node.parent.type === 'CallExpression' &&
          node.parent.callee &&
          node.parent.callee.type === 'Identifier' &&
          (node.parent.callee.name === 'withOrgContext' ||
            node.parent.callee.name === 'withOrgContextReadOnly' ||
            node.parent.callee.name === 'withSystemContext');
        callbackDepth += 1;
        if (isOrgCallback) insideOrgContext = true;
      },
      ':function:exit'() {
        callbackDepth -= 1;
        if (callbackDepth === 0) insideOrgContext = false;
      },
    };
  },
};

const plugin = {
  meta: {
    name: 'dash-bi-eslint-rules',
    version: '1.2.0',
  },
  rules: {
    'no-raw-db-queries': noRawDbQueriesRule,
  },
};

module.exports = plugin;
module.exports.default = plugin;