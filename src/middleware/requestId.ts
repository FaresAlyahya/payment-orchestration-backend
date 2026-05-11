import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Extend Express Request to carry a unique request ID
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Middleware: attach a unique request ID to every inbound request.
 *
 * If the caller supplies an X-Request-ID header we honour it (useful for
 * end-to-end tracing from a gateway or frontend).  Otherwise we generate a
 * new UUID v4.  The final ID is:
 *  - stored on req.requestId for use in downstream middleware / controllers
 *  - echoed back in the X-Request-ID response header so clients can correlate
 *    their logs with server-side logs.
 */
export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestId =
    (req.headers['x-request-id'] as string | undefined)?.trim() || uuidv4();

  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  next();
};
