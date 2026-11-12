import jwt from 'jsonwebtoken';
export const requireAuth = (req, res, next) => {
    const token = req.cookies.auth_token;
    if (!token) {
        res.status(401).json({ error: 'Unauthorized: No token Provided' });
        return;
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    }
    catch (error) {
        res.status(403).json({ error: 'Forbidden: Invalid or expired token' });
    }
};
//# sourceMappingURL=authMiddleware.js.map