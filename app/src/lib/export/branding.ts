import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { orgs } from '@/db/schema';
import { logger } from '@/lib/logger';

export type OrgBranding = {
  logoUrl?: string;
  primaryColor?: string;
};

/**
 * Fetch branding fields for an org. Used by the PDF worker to inject a
 * logo header on the rendered PDF.
 *
 * Returns an empty object (no logo) if the org has no branding configured
 * or if the lookup fails — branding is non-critical for export.
 */
export async function getOrgBranding(orgId: string): Promise<OrgBranding> {
  try {
    const row = await db.query.orgs.findFirst({
      where: eq(orgs.id, orgId),
      columns: {
        brandLogoUrl: true,
        brandPrimaryColor: true,
      },
    });
    if (!row) return {};
    return {
      logoUrl: row.brandLogoUrl ?? undefined,
      primaryColor: row.brandPrimaryColor ?? undefined,
    };
  } catch (error) {
    logger.error({ err: error, orgId }, 'branding: failed to fetch org branding');
    return {};
  }
}