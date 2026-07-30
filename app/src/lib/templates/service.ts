import { withOrgContext } from '@/db/client';
import { dashboards } from '@/db/schema';
import { audit } from '@/lib/audit/log';
import { getTemplateById } from './catalog';
import type { Widget } from '@/lib/widgets/types';

export type InstantiateTemplateOptions = {
  templateId: string;
  orgId: string;
  userId: string;
  title?: string;
  dataSourceId?: string;
};

export async function instantiateTemplate({
  templateId,
  orgId,
  userId,
  title,
  dataSourceId,
}: InstantiateTemplateOptions) {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new Error(`Template "${templateId}" no encontrado`);
  }

  const finalTitle = title ?? template.name;
  const configuredWidgets: Widget[] = template.widgets.map((widget) => {
    if (dataSourceId && widget.source?.kind === 'query') {
      return {
        ...widget,
        source: {
          ...widget.source,
          dataSourceId,
        },
      };
    }
    return widget;
  });

  return withOrgContext(orgId, userId, async (tx) => {
    const [inserted] = await tx
      .insert(dashboards)
      .values({
        orgId,
        title: finalTitle,
        description: template.description,
        theme: template.theme,
        archetype: template.archetype,
        widgets: configuredWidgets,
        createdBy: userId,
      })
      .returning();

    if (!inserted) {
      throw new Error('Error insertando dashboard desde plantilla');
    }

    await audit(orgId, userId, 'dashboard.created', `dashboard:${inserted.id}`, {
      metadata: {
        templateId: template.id,
        archetype: template.archetype,
        widgetsCount: configuredWidgets.length,
      },
    });

    return inserted;
  });
}
