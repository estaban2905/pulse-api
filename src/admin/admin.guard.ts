import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

const TOKEN_HEADER = 'x-pulse-admin-token';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Small shared-secret guard for the local catalog maintainer.
 *
 * This deliberately fails closed when no server token is configured. Hashing
 * both values gives timingSafeEqual equal-sized buffers even when the supplied
 * token has a different length.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configuredToken = process.env.PULSE_ADMIN_TOKEN;
    if (!configuredToken) {
      throw new ServiceUnavailableException('Admin API is not configured');
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const rawHeader = request.headers[TOKEN_HEADER];
    const suppliedToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const isValid = typeof suppliedToken === 'string' && timingSafeEqual(digest(suppliedToken), digest(configuredToken));

    if (!isValid) throw new UnauthorizedException('Invalid admin token');
    return true;
  }
}
