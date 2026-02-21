import { Request, Response, NextFunction } from 'express';
import { ZodType, ZodError } from 'zod';
import { ValidationError } from '../utils/errors';

/**
 * Express middleware that validates request body against a Zod schema.
 * Replaces req.body with the parsed (and coerced) result on success.
 */
export function validate(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ');
        next(new ValidationError(message));
        return;
      }
      next(error);
    }
  };
}

/**
 * Validates query parameters against a Zod schema.
 */
export function validateQuery(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as typeof req.query;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ');
        next(new ValidationError(message));
        return;
      }
      next(error);
    }
  };
}
