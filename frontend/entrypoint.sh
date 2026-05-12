#!/bin/sh
set -e

echo "🔄 Running database migrations..."
./node_modules/.bin/prisma db push --accept-data-loss || {
  echo "⚠️  Warning: Migration failed, but continuing with app startup..."
  echo "   Make sure the database is accessible at: $DATABASE_URL"
}

echo "✅ Starting application..."
exec node server.js
