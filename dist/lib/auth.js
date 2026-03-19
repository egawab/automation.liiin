"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_SECRET = void 0;
exports.getUserFromToken = getUserFromToken;
exports.verifyToken = verifyToken;
exports.unauthorized = unauthorized;
const server_1 = require("next/server");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const headers_1 = require("next/headers");
exports.JWT_SECRET = process.env.JWT_SECRET || 'change-this-to-a-very-long-random-string-in-production-min-32-chars';
async function getUserFromToken() {
    const cookieStore = await (0, headers_1.cookies)();
    const token = cookieStore.get('auth_token')?.value;
    if (!token)
        return null;
    try {
        const decoded = jsonwebtoken_1.default.verify(token, exports.JWT_SECRET);
        return decoded.userId;
    }
    catch (err) {
        return null;
    }
}
function verifyToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, exports.JWT_SECRET);
        return decoded;
    }
    catch (err) {
        return null;
    }
}
function unauthorized() {
    return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
