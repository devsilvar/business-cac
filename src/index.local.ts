/**
 * Local Development Server
 * Runs without Firebase Functions dependencies
 */

import app from './app.js';

const PORT = process.env.PORT || 3000;

// Start the Express server for local development
app.listen(PORT, () => {
  console.log(`🚀 Server now running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Admin login: http://localhost:${PORT}/api/v1/admin/auth/login`);
  console.log(`👥 Admin dashboard: http://localhost:${PORT}/api/v1/admin/overview`);
  console.log(`💼 Customer management: http://localhost:${PORT}/api/v1/admin/customers`);
});