import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IncomingHttpHeaders } from 'http';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private configService: ConfigService) {
    const secret =
      configService.get<string>('JWT_SECRET') || 'SECRET_KEY_CHANGE_ME';
    super({
      jwtFromRequest: (req: { headers?: IncomingHttpHeaders }) => {
        const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
        return token;
      },
      ignoreExpiration: false,
      secretOrKey: secret,
    });
    const maskedSecret =
      secret.length > 8
        ? `${secret.substring(0, 4)}${'*'.repeat(secret.length - 8)}${secret.substring(secret.length - 4)}`
        : '****';
    this.logger.log(`Initialized with secret: ${maskedSecret}`);
  }

  validate(payload: { sub: string; username: string }) {
    return { userId: payload.sub, username: payload.username };
  }
}
