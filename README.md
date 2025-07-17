# Resource Planner Backend

A PostgreSQL-based REST API for the Resource Planner application.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn

## Quick Setup

### 1. Install PostgreSQL

**macOS (with Homebrew):**

```bash
brew install postgresql@14
brew services start postgresql@14
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows:**
Download from https://www.postgresql.org/download/windows/

### 2. Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database and user
CREATE DATABASE resource_planner;
CREATE USER planner_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE resource_planner TO planner_user;
\q
```

### 3. Configure Environment

Create a `.env` file:

```bash
cp .env.example .env
```

Update `.env` with your database credentials:

```env
DATABASE_URL="postgresql://planner_user:your_password@localhost:5432/resource_planner?schema=public"
PORT=3001
NODE_ENV=development
FRONTEND_URL="http://localhost:5173"
```

### 4. Install Dependencies & Setup Database

```bash
npm install
npm run db:push
npm run db:generate
```

### 5. Start Development Server

```bash
npm run dev
```

The API will be available at `http://localhost:3001`

## API Endpoints

### Team Members

- `GET /api/team-members` - Get all team members
- `POST /api/team-members` - Create team member
- `PUT /api/team-members/:id` - Update team member
- `DELETE /api/team-members/:id` - Delete team member
- `POST /api/team-members/:id/holidays` - Add personal holiday
- `DELETE /api/team-members/:id/holidays/:holidayId` - Remove personal holiday

### Work Items

- `GET /api/work-items` - Get all work items
- `POST /api/work-items` - Create work item
- `PUT /api/work-items/:id` - Update work item
- `DELETE /api/work-items/:id` - Delete work item
- `POST /api/work-items/:id/assign-sprint` - Assign to sprint
- `DELETE /api/work-items/:id/assign-sprint/:sprintId` - Remove from sprint

### Sprints

- `GET /api/sprints` - Get all sprints
- `POST /api/sprints` - Create sprint
- `PUT /api/sprints/:id` - Update sprint

### Holidays

- `GET /api/holidays` - Get public holidays
- `POST /api/holidays` - Create public holiday
- `DELETE /api/holidays/:id` - Delete public holiday

### Sprint Configuration

- `GET /api/sprint-config` - Get configuration
- `POST /api/sprint-config` - Update configuration

### Health Check

- `GET /api/health` - Check API and database status

## Database Schema

The application uses PostgreSQL with the following main tables:

- `team_members` - Team member information and skills
- `work_items` - Work items with skills and estimates
- `work_item_dependencies` - Work item dependency relationships
- `sprints` - Sprint definitions
- `sprint_work_items` - Work item to sprint assignments
- `personal_holidays` - Team member personal holidays
- `public_holidays` - Company-wide holidays
- `sprint_config` - Sprint configuration settings

## Development Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema to database
npm run db:migrate   # Run database migrations
npm run db:studio    # Open Prisma Studio (database GUI)
```

## Data Migration from localStorage

To migrate existing localStorage data from the frontend:

1. Export your data from the frontend application
2. Use the provided migration scripts (coming soon)
3. Or manually insert via the API endpoints

## Troubleshooting

### Database Connection Issues

1. Check PostgreSQL is running: `brew services list | grep postgresql`
2. Verify database exists: `psql -l`
3. Test connection: `psql resource_planner`
4. Check `.env` file for correct credentials

### Port Conflicts

If port 3001 is in use, update `PORT` in `.env` file.

### Prisma Issues

If you encounter Prisma errors:

```bash
npm run db:generate
npm run db:push
```

## Production Deployment

For production deployment:

1. Set `NODE_ENV=production` in environment
2. Use environment variables for sensitive configuration
3. Consider using connection pooling (PgBouncer)
4. Set up database backups
5. Configure SSL for database connections

## License

This project is licensed under the ISC License.
