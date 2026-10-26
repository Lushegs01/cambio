import { createServerlessHandler } from '../server/serverless.js';

// Vercel invokes this function; importing it must never start a TCP listener.
export default createServerlessHandler();
