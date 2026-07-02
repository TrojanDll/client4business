import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiError } from './api-error';

function collectMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...collectMessages(error.children ?? []),
  ]);
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) =>
      new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        collectMessages(errors).join('; ') || 'Validation failed',
      ),
  });
}
