import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ACTIONS_KEY = 'requiredActions';

export const RequireActions = (
  ...actions: string[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ACTIONS_KEY, actions);
