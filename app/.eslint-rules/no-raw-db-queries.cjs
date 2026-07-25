/**
 * ESLint rule custom: bloquea db.select/update/insert/delete directos en /app/api/
 * Fuerza uso de withOrgContext() wrapper para garantizar RLS.
 *
 * CommonJS para compatibilidad con ESLint 9 + FlatCompat.
 *
 * v1.1 — tolera llamadas a db.X() dentro de callbacks de withOrgContext() o
 *        withSystemContext() (esas SÍ están autorizadas).
 */

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
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    const isInAppApi = /\/app\/api\//.test(filename);
    const isInWorker = /\/worker\//.test(filename);
    const isInMigration = /\/scripts\/migrations?\//.test(filename);

    const dbMethods = ['select', 'update', 'insert', 'delete'];

    function isInsideOrgContextWrapper(node) {
      let parent = node.parent;
      while (parent) {
        if (
          parent.type === 'CallExpression' &&
          parent.callee &&
          parent.callee.type === 'Identifier' &&
          (parent.callee.name === 'withOrgContext' || parent.callee.name === 'withSystemContext')
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
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          dbMethods.includes(callee.property.name)
        ) {
          if (isInsideOrgContextWrapper(node)) return;
          context.report({
            node,
            messageId: isInWorker ? 'noRawDbQueryInWorker' : 'noRawDbQuery',
          });
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: 'dash-bi-eslint-rules',
    version: '1.1.0',
  },
  rules: {
    'no-raw-db-queries': noRawDbQueriesRule,
  },
};

module.exports = plugin;
module.exports.default = plugin;