"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../lib/prisma");
const router = express_1.default.Router();
// GET /api/team-members - Get all team members
router.get('/', async (req, res) => {
    try {
        const teamMembers = await prisma_1.prisma.teamMember.findMany();
        const response = {
            data: teamMembers
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching team members:', error);
        const apiError = {
            error: 'Failed to fetch team members',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
exports.default = router;
//# sourceMappingURL=teamMembers-minimal.js.map