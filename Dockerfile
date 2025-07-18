FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY prisma ./prisma/

# Configure npm to use public registry and handle SSL issues
RUN npm config set registry https://registry.npmjs.org/ && \
    npm config delete //registry.npmjs.org/:_authToken || true && \
    npm config set strict-ssl false && \
    npm config set ca null

# Install dependencies (skip package-lock.json to force regeneration with public registry)
RUN npm install

# Generate Prisma client (disable SSL verification for binary downloads)
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN npx prisma generate

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Copy package files  
COPY package.json ./
COPY prisma ./prisma/

# Configure npm to use public registry and handle SSL issues
RUN npm config set registry https://registry.npmjs.org/ && \
    npm config delete //registry.npmjs.org/:_authToken || true && \
    npm config set strict-ssl false && \
    npm config set ca null

# Install production dependencies only (skip package-lock.json to force regeneration with public registry)
RUN npm install --production

# Copy Prisma client from builder stage
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built application
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3001

# Start the application
CMD ["npm", "start"] 