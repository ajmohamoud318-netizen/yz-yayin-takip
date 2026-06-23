// vite.config.js
import { defineConfig } from "file:///sessions/gallant-focused-dirac/mnt/yz-yayin-takip-main/client/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/gallant-focused-dirac/mnt/yz-yayin-takip-main/client/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
var __vite_injected_original_import_meta_url = "file:///sessions/gallant-focused-dirac/mnt/yz-yayin-takip-main/client/vite.config.js";
var __dirname = path.dirname(fileURLToPath(__vite_injected_original_import_meta_url));
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    port: 5173,
    // Allow any host header (needed when sharing the dev server through a
    // tunnel like cloudflared/ngrok, which presents its own hostname).
    allowedHosts: true,
    proxy: {
      // Backend not built yet — proxy is ready for when /api goes live.
      "/api": "http://localhost:4000"
    }
  },
  // When sharing the dev server through a tunnel, browsers (and Cloudflare's
  // edge) sometimes serve a cached index.html / chunk after a code change.
  // Force everything to be re-validated on every request.
  headers: {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0"
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvZ2FsbGFudC1mb2N1c2VkLWRpcmFjL21udC95ei15YXlpbi10YWtpcC1tYWluL2NsaWVudFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL2dhbGxhbnQtZm9jdXNlZC1kaXJhYy9tbnQveXoteWF5aW4tdGFraXAtbWFpbi9jbGllbnQvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL2dhbGxhbnQtZm9jdXNlZC1kaXJhYy9tbnQveXoteWF5aW4tdGFraXAtbWFpbi9jbGllbnQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJ1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ25vZGU6dXJsJ1xuXG5jb25zdCBfX2Rpcm5hbWUgPSBwYXRoLmRpcm5hbWUoZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpKVxuXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgLy8gQWxsb3cgYW55IGhvc3QgaGVhZGVyIChuZWVkZWQgd2hlbiBzaGFyaW5nIHRoZSBkZXYgc2VydmVyIHRocm91Z2ggYVxuICAgIC8vIHR1bm5lbCBsaWtlIGNsb3VkZmxhcmVkL25ncm9rLCB3aGljaCBwcmVzZW50cyBpdHMgb3duIGhvc3RuYW1lKS5cbiAgICBhbGxvd2VkSG9zdHM6IHRydWUsXG4gICAgcHJveHk6IHtcbiAgICAgIC8vIEJhY2tlbmQgbm90IGJ1aWx0IHlldCBcdTIwMTQgcHJveHkgaXMgcmVhZHkgZm9yIHdoZW4gL2FwaSBnb2VzIGxpdmUuXG4gICAgICAnL2FwaSc6ICdodHRwOi8vbG9jYWxob3N0OjQwMDAnLFxuICAgIH0sXG4gIH0sXG4gIC8vIFdoZW4gc2hhcmluZyB0aGUgZGV2IHNlcnZlciB0aHJvdWdoIGEgdHVubmVsLCBicm93c2VycyAoYW5kIENsb3VkZmxhcmUnc1xuICAvLyBlZGdlKSBzb21ldGltZXMgc2VydmUgYSBjYWNoZWQgaW5kZXguaHRtbCAvIGNodW5rIGFmdGVyIGEgY29kZSBjaGFuZ2UuXG4gIC8vIEZvcmNlIGV2ZXJ5dGhpbmcgdG8gYmUgcmUtdmFsaWRhdGVkIG9uIGV2ZXJ5IHJlcXVlc3QuXG4gIGhlYWRlcnM6IHtcbiAgICAnQ2FjaGUtQ29udHJvbCc6ICduby1zdG9yZSwgbm8tY2FjaGUsIG11c3QtcmV2YWxpZGF0ZSwgcHJveHktcmV2YWxpZGF0ZScsXG4gICAgUHJhZ21hOiAnbm8tY2FjaGUnLFxuICAgIEV4cGlyZXM6ICcwJyxcbiAgfSxcbn0pXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTRXLFNBQVMsb0JBQW9CO0FBQ3pZLE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFDakIsU0FBUyxxQkFBcUI7QUFIc00sSUFBTSwyQ0FBMkM7QUFLclIsSUFBTSxZQUFZLEtBQUssUUFBUSxjQUFjLHdDQUFlLENBQUM7QUFHN0QsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLFdBQVcsS0FBSztBQUFBLElBQ3BDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBO0FBQUE7QUFBQSxJQUdOLGNBQWM7QUFBQSxJQUNkLE9BQU87QUFBQTtBQUFBLE1BRUwsUUFBUTtBQUFBLElBQ1Y7QUFBQSxFQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFJQSxTQUFTO0FBQUEsSUFDUCxpQkFBaUI7QUFBQSxJQUNqQixRQUFRO0FBQUEsSUFDUixTQUFTO0FBQUEsRUFDWDtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
