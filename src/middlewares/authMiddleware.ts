import type { Request, Response, NextFunction } from "express";
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request{
    userId?: string;
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
    const token = req.cookies.auth_token;

    if(!token){
        res.status(401).json({error: 'Unauthorized: No token Provided'});
        return;
    }
    try{
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {userId: string};
        req.userId = decoded.userId;

        next();
    }
    catch(error){
        res.status(403).json({error: 'Forbidden: Invalid or expired token'});
    }
}