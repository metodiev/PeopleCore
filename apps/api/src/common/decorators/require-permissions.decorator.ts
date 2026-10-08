import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@peoplecore/shared';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Requires all listed permissions. Permissions are resolved per request from
 * the user's roles; platform permissions imply tenant permissions for super
 * admins only when `allowSuperAdmin` is not disabled.
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
