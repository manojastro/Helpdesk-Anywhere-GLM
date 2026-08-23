import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { TechnicianRequest } from './jwt-auth.guard';

export const CurrentTechnician = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<TechnicianRequest>();
    if (!req.technicianId) throw new Error('technicianId missing — use with JwtAuthGuard');
    return req.technicianId;
  },
);
