// ESLint rule custom: bloquea db.select/update/insert/delete directos en /app/api/
// Fuerza uso de withOrgContext() wrapper para garantizar RLS

module.exports = {
  rules: {
    'no-raw-db-queries': {
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

        // Métodos de DB que NO deben llamarse directamente
        const dbMethods = ['select', 'update', 'insert', 'delete'];

        return {
          CallExpression(node) {
            if (isInAppApi || (isInWorker && !isInMigration)) {
              const callee = node.callee;

              // Detecta db.select(), db.update(), etc.
              if (
                callee.type === 'MemberExpression' &&
                callee.property.type === 'Identifier' &&
                dbMethods.includes(callee.property.name)
              ) {
                context.report({
                  node,
                  messageId: isInWorker ? 'noRawDbQueryInWorker' : 'noRawDbQuery',
                });
              }
            }
          },
        };
      },
    },
  },
};