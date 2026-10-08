import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { OAuthService } from './oauth.service.js';
import { PrincipalService } from './principal.service.js';
import { TokenService } from './token.service.js';
import { TenancyModule } from '../modules/tenancy/tenancy.module.js';

@Global()
@Module({
  imports: [JwtModule.register({ global: true }), TenancyModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService, MfaService, OAuthService, PrincipalService],
  exports: [AuthService, TokenService, MfaService, OAuthService, PrincipalService],
})
export class AuthModule {}
