
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // The third parameter '' allows loading variables without the VITE_ prefix.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // This globally replaces process.env.API_KEY in your code with the actual key value
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
    },
  };
});
