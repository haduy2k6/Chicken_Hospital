import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import googleConfig from '../../config/google.config.js';
import { AuthService } from '../auth.service.js';
import type { ProviderIdentity } from '../auth.types.js';
import type { AuthUserDto } from '../dto/auth.dto.js';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(@Inject(googleConfig.KEY) config: ConfigType<typeof googleConfig>, private readonly authService: AuthService) {
    super({
      clientID: config.clientId!,
      clientSecret: config.clientSecret!,
      callbackURL: config.callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(_accessToken: string, _refreshToken: string, profile: Profile): Promise<AuthUserDto> {
    return this.authService.signInWithProvider(this.toIdentity(profile));
  }

  private toIdentity(profile: Profile): ProviderIdentity {
    const email = profile.emails?.[0]?.value;
    return {
      provider: 'google',
      providerId: profile.id,
      name: profile.displayName || profile.name?.givenName || (email ? email.split('@')[0] : 'User'),
      email,
      avatar: profile.photos?.[0]?.value,
    };
  }
}
