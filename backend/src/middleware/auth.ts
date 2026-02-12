import { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth';
import { UnauthorizedError } from '../utils/errors';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        plan: string;
        image?: string | null;
      };
    }
  }
}

/**
 * Middleware that requires a valid Better Auth session.
 * Attaches the authenticated user to req.user.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      throw new UnauthorizedError('No valid session');
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      plan: (session.user as any).plan ?? 'free',
      image: session.user.image,
    };

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
      return;
    }
    next(new UnauthorizedError('Authentication failed'));
  }
}

/**
 * Optional auth middleware — attaches user if session present, but does not reject.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (session) {
      req.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        plan: (session.user as any).plan ?? 'free',
        image: session.user.image,
      };
    }

    next();
  } catch {
    next();
  }
}
