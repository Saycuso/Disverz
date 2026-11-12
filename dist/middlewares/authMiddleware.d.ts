import type { Request, Response, NextFunction } from "express";
export interface AuthRequest extends Request {
    userId?: string;
}
export declare const requireAuth: (req: AuthRequest, res: Response, next: NextFunction) => void;
//# sourceMappingURL=authMiddleware.d.ts.map