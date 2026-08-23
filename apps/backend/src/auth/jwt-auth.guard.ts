import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface TechnicianRequest extends Request {
  technicianId?: string;
  technicianEmail?: string;
}

/** Bearer-JWT guard for technician endpoints (POC lightweight auth). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TechnicianRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        typ?: string;
      }>(header.slice('Bearer '.length));
      if (payload.typ !== 'access') throw new Error('wrong token type');
      req.technicianId = payload.sub;
      req.technicianEmail = payload.email;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
