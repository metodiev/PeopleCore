import { SetMetadata } from '@nestjs/common';

export const AUDIT_ENTITY_KEY = 'auditEntity';

/** Declares the entity name used when auto-auditing a controller. */
export const Audited = (entityType: string) => SetMetadata(AUDIT_ENTITY_KEY, entityType);
