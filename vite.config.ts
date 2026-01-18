
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Injects the API_KEY from the environment into the client-side code
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY),
  },
});
