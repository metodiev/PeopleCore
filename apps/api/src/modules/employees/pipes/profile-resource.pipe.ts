import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  BankAccountDto,
  EducationDto,
  EmergencyContactDto,
  LanguageDto,
  NoteDto,
  SkillDto,
} from '../dto/employee.dto.js';
import { PROFILE_RESOURCES, type ProfileResource } from '../employee-profile.service.js';

const DTO_BY_RESOURCE: Record<ProfileResource, new () => object> = {
  'emergency-contacts': EmergencyContactDto,
  'bank-accounts': BankAccountDto,
  education: EducationDto,
  skills: SkillDto,
  languages: LanguageDto,
  notes: NoteDto,
};

/** Validates the `:resource` route parameter against the supported set. */
@Injectable()
export class ProfileResourcePipe implements PipeTransform<string, ProfileResource> {
  transform(value: string): ProfileResource {
    if (!(PROFILE_RESOURCES as readonly string[]).includes(value)) {
      throw new BadRequestException(
        `Unknown profile resource "${value}". Supported: ${PROFILE_RESOURCES.join(', ')}`,
      );
    }
    return value as ProfileResource;
  }
}

/**
 * Validates a profile sub-resource payload with the DTO that belongs to it.
 * Partial validation is used for PATCH requests.
 */
export function validateProfileBody(
  resource: ProfileResource,
  value: unknown,
  options: { partial?: boolean } = {},
): object {
  const dtoClass = DTO_BY_RESOURCE[resource];
  if (!dtoClass) throw new BadRequestException('Unknown profile resource');

  const instance = plainToInstance(dtoClass, value ?? {});
  const errors = validateSync(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
    skipMissingProperties: options.partial === true,
  });
  if (errors.length > 0) {
    const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    throw new BadRequestException(messages.length > 0 ? messages : 'Validation failed');
  }
  return instance as object;
}
