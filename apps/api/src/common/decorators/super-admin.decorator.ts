import { SetMetadata } from '@nestjs/common';

export const SUPER_ADMIN_KEY = 'superAdminOnly';

/** Platform-level endpoints, reachable only by PeopleCore operators. */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN_KEY, true);
