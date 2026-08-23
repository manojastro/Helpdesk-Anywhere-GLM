import { Body, Controller, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { TechniciansService } from '../technicians/technicians.service';

class DevLoginDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;
}

/**
 * POC-only lightweight auth: identify a technician by email, issue a JWT.
 * Real IdP integration is deferred to production (see docs/POC_SCOPE.md).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly technicians: TechniciansService,
    private readonly jwt: JwtService,
  ) {}

  @Post('dev-login')
  async devLogin(@Body() dto: DevLoginDto) {
    const tech = await this.technicians.findOrCreate(dto.email, dto.displayName);
    const accessToken = await this.jwt.signAsync({
      sub: tech.id,
      email: tech.email,
      typ: 'access',
    });
    return {
      accessToken,
      technician: { id: tech.id, email: tech.email, displayName: tech.displayName },
    };
  }
}
